import { Router, type IRouter } from "express";
import { attestationsSapTable, withTenant, activityTable, affairesTable, facturesTable, prospectsTable, pendingActionsTable, settingsTable, teamMembersTable, teamMemberHabilitationsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { toDateString, verticalPack, estRetardSignificatif, statutHabilitation, rappelAttestation, type Vertical } from "@nodaq/shared";
import { conditionFactureEnRetardSql } from "../lib/facturesEnRetard.js";
import { verticalDepuisTx } from "../lib/vertical-tenant.js";

const router: IRouter = Router();


router.get("/brief", async (req, res): Promise<void> => {
  const today = new Date();
  const todayStr = toDateString(today);
  const tenantId = req.tenantId!;

  const data = await withTenant(tenantId, async (tx) => {
    // Même définition que `factures.ts`/`cockpit.ts` (`facturesEnRetard.ts`) —
    // `settled = false` (champ legacy, "kept for backward compat" selon le
    // schéma) divergeait de `statut`, désormais autoritaire. Pas de `.limit`
    // ici : le tri par sévérité ci-dessous doit porter sur l'ensemble des
    // factures en retard, pas sur 5 lignes arbitraires déjà tronquées.
    const overdueFacturesToutes = await tx
      .select()
      .from(facturesTable)
      .where(conditionFactureEnRetardSql(todayStr));

    const vertical = await verticalDepuisTx(tx);
    const delaiPaiementUsuelJours = verticalPack(vertical).delaiPaiementUsuelJours;

    // US-A3.1 : les factures en retard SIGNIFICATIF (au-delà du délai usuel
    // du secteur) en tête — le brief matin doit attirer l'œil sur ce qui
    // dépasse le cycle normal de l'artisan, pas sur toute échéance à peine
    // dépassée pour un profil B2B à délai standard.
    const overdueFactures = overdueFacturesToutes
      .map(f => ({ f, significatif: estRetardSignificatif(f.dueDate, todayStr, delaiPaiementUsuelJours) }))
      .sort((a, b) => (a.significatif === b.significatif ? 0 : a.significatif ? -1 : 1) || (a.f.dueDate < b.f.dueDate ? -1 : 1))
      .slice(0, 5);

    const affairesEnCours = await tx
      .select()
      .from(affairesTable)
      .where(eq(affairesTable.status, "EN_COURS"))
      .limit(5);

    /*
     * ── CE QUE L'ÉQUIPE A FAIT ────────────────────────────────────────────
     * Décision du fondateur le 29/08/2026 : tout remonte ICI, dans le brief,
     * SANS notification. Seuls les actes qui engagent — devis, factures,
     * avoirs — méritent d'interrompre quelqu'un. Un patron qui reçoit quinze
     * alertes par jour n'en lit aucune.
     *
     * Seules les lignes portant un AUTEUR sont retenues : une activité sans
     * auteur est le fait du système (renouvellement d'abonnement, objectif
     * franchi), et « nodaq a créé une affaire » n'apprend rien à personne.
     */
    const activiteEquipe = await tx
      .select({
        label: activityTable.label,
        type: activityTable.type,
        auteurNom: activityTable.auteurNom,
        creeLe: activityTable.createdAt,
      })
      .from(activityTable)
      .where(sql`auteur_user_id IS NOT NULL AND created_at >= now() - interval '24 hours'`)
      .orderBy(desc(activityTable.createdAt))
      .limit(12);

    const newProspects = await tx
      .select()
      .from(prospectsTable)
      .where(sql`created_at >= now() - interval '7 days' AND stage NOT IN ('GAGNE', 'PERDU')`)
      .limit(5);

    const pendingActions = await tx
      .select()
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.status, "EN_ATTENTE"))
      .limit(5);

    // US-A4.4 : aucun scheduler dans ce dépôt — le statut d'expiration est
    // recalculé à chaque visite du brief, jamais poussé par un job de fond.
    const habilitationsRows = await tx
      .select({
        membreNom: teamMembersTable.name,
        libelle: teamMemberHabilitationsTable.libelle,
        dateExpiration: teamMemberHabilitationsTable.dateExpiration,
      })
      .from(teamMemberHabilitationsTable)
      .innerJoin(teamMembersTable, eq(teamMemberHabilitationsTable.membreId, teamMembersTable.id));

    // US-B4.1 — le rappel de l'attestation fiscale. Les ANNÉES déjà générées
    // suffisent : le rappel se tait dès qu'une génération a eu lieu, il n'a
    // pas à savoir combien de clients elle a couverts.
    const anneesAttestees = await tx
      .selectDistinct({ annee: attestationsSapTable.annee })
      .from(attestationsSapTable);

    return {
      overdueFactures, affairesEnCours, newProspects, activiteEquipe, pendingActions, habilitationsRows,
      anneesAttestees: anneesAttestees.map((a) => a.annee),
      vertical: await verticalDepuisTx(tx),
    };
  });

  const hour = today.getHours();
  const greeting = hour < 12
    ? `Bonjour — voici votre point du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`
    : `Bonsoir — voici votre récapitulatif du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`;

  const fmt = (cents: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

  // US-A4.4 : seules EXPIREE/BIENTOT_EXPIREE remontent — VALIDE et
  // SANS_EXPIRATION n'ont rien à signaler ce matin.
  const habilitationsASurveiller = data.habilitationsRows
    .map(h => ({ ...h, statut: statutHabilitation(h.dateExpiration, todayStr) }))
    .filter(h => h.statut === "EXPIREE" || h.statut === "BIENTOT_EXPIREE")
    .sort((a, b) => (a.statut === b.statut ? 0 : a.statut === "EXPIREE" ? -1 : 1))
    .slice(0, 5);

  const sections = [];

  if (data.overdueFactures.length > 0) {
    sections.push({
      type: "overdue",
      title: `${data.overdueFactures.length} facture${data.overdueFactures.length > 1 ? "s" : ""} en retard`,
      items: data.overdueFactures.map(({ f, significatif }) => ({
        label: `${f.customerName} — ${f.number}`,
        meta: fmt(f.amountCents),
        // US-A3.1 : urgent uniquement pour un retard qui dépasse le délai
        // usuel du secteur — pas toute facture simplement échue.
        urgent: significatif,
        link: "/factures",
      })),
    });
  }

  // ── US-B4.1 — le rappel proactif de l'attestation fiscale ──────────────
  // « Étant donné l'approche de cette échéance, alors un rappel proactif est
  // adressé au tenant s'il n'a pas encore lancé la génération. »
  //
  // Réservé aux services à la personne : c'est le seul secteur où cette
  // obligation existe, et l'afficher à un maçon serait du bruit qui apprend à
  // ignorer le brief.
  if (data.vertical === "services_personne") {
    const rappel = rappelAttestation(todayStr, data.anneesAttestees);
    if (rappel?.alerter) {
      const enRetard = rappel.joursRestants < 0;
      sections.push({
        type: "attestation_sap",
        title: enRetard
          ? `Attestations fiscales ${rappel.annee} : ${-rappel.joursRestants} jours de retard`
          : `Attestations fiscales ${rappel.annee} : ${rappel.joursRestants} jours restants`,
        items: [{
          // Le montant du crédit d'impôt est ce qui rend l'échéance concrète :
          // « avant le 31 mars » est une date, « vos clients perdent la moitié
          // de ce qu'ils vous ont payé » est une raison d'agir.
          label: "Vos clients en ont besoin pour leur crédit d'impôt de 50 %",
          meta: enRetard
            ? `l'envoi était dû le 31 mars ${rappel.annee + 1}`
            : `à envoyer avant le 31 mars ${rappel.annee + 1}`,
          urgent: rappel.joursRestants <= 30,
          link: "/parametres",
        }],
      });
    }
  }

  if (habilitationsASurveiller.length > 0) {
    sections.push({
      type: "habilitations",
      title: `${habilitationsASurveiller.length} habilitation${habilitationsASurveiller.length > 1 ? "s" : ""} à surveiller`,
      items: habilitationsASurveiller.map(h => ({
        label: `${h.membreNom} — ${h.libelle}`,
        meta: h.dateExpiration ? `expire le ${h.dateExpiration}` : null,
        urgent: h.statut === "EXPIREE",
        link: "/equipe",
      })),
    });
  }

  if (data.affairesEnCours.length > 0) {
    sections.push({
      type: "deadlines",
      title: "Affaires en cours",
      items: data.affairesEnCours.map(a => ({
        label: a.label,
        meta: a.clientName ?? null,
        urgent: false,
        link: `/affaires`,
      })),
    });
  }

  if (data.pendingActions.length > 0) {
    sections.push({
      type: "actions",
      title: `${data.pendingActions.length} action${data.pendingActions.length > 1 ? "s" : ""} à valider`,
      items: data.pendingActions.map(a => ({
        label: a.label,
        meta: a.amountCents ? fmt(a.amountCents) : null,
        urgent: true,
        link: "/",
      })),
    });
  }

  if (data.newProspects.length > 0) {
    sections.push({
      type: "prospects",
      title: "Prospects actifs",
      items: data.newProspects.map(p => ({
        label: p.name,
        meta: p.companyName ?? p.stage,
        urgent: false,
        link: "/prospects",
      })),
    });
  }

  /*
   * L'équipe, en fin de brief : ce n'est pas une urgence, c'est de
   * l'information. Les urgences (impayés, habilitations) sont plus haut, et
   * cette section ne porte donc AUCUN `urgent: true` — sinon elle diluerait
   * ce qui doit vraiment attirer l'œil.
   */
  if (data.activiteEquipe.length > 0) {
    sections.push({
      type: "equipe",
      title: `Votre équipe — ${data.activiteEquipe.length} action${data.activiteEquipe.length > 1 ? "s" : ""} depuis hier`,
      items: data.activiteEquipe.map((a) => ({
        label: a.label,
        // Le nom copié au moment des faits : un départ n'efface pas
        // l'historique. Voir la migration 067.
        meta: a.auteurNom ?? "un membre de l'équipe",
        urgent: false,
        link: "/activite",
      })),
    });
  }

  if (sections.length === 0) {
    sections.push({
      type: "summary",
      title: "Tout est en ordre",
      items: [{ label: "Aucune action urgente aujourd'hui.", meta: null, urgent: false, link: null }],
    });
  }

  res.json({ date: todayStr, greeting, sections });
});

export default router;
