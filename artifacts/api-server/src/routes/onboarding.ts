/**
 * Onboarding 4.8 — Profil d'entreprise + 4.9 — Reprise de l'existant.
 *
 * Deux routeurs exportés avec des niveaux d'autorisation différents :
 *
 *   onboardingReadRouter  — MEMBER+ (lecture seule, monté sous `biz`)
 *     GET /onboarding/profil
 *     GET /reprise/blocs
 *     GET /reprise/capacite-equipe
 *
 *   onboardingWriteRouter — OWNER uniquement (monté sous `ownerOnly`)
 *     POST /onboarding/profil/confirmer
 *     PATCH /onboarding/profil
 *     POST /reprise/blocs/:bloc
 *
 * Règles métier :
 * - Aucune donnée tierce sans confirmation explicite du tenant.
 * - Payload malformé → 400 AVANT transaction, le bloc n'est pas marqué done.
 * - Montants : z.coerce.number().finite().positive() — rejette "abc", NaN, Infinity.
 * - Seuil de silence : compté APRÈS les insertions (existants + entrants) < 3 → donneesInsuffisantes.
 * - Sous-traitants : comptés dans le coût, JAMAIS dans la capacité.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  withTenant,
  settingsTable,
  affairesTable,
  teamMembersTable,
  facturesTable,
  devisTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { toDateString } from "@nodaq/shared";

// ── Validation SIRET (Luhn, inlinée pour éviter la dépendance circulaire) ────

/**
 * Vérifie un SIRET de 14 chiffres par algorithme de Luhn.
 * Exception La Poste (SIREN 356000000) : la clé Luhn ne s'applique pas.
 */
function isValidSiret(siret: string): boolean {
  const cleaned = siret.replace(/\s/g, "");
  if (!/^\d{14}$/.test(cleaned)) return false;
  // Exception La Poste
  if (cleaned.startsWith("356000000")) return true;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = parseInt(cleaned[i]!, 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// ── Clés de settings pour le profil entreprise ───────────────────────────────

export const COMPANY_KEYS = [
  "company.siret",
  "company.siren",
  "company.raison_sociale",
  "company.forme_juridique",
  "company.adresse",
  "company.code_postal",
  "company.commune",
  "company.code_naf",
  "company.libelle_naf",
  "company.tranche_effectif",
  "company.date_creation",
  "company.tva_intracom",
  "company.rcs_ville",
  "company.capital",
  "company.logo_url",
  "company.decennale_assureur",
  "company.decennale_numero",
  "company.decennale_couverture",
  "company.taux_horaire_reel",
  "company.conditions_reglement",
  "company.format_numerotation",
  "company.iban",
  "company.plateforme_agreee",
  "company.pack_metier",
  // 4.9 — reprise
  "reprise.ca_facture_ytd",
  "reprise.ca_encaisse_ytd",
  "reprise.date_debut_exercice",
  "reprise.blocs_passes",
] as const;

// ── Utilitaires ───────────────────────────────────────────────────────────────

async function upsertSetting(
  tenantId: string,
  key: string,
  value: string,
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
): Promise<void> {
  await tx.insert(settingsTable)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [settingsTable.tenantId, settingsTable.key],
      set: { value, updatedAt: new Date() },
    });
}

async function appendBlocPasse(
  tenantId: string,
  bloc: string,
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
): Promise<void> {
  const rows = await tx.select().from(settingsTable).where(
    and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "reprise.blocs_passes")),
  );
  const current: string[] = rows[0] ? (JSON.parse(rows[0].value) as string[]) : [];
  if (!current.includes(bloc)) current.push(bloc);
  await upsertSetting(tenantId, "reprise.blocs_passes", JSON.stringify(current), tx);
}

async function countAffaires(tenantId: string): Promise<number> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ cnt: count() }).from(affairesTable),
  );
  return row?.cnt ?? 0;
}

function isoToday(): string {
  return toDateString(new Date());
}

// ── Schémas de données par bloc ────────────────────────────────────────────────

const ChantierRow = z.object({
  label: z.string().min(1, "Le libellé est requis"),
  client: z.string().optional(),
  montantVenduHt: z.coerce.number().finite().nonnegative().nullable().optional(),
  avancementPct: z.coerce.number().min(0).max(100).nullable().optional(),
  dateFinPrevue: z.string().nullable().optional(),
});

const MontantPositif = z.coerce
  .number({ invalid_type_error: "Le montant doit être un nombre" })
  .finite("Le montant doit être fini")
  .positive("Le montant doit être positif");

