/*
 * Matérialiser les échéances d'un contrat en factures — US-A2.3.
 *
 * ── Une seule route, deux usages ──────────────────────────────────────────
 * `POST /contrats/facturer-echeances` traite TOUS les contrats actifs ; le
 * corps optionnel `{ contratId }` la restreint à un seul. Deux routes auraient
 * dupliqué la logique — et c'est justement la duplication qui laisse deux
 * chemins diverger sur ce qui compte : ce qui a déjà été facturé.
 *
 * ── L'idempotence appartient au moteur ────────────────────────────────────
 * `factures_contrat_echeance_idx` (migration 061) interdit deux factures pour
 * la même échéance du même contrat. Un double clic, une relance, deux onglets
 * ouverts : la seconde écriture est rejetée par PostgreSQL, pas par une
 * lecture préalable qui se contournerait par deux requêtes simultanées.
 *
 * La transaction est UNE par échéance, délibérément. Une transaction unique
 * pour tout le lot ferait perdre les onze premières factures parce que la
 * douzième est en doublon — alors que ces onze-là sont légitimes.
 */
import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withTenant, contratsTable, facturesTable, sitesTable } from "@workspace/db";
import { echeancesAFacturer, type Cadence, type EcheanceDue } from "@nodaq/shared";
import { z } from "zod";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";

const router: IRouter = Router();

const Corps = z.object({
  contratId: z.string().min(1).optional(),
  /** Le taux de TVA appliqué aux échéances. 20 % à défaut, comme ailleurs. */
  vatRate: z.number().min(0).max(100).default(20),
});

/**
 * Une date CIVILE, lue sur les composantes locales.
 *
 * Jamais `toISOString().slice(0, 10)` : cette fonction rend la date UTC, qui
 * n'est pas la date locale pendant une partie de chaque journée — et sous
 * Pacific/Auckland (UTC+12), la moitié du temps. Une garde du dépôt interdit
 * le motif, et elle a attrapé la première version de ce fichier.
 */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function aujourdhuiIso(): string {
  return isoLocal(new Date());
}

/**
 * L'échéance de paiement : trente jours après la date de facture.
 *
 * Construite et relue sur les composantes LOCALES, sans aller-retour par UTC.
 * `Date` gère le débordement de mois toute seule : le 25 août + 30 donne bien
 * le 24 septembre.
 */
function plus30(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  return isoLocal(new Date(a!, m! - 1, j! + 30));
}

/** Le doublon de l'index unique, reconnu à travers l'emballage de Drizzle. */
const estDoublon = (err: unknown, profondeur = 0): boolean => {
  if (err === null || typeof err !== "object" || profondeur > 5) return false;
  const o = err as { code?: string; message?: string; cause?: unknown };
  if (o.code === "23505") return true;
  if (typeof o.message === "string" && o.message.includes("factures_contrat_echeance_idx")) return true;
  return estDoublon(o.cause, profondeur + 1);
};

