/*
 * Générer les attestations fiscales SAP en une seule action — US-B4.1.
 *
 * ── Le geste que la story demande ─────────────────────────────────────────
 * « Une attestation récapitulative conforme peut être générée EN MASSE pour
 * tous les clients d'un tenant EN UNE SEULE ACTION, avant le 31 mars. » Une
 * entreprise de ménage a quarante clients particuliers ; les faire un par un
 * au mois de mars est précisément le travail que la story supprime.
 *
 * ── L'unicité appartient au moteur ────────────────────────────────────────
 * `attestations_sap_client_annee_idx` interdit deux attestations pour le même
 * client et la même année. Un double clic enverrait sinon deux documents
 * fiscaux contradictoires au même particulier — et c'est LUI que
 * l'administration interrogerait.
 *
 * ── Les bloquants arrêtent TOUT, pas seulement un client ──────────────────
 * Sans numéro de déclaration SAP, aucune attestation ne vaut quoi que ce soit.
 * En produire quarante qu'il faudra renvoyer est pire que n'en produire aucune :
 * le client les a déjà transmises à son centre des impôts.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  withTenant, clientsTable, paiementsTable, settingsTable, attestationsSapTable,
} from "@workspace/db";
import { planAttestations, type PrestataireSap, type EncaissementClient } from "@nodaq/shared";
import { genererAttestationSapPdf } from "../lib/attestation-sap-pdf.js";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const Corps = z.object({
  annee: z.number().int().min(2000).max(2200),
});

/** Aujourd'hui, en date civile LOCALE — jamais `toISOString`, qui décale. */
function aujourdhuiIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Les natures d'encaissement qui sont des AIDES d'un tiers.
 *
 * APA, PCH, CESU préfinancé : encaissés par l'entreprise, mais pas payés par le
 * client. Ils n'ouvrent aucun droit au crédit d'impôt, et les compter
 * gonflerait l'avantage fiscal déclaré.
 */
const NATURES_AIDE = new Set(["AIDE_TIERS"]);

async function prestataireDuTenant(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
): Promise<PrestataireSap> {
  const lignes = await tx.select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable);
  const m = new Map(lignes.map((l) => [l.key, l.value]));
  return {
    nom: m.get("company.nom") ?? "",
    adresse: [m.get("company.adresse"), m.get("company.code_postal"), m.get("company.ville")]
      .filter(Boolean).join(", ") || null,
    siret: m.get("company.siret") ?? null,
    numeroDeclarationSap: m.get("company.sap_numero_declaration") ?? null,
  };
}

/**
 * POST /attestations-sap — génère pour TOUS les clients, en une action.
 *
 * Rend le plan complet — ce qui a été créé, ce qui existait déjà, ce qui a été
 * écarté et pourquoi. Un « 14 attestations générées » sans le reste laisserait
 * croire que les vingt-six autres clients n'existent pas.
 */