const MontantOptionnelNonNegatif = z.coerce
  .number({ invalid_type_error: "Le montant doit être un nombre" })
  .finite()
  .nonnegative()
  .optional();

const ImPayeRow = z.object({
  client: z.string().min(1, "Le nom du client est requis"),
  montant: MontantPositif,
  dateFacture: z.string().optional(),
});

const DevisRow = z.object({
  client: z.string().min(1, "Le nom du client est requis"),
  montant: MontantPositif,
  dateEnvoi: z.string().optional(),
});

const EquipeRow = z.object({
  name: z.string().min(1, "Le prénom est requis"),
  typeLien: z.enum(["SALARIE", "SOUS_TRAITANT", "APPRENTI"]).default("SALARIE"),
  joursParSemaine: z.coerce.number().min(1).max(7).default(5),
  coutMensuel: MontantOptionnelNonNegatif,
});

export const BlocDataSchemas = {
  chantiers: z.object({ chantiers: z.array(ChantierRow) }),
  "impayés": z.object({ "impayés": z.array(ImPayeRow) }),
  devis: z.object({ devis: z.array(DevisRow) }),
  ca_ytd: z.object({
    ca_facture_ytd: z.coerce.number().finite().nonnegative().optional(),
    ca_encaisse_ytd: z.coerce.number().finite().nonnegative().optional(),
    date_debut_exercice: z.string().optional(),
  }),
  equipe: z.object({ equipe: z.array(EquipeRow) }),
  planning: z.object({}).optional(),
} as const;

export const BLOCS = ["chantiers", "impayés", "devis", "ca_ytd", "equipe", "planning"] as const;
export type BlocId = typeof BLOCS[number];

// ── READ ROUTER — MEMBER+ ──────────────────────────────────────────────────────

export const onboardingReadRouter: IRouter = Router();

/** Lire le profil entreprise (tous les membres voient si le profil est complet). */
onboardingReadRouter.get("/onboarding/profil", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(settingsTable).where(eq(settingsTable.tenantId, tenantId)),
  );
  const allowed = new Set<string>(COMPANY_KEYS);
  const profile: Record<string, string> = {};
  for (const row of rows) {
    if (allowed.has(row.key)) profile[row.key] = row.value;
  }
  res.json({ profile });
});

/** Lire l'état des blocs de reprise. */
onboardingReadRouter.get("/reprise/blocs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(settingsTable).where(eq(settingsTable.tenantId, tenantId)),
  );
  const blocsPassesRow = rows.find(r => r.key === "reprise.blocs_passes");
  const blocs_passes: string[] = blocsPassesRow
    ? (JSON.parse(blocsPassesRow.value) as string[])
    : [];
  res.json({ blocs: BLOCS, blocs_passes });
});

/** Capacité équipe avec règle sous-traitant (coût inclus, capacité exclue). */
onboardingReadRouter.get("/reprise/capacite-equipe", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const membres = await withTenant(tenantId, (tx) =>
    tx.select().from(teamMembersTable),
  );

  const affaireCount = await countAffaires(tenantId);
  if (affaireCount < 3) {
    res.json({ donneesInsuffisantes: true });
    return;
  }

  const capaciteJours = membres
    .filter(m => m.typeLien !== "SOUS_TRAITANT")
    .reduce((sum, m) => sum + (m.joursParSemaine ?? 5), 0);

  const coutMensuelTotal = membres
    .reduce((sum, m) => sum + (m.coutMensuelCharge ?? 0), 0);

  res.json({
    donneesInsuffisantes: false,
    capaciteJoursParSemaine: capaciteJours,
    coutMensuelTotal,
    nbMembres: membres.length,
    nbSousTraitants: membres.filter(m => m.typeLien === "SOUS_TRAITANT").length,
  });
});

// ── WRITE ROUTER — OWNER only (monté sous ownerOnly dans routes/index.ts) ──────

export const onboardingWriteRouter: IRouter = Router();

// ── Profil entreprise — écrits OWNER ──────────────────────────────────────────

const ConfirmProfileBody = z.object({
  siret: z.string(),
  siren: z.string(),
  raison_sociale: z.string(),
  forme_juridique: z.string().optional(),
  adresse: z.string().optional(),
  code_postal: z.string().optional(),
  commune: z.string().optional(),
  code_naf: z.string().optional(),
  libelle_naf: z.string().optional(),
  tranche_effectif: z.string().optional(),
  date_creation: z.string().optional(),
  tva_intracom: z.string().optional(),
  pack_metier: z.string().optional(),
});