router.post("/contrats/facturer-echeances", async (req, res): Promise<void> => {
  const parsed = Corps.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { contratId, vatRate } = parsed.data;
  const tenantId = req.tenantId!;
  const aujourdhui = aujourdhuiIso();

  // ── 1. Ce qui est dû ────────────────────────────────────────────────────
  const plan = await withTenant(tenantId, async (tx) => {
    const contrats = await tx.select().from(contratsTable).where(
      contratId ? eq(contratsTable.id, contratId) : undefined,
    );
    if (contrats.length === 0) return null;

    // Les échéances déjà facturées, en UNE requête pour tout le lot.
    const dejaParContrat = new Map<string, string[]>();
    const lignes = await tx
      .select({ contratId: facturesTable.contratId, echeanceLe: facturesTable.echeanceLe })
      .from(facturesTable)
      .where(and(
        isNotNull(facturesTable.contratId),
        inArray(facturesTable.contratId, contrats.map((c) => c.id)),
      ));
    for (const l of lignes) {
      if (l.contratId === null || l.echeanceLe === null) continue;
      const acc = dejaParContrat.get(l.contratId) ?? [];
      acc.push(l.echeanceLe);
      dejaParContrat.set(l.contratId, acc);
    }

    // US-B7.1 — les sites ACTIFS, en UNE requête pour tout le lot. Un site
    // désactivé sort de la facturation sans perdre son historique.
    const sites = await tx.select().from(sitesTable).where(eq(sitesTable.actif, true));
    const sitesParContrat = new Map<string, typeof sites>();
    for (const s of sites) {
      if (s.contratId === null) continue;
      const acc = sitesParContrat.get(s.contratId) ?? [];
      acc.push(s);
      sitesParContrat.set(s.contratId, acc);
    }

    const dues: (EcheanceDue & { clientName: string | null })[] = [];
    const ecartes: { contratId: string; motif: string }[] = [];
    for (const c of contrats) {
      const r = echeancesAFacturer({
        id: c.id, label: c.label, cadence: c.cadence as Cadence,
        startDate: c.startDate, endDate: c.endDate, status: c.status,
        amountCents: c.amountCents,
        dejaFacturees: dejaParContrat.get(c.id) ?? [],
        sites: (sitesParContrat.get(c.id) ?? []).map((s) => ({
          id: s.id, libelle: s.libelle, montantCents: s.montantCents,
        })),
      }, aujourdhui);
      dues.push(...r.dues.map((d) => ({ ...d, clientName: c.clientName })));
      ecartes.push(...r.ecartes);
    }
    return { dues, ecartes };
  });

  if (plan === null) { res.status(404).json({ error: "Contrat introuvable." }); return; }

  // ── 2. La matérialisation, une transaction par échéance ─────────────────
  const creees: unknown[] = [];
  const doublons: string[] = [];
  for (const due of plan.dues) {
    const totalHTCents = due.montantCents;
    const totalTVACents = Math.round((totalHTCents * vatRate) / 100);
    try {
      const facture = await withTenant(tenantId, async (tx) => {
        const [f] = await tx.insert(facturesTable).values({
          tenantId,
          customerName: due.clientName ?? "Client",
          // Vide : le numéro est attribué à l'ÉMISSION. Générer n'est pas
          // envoyer, et un brouillon ne consomme aucun numéro de série.
          number: "",
          // ── La facture est datée d'AUJOURD'HUI, pas de l'échéance ───────
          // Deux raisons, et la seconde est disqualifiante :
          //
          // 1. Un brouillon dont l'échéance de paiement est dépassée compte
          //    « en retard » (`facturesEnRetard.ts`, assertion explicite). Un
          //    rattrapage de quatre mois ferait donc apparaître quatre
          //    factures en retard que le client n'a jamais reçues.
          // 2. Le numéro est attribué à l'ÉMISSION, donc aujourd'hui. Une
          //    facture numérotée aujourd'hui mais datée de mai briserait la
          //    chronologie numéro/date — un défaut de conformité, pas un
          //    détail d'affichage.
          //
          // La période facturée n'est pas perdue pour autant : elle vit dans
          // `echeance_le` et, en toutes lettres, dans le libellé de la ligne
          // (« Maintenance — mai 2026 »). C'est d'ailleurs ainsi que se
          // rattrape un abonnement en vrai : on facture aujourd'hui, et la
          // ligne dit quelle période.
          issuedDate: aujourdhui,
          dueDate: plus30(aujourdhui),
          amountCents: totalHTCents + totalTVACents,
          residualCents: totalHTCents + totalTVACents,
          settled: false,
          statut: "BROUILLON",
          // ── La facturation CONSOLIDÉE (US-B7.1) ──────────────────────
          // UNE facture, une ligne PAR SITE. Le client reçoit un document
          // qu'il peut vérifier agence par agence — ce qu'un total unique ne
          // permet pas, et c'est justement ce qu'un responsable de site
          // conteste quand il ne retrouve pas son montant.
          //
          // Un contrat mono-site rend une seule ligne : le même chemin, sans
          // cas particulier à maintenir.
          lines: due.lignes.map((l) => ({
            id: crypto.randomUUID(),
            description: l.libelle,
            quantity: 1,
            unitPriceCents: l.montantCents,
            vatRate,
            vatCategory: "S" as const,
          })),
          totalHTCents,
          totalTVACents,
          autoliquidation: false,
          contratId: due.contratId,
          echeanceLe: due.echeanceLe,
        }).returning();
        await indexerAuClasseur(tx, {
          tenantId, sourceType: "FACTURE", sourceId: f!.id,
          nom: nomAuClasseur("FACTURE", f!.number, f!.id),
          affaireId: null,
        });
        return f;
      });
      creees.push(facture);
    } catch (err) {
      // Un doublon n'est pas une erreur : c'est l'index qui fait son travail,
      // et le résultat voulu — cette échéance était déjà facturée.
      if (estDoublon(err)) { doublons.push(due.echeanceLe); continue; }
      throw err;
    }
  }

  res.status(201).json({
    factures: creees,
    // Le nombre d'échéances rattrapées, pour que l'écran puisse dire
    // « 3 factures créées » plutôt que d'afficher un succès muet.
    creees: creees.length,
    dejaFacturees: doublons.length,
    ecartes: plan.ecartes,
  });
});

export default router;