router.post("/attestations-sap", async (req, res): Promise<void> => {
  const parsed = Corps.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const { annee } = parsed.data;
  const tenantId = req.tenantId!;

  const resultat = await withTenant(tenantId, async (tx) => {
    const prestataire = await prestataireDuTenant(tx);
    const clients = await tx.select({
      id: clientsTable.id, nom: clientsTable.nom, adresse: clientsTable.adresse,
      codePostal: clientsTable.codePostal, ville: clientsTable.ville,
    }).from(clientsTable);

    const paiements = await tx.select({
      clientId: paiementsTable.clientId, date: paiementsTable.date,
      montantCents: paiementsTable.montantCents, sens: paiementsTable.sens,
      nature: paiementsTable.nature,
    }).from(paiementsTable);

    const encaissements: EncaissementClient[] = paiements
      .filter((p) => p.clientId !== null)
      .map((p) => ({
        clientId: p.clientId!,
        date: p.date,
        // ── Le signe vient de `sens`, jamais du montant ────────────────────
        // Un REMBOURSEMENT est de l'argent RENDU au client : il n'a pas payé
        // cette somme, et l'attester lui ferait réclamer un crédit d'impôt sur
        // de l'argent qu'il a récupéré. La colonne `montant_cents` porte un
        // CHECK > 0 — le signe est donc à reconstituer ici, comme partout
        // ailleurs dans ce dépôt.
        montantCents: p.sens === "REMBOURSEMENT" ? -p.montantCents : p.montantCents,
        estAideTiers: NATURES_AIDE.has(p.nature),
      }));

    const plan = planAttestations(
      clients.map((c) => ({
        id: c.id, nom: c.nom,
        adresse: [c.adresse, c.codePostal, c.ville].filter(Boolean).join(", ") || null,
      })),
      encaissements, prestataire, annee,
    );

    if (plan.bloquants.length > 0) return { plan, prestataire, creees: [] as string[], deja: 0 };

    // Une transaction par attestation serait plus tolérante, mais l'unicité
    // est ici tenue par l'index : `onConflictDoNothing` rend le geste
    // idempotent sans perdre les autres.
    const inserees = await tx.insert(attestationsSapTable).values(
      plan.attestations.map((a) => ({
        tenantId, clientId: a.clientId, annee: a.annee,
        montantEligibleCents: a.montantEligibleCents, aidesCents: a.aidesCents,
      })),
    ).onConflictDoNothing().returning({ clientId: attestationsSapTable.clientId });

    return {
      plan, prestataire,
      creees: inserees.map((i) => i.clientId),
      deja: plan.attestations.length - inserees.length,
    };
  });

  if (resultat.plan.bloquants.length > 0) {
    res.status(422).json({
      error: resultat.plan.bloquants[0],
      bloquants: resultat.plan.bloquants,
      // Le nombre de clients CONCERNÉS est rendu malgré le refus : c'est lui
      // qui motive à compléter le profil.
      clientsConcernes: resultat.plan.attestations.length,
    });
    return;
  }

  res.status(201).json({
    annee,
    creees: resultat.creees.length,
    dejaGenerees: resultat.deja,
    ecartes: resultat.plan.ecartes,
  });
});

/** GET /attestations-sap?annee= — ce qui a été généré, sans les documents. */
router.get("/attestations-sap", async (req, res): Promise<void> => {
  const annee = Number(req.query["annee"]);
  const tenantId = req.tenantId!;
  const lignes = await withTenant(tenantId, (tx) =>
    tx.select().from(attestationsSapTable).where(
      Number.isFinite(annee) ? eq(attestationsSapTable.annee, annee) : undefined,
    ),
  );
  res.json(lignes);
});

/**
 * GET /attestations-sap/:id/pdf — le document d'un client.
 *
 * Reconstruit depuis les montants FIGÉS en base, jamais recalculé depuis les
 * encaissements : une attestation régénérée doit afficher exactement le chiffre
 * déjà transmis au client et à l'administration.
 */
router.get("/attestations-sap/:id/pdf", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const donnees = await withTenant(tenantId, async (tx) => {
    const [a] = await tx.select().from(attestationsSapTable)
      .where(eq(attestationsSapTable.id, req.params["id"]!));
    if (!a) return null;
    const [c] = await tx.select().from(clientsTable)
      .where(eq(clientsTable.id, a.clientId));
    return { a, c, prestataire: await prestataireDuTenant(tx) };
  });

  if (donnees === null) { res.status(404).json({ error: "Attestation introuvable." }); return; }
  const { a, c, prestataire } = donnees;

  const pdf = await genererAttestationSapPdf({
    clientId: a.clientId,
    clientNom: c?.nom ?? "Client",
    clientAdresse: [c?.adresse, c?.codePostal, c?.ville].filter(Boolean).join(", ") || null,
    annee: a.annee,
    montantEligibleCents: a.montantEligibleCents,
    aidesCents: a.aidesCents,
    totalEncaisseCents: a.montantEligibleCents + a.aidesCents,
    nombreEncaissements: 0,
  }, prestataire, aujourdhuiIso());

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition",
    `attachment; filename="attestation-${a.annee}-${a.clientId}.pdf"`);
  res.send(pdf);
});

export default router;