onboardingWriteRouter.post("/onboarding/profil/confirmer", async (req, res): Promise<void> => {
  const parsed = ConfirmProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  // Validation SIRET : 14 chiffres + clé Luhn (algorithme standard).
  // Exception La Poste : SIRET dont les 9 premiers chiffres forment le SIREN 356000000.
  if (d.siret) {
    if (!isValidSiret(d.siret)) {
      res.status(400).json({ error: `SIRET invalide : ${d.siret}` });
      return;
    }
  }

  const pairs: Array<[string, string]> = [
    ["company.siret", d.siret],
    ["company.siren", d.siren],
    ["company.raison_sociale", d.raison_sociale],
    ...(d.forme_juridique ? [["company.forme_juridique", d.forme_juridique] as [string, string]] : []),
    ...(d.adresse ? [["company.adresse", d.adresse] as [string, string]] : []),
    ...(d.code_postal ? [["company.code_postal", d.code_postal] as [string, string]] : []),
    ...(d.commune ? [["company.commune", d.commune] as [string, string]] : []),
    ...(d.code_naf ? [["company.code_naf", d.code_naf] as [string, string]] : []),
    ...(d.libelle_naf ? [["company.libelle_naf", d.libelle_naf] as [string, string]] : []),
    ...(d.tranche_effectif ? [["company.tranche_effectif", d.tranche_effectif] as [string, string]] : []),
    ...(d.date_creation ? [["company.date_creation", d.date_creation] as [string, string]] : []),
    ...(d.tva_intracom ? [["company.tva_intracom", d.tva_intracom] as [string, string]] : []),
    ...(d.pack_metier ? [["company.pack_metier", d.pack_metier] as [string, string]] : []),
  ];

  await withTenant(tenantId, async (tx) => {
    for (const [key, value] of pairs) {
      await upsertSetting(tenantId, key, value, tx);
    }
  });

  res.json({ ok: true });
});

const PatchProfileBody = z.record(z.string(), z.string());

onboardingWriteRouter.patch("/onboarding/profil", async (req, res): Promise<void> => {
  const parsed = PatchProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps invalide" });
    return;
  }
  const tenantId = req.tenantId!;
  const allowed = new Set<string>(COMPANY_KEYS);
  const updates = Object.entries(parsed.data).filter(([k]) => allowed.has(k));
  if (updates.length === 0) {
    res.status(400).json({ error: "Aucune clé reconnue" });
    return;
  }

  await withTenant(tenantId, async (tx) => {
    for (const [key, value] of updates) {
      await upsertSetting(tenantId, key, value, tx);
    }
  });

  res.json({ ok: true });
});

// ── Reprise de l'existant — écrits OWNER ──────────────────────────────────────

const PasserBlocBody = z.object({
  passer: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Valider ou passer un bloc de reprise.
 * - passer: true → mark bloc done, no inserts.
 * - passer: false|absent → validate payload, persist to tables, mark done.
 *
 * Seuil de silence : compté APRÈS les insertions du bloc chantiers
 * (existants + entrants) pour ne pas incorrectement retourner donneesInsuffisantes
 * lors du premier import.
 */
onboardingWriteRouter.post("/reprise/blocs/:bloc", async (req, res): Promise<void> => {
  const bloc = req.params.bloc as BlocId;
  if (!BLOCS.includes(bloc)) {
    res.status(400).json({ error: "Bloc inconnu" });
    return;
  }

  const parsed = PasserBlocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const tenantId = req.tenantId!;
  const passer = parsed.data.passer ?? false;

  // Exactly one valid action must be present:
  //   - passer === true  : skip this block intentionally
  //   - data object      : validate and persist the block data
  // Anything else (empty body, passer:false without data) → 400
  if (!passer && !parsed.data.data) {
    res.status(400).json({
      error: "Corps invalide : fournissez soit 'passer: true' pour ignorer le bloc, soit un objet 'data' contenant les données à importer.",
    });
    return;
  }

  // Valider le payload AVANT toute transaction :
  // un payload malformé retourne 400 sans marquer le bloc done.
  if (!passer && parsed.data.data) {
    const rawData = parsed.data.data;
    const schema = BlocDataSchemas[bloc as keyof typeof BlocDataSchemas];
    if (schema) {
      const v = (schema as z.ZodTypeAny).safeParse(rawData);
      if (!v.success) {
        res.status(400).json({
          error: "Données invalides pour ce bloc",
          details: v.error.format(),
        });
        return;
      }
    }
  }

  // Compter les affaires existantes avant la transaction
  const affaireCountBefore = await countAffaires(tenantId);

  // Nombre d'affaires qui seront ajoutées par ce bloc (pour le seuil de silence)
  let incomingChantierCount = 0;
  if (!passer && bloc === "chantiers" && parsed.data.data) {
    const v = BlocDataSchemas.chantiers.safeParse(parsed.data.data);
    if (v.success) incomingChantierCount = v.data.chantiers.length;
  }

  // Seuil de silence calculé APRÈS les insertions prévues
  const totalAfterInsert = affaireCountBefore + incomingChantierCount;
  const donneesInsuffisantes = totalAfterInsert < 3;

  await withTenant(tenantId, async (tx) => {
    if (!passer && parsed.data.data) {
      const rawData = parsed.data.data;

      if (bloc === "chantiers") {
        const { chantiers } = BlocDataSchemas.chantiers.parse(rawData);
        for (const c of chantiers) {
          await tx.insert(affairesTable).values({
            tenantId,
            label: c.label,
            clientName: c.client ?? null,
            status: "EN_COURS",
            montantVenduHt: c.montantVenduHt ?? null,
            avancementPct: c.avancementPct ?? null,
            dateFinPrevue: c.dateFinPrevue ?? null,
            origine: "DIRECT",
          });
        }
      }

      if (bloc === "impayés") {
        const data = BlocDataSchemas["impayés"].parse(rawData);
        for (const f of data["impayés"]) {
          const amountCents = Math.round(Number(f.montant) * 100);
          if (isNaN(amountCents) || amountCents <= 0) continue;
          const number = `REPRISE-${isoToday().replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
          await tx.insert(facturesTable).values({
            tenantId,
            customerName: f.client,
            number,
            issuedDate: f.dateFacture ?? isoToday(),
            dueDate: f.dateFacture ?? isoToday(),
            amountCents,
            residualCents: amountCents,
            settled: false,
          });
        }
      }

      if (bloc === "devis") {
        const { devis: devisRows } = BlocDataSchemas.devis.parse(rawData);
        for (const d of devisRows) {
          const totalHTCents = Math.round(Number(d.montant) * 100);
          const tvaRate = 20;
          const totalTTCCents = Math.round(totalHTCents * (1 + tvaRate / 100));
          const number = `REPRISE-${isoToday().replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
          await tx.insert(devisTable).values({
            tenantId,
            reference: number,
            clientName: d.client,
            status: "ENVOYE",
            lines: [],
            totalHTCents: isNaN(totalHTCents) ? 0 : totalHTCents,
            totalTTCCents: isNaN(totalTTCCents) ? 0 : totalTTCCents,
            tvaRate,
            remise: 0,
            validUntil: null,
          });
        }
      }

      if (bloc === "ca_ytd") {
        const data = BlocDataSchemas.ca_ytd.parse(rawData);
        if (data.ca_facture_ytd != null) {
          await upsertSetting(tenantId, "reprise.ca_facture_ytd", String(data.ca_facture_ytd), tx);
        }
        if (data.ca_encaisse_ytd != null) {
          await upsertSetting(tenantId, "reprise.ca_encaisse_ytd", String(data.ca_encaisse_ytd), tx);
        }
        if (data.date_debut_exercice) {
          await upsertSetting(tenantId, "reprise.date_debut_exercice", data.date_debut_exercice, tx);
        }
      }

      if (bloc === "equipe") {
        const { equipe: membres } = BlocDataSchemas.equipe.parse(rawData);
        for (const m of membres) {
          await tx.insert(teamMembersTable).values({
            tenantId,
            name: m.name,
            role: m.typeLien === "SOUS_TRAITANT" ? "Sous-traitant" : "Collaborateur",
            typeLien: m.typeLien,
            joursParSemaine: m.joursParSemaine,
            coutMensuelCharge: m.coutMensuel != null ? Number(m.coutMensuel) : null,
          });
        }
      }
      // planning : aucune donnée à persister — le planning est déduit
    }

    await appendBlocPasse(tenantId, bloc, tx);
  });

  res.json({ ok: true, bloc, donneesInsuffisantes: donneesInsuffisantes && !passer });
});

// Backward compat — export default pointe sur le routeur d'écriture (non utilisé
// directement par index.ts mais préserve la compatibilité avec d'éventuels imports).
export default onboardingWriteRouter;
