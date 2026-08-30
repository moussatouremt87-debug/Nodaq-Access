/**
 * Le NIVEAU 2 du support — regarder, jamais toucher.
 *
 * ── CE QUI SÉPARE LE NIVEAU 1 DU NIVEAU 2 ───────────────────────────────────
 *
 * Le niveau 1 récite la procédure : « pour émettre, écran Factures, bouton
 * Émettre ». Utile, et insuffisant quand ça ne marche pas.
 *
 * Le niveau 2 REGARDE la situation réelle de l'artisan et dit pourquoi ça
 * coince. Ces trois diagnostics viennent d'incidents vécus les 29 et 30/08 —
 * chacun avait coûté une interrogation manuelle de la base de production :
 *
 *   « je ne reçois pas mon code »     → parti à contac@nodaq.fr, un « t » manque
 *   « mon Cockpit affiche 0 chantier » → 4 chantiers en ACCEPTEE, compteur EN_COURS
 *   « ma facture refuse de s'émettre » → attestation TVA manquante à 10 %
 *
 * ── LECTURE SEULE, ET C'EST STRUCTUREL ──────────────────────────────────────
 *
 * Aucune de ces fonctions n'écrit. Elles passent toutes par `withTenant`, donc
 * la sécurité au niveau des lignes s'applique : l'artisan ne voit que SES
 * données, jamais celles d'un autre. Un support qui pourrait écrire serait un
 * chemin d'écriture hors du parcours de validation de la règle 4 ; il n'en
 * existe pas ici.
 *
 * ── CE QU'ELLES NE RENVOIENT PAS ────────────────────────────────────────────
 *
 * Ni corps de message, ni IBAN, ni libellé d'opération, ni secret — même
 * tronqué (règle 6). Un diagnostic dit un ÉTAT, pas un contenu.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  withTenant, facturesTable, affairesTable, envoisJournalTable,
} from "@workspace/db";
import { estAffaireActive, STATUTS_AFFAIRE_ACTIVE } from "./affaire-active.js";

/** Pourquoi une facture refuse de s'émettre, dit en clair. */
export async function diagnosticFacture(
  tenantId: string,
  reference?: string,
): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async (tx) => {
    const lignes = await tx
      .select({
        number: facturesTable.number,
        statut: facturesTable.statut,
        issuedDate: facturesTable.issuedDate,
        dueDate: facturesTable.dueDate,
        totalHtCents: facturesTable.totalHTCents,
        attestation: facturesTable.attestationTvaFournie,
        lines: facturesTable.lines,
      })
      .from(facturesTable)
      .orderBy(desc(facturesTable.createdAt))
      .limit(reference ? 50 : 5);

    const visees = reference
      ? lignes.filter((f) => (f.number ?? "").includes(reference))
      : lignes;

    return {
      trouvees: visees.length,
      factures: visees.slice(0, 5).map((f) => {
        const tauxReduit = (f.lines as Array<{ vatRate?: number }> | null ?? [])
          .some((l) => l.vatRate === 10 || l.vatRate === 5.5);
        return {
          numero: f.number || "(brouillon sans numéro)",
          statut: f.statut,
          // LE blocage le plus fréquent, et celui qui ne se devine pas.
          blocageEmission:
            f.statut === "BROUILLON" && tauxReduit && !f.attestation
              ? "Ligne à taux réduit (10 % ou 5,5 %) sans attestation TVA cochée. "
                + "L'émission restera refusée tant que la case n'est pas cochée sur la facture."
              : null,
          dateEmission: f.issuedDate,
          echeance: f.dueDate,
        };
      }),
    };
  });
}

/** Pourquoi un compteur de chantiers affiche zéro. */
export async function diagnosticChantiers(tenantId: string): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async (tx) => {
    const lignes = await tx
      .select({ status: affairesTable.status, label: affairesTable.label })
      .from(affairesTable);
    const parStatut: Record<string, number> = {};
    for (const a of lignes) parStatut[a.status] = (parStatut[a.status] ?? 0) + 1;
    return {
      total: lignes.length,
      parStatut,
      actifs: lignes.filter((a) => estAffaireActive(a.status)).length,
      statutsComptesCommeActifs: STATUTS_AFFAIRE_ACTIVE,
    };
  });
}

/**
 * Où en est le dernier courriel — LE diagnostic qui aurait évité deux heures
 * le 30/08. Il rend le DESTINATAIRE, jamais le contenu du message.
 */
export async function diagnosticEnvois(
  tenantId: string,
  type?: string,
): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async (tx) => {
    const base = tx
      .select({
        documentType: envoisJournalTable.documentType,
        destinataire: envoisJournalTable.destinataire,
        mode: envoisJournalTable.mode,
        statut: envoisJournalTable.statut,
        erreur: envoisJournalTable.erreur,
        envoyeLe: envoisJournalTable.envoyeLe,
      })
      .from(envoisJournalTable)
      .orderBy(desc(envoisJournalTable.envoyeLe))
      .limit(8);
    const lignes = type
      ? await base.where(eq(envoisJournalTable.documentType, type))
      : await base;


    /*
     * ── LE CODE CONCLUT, LE MODÈLE FORMULE ─────────────────────────────────
     *
     * Première version : on rendait des champs techniques — `domaineVerifie:
     * false`, `configurationEnvoi: null` — en laissant le modèle en tirer une
     * cause. Il a inventé deux fois de suite, dont un bouton « Vérifier
     * l'adresse » qui n'existe nulle part.
     *
     * Ce n'est pas un défaut du modèle : c'est une faute de conception. Un
     * champ ambigu APPELLE une interprétation, et une interprétation plausible
     * est indiscernable d'un fait pour celui qui la lit.
     *
     * La conclusion est donc calculée ICI, en TypeScript, à partir de règles
     * qu'on peut relire. Le modèle n'a plus qu'à la dire avec ses mots — même
     * partage que pour les montants (règle 3).
     */
    const echecs = lignes.filter((l) => l.statut !== "envoye");
    const conclusion =
      lignes.length === 0
        ? "AUCUN courriel n'a été tenté pour ce type. Le problème est EN AMONT de "
          + "l'envoi : le message n'a jamais été demandé. Ce n'est ni la messagerie, "
          + "ni la configuration d'envoi, et il n'y a rien à reconfigurer."
        : echecs.length > 0
          ? `L'envoi a ÉCHOUÉ. Motif rendu par le serveur de messagerie : `
            + `${echecs[0]!.erreur ?? "non précisé"}.`
          : `Le courriel est bien PARTI, à l'adresse ${lignes[0]!.destinataire}. `
            + "S'il n'est pas arrivé : vérifier d'abord l'orthographe de cette "
            + "adresse caractère par caractère, puis le dossier des indésirables.";

    return {
      conclusion,
      derniersEnvois: lignes.map((l) => ({
        type: l.documentType,
        // Rendu EN ENTIER, délibérément : c'est une coquille d'adresse qui a
        // coûté deux heures le 30/08, et un masque l'aurait cachée une fois de
        // plus.
        destinataire: l.destinataire,
        statut: l.statut,
        motif: l.erreur ?? null,
        quand: l.envoyeLe,
      })),
    };
  });
}

/** Les impayés, pour « pourquoi ce montant ? » — sans recalculer quoi que ce soit. */
export async function diagnosticImpayes(tenantId: string): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT statut, count(*)::int AS nombre
        FROM factures
       GROUP BY statut
    `);
    return {
      repartitionParStatut: r.rows,
      rappel:
        "Un BROUILLON n'est dû par personne : il n'entre ni dans les impayés ni "
        + "dans le chiffre d'affaires tant qu'il n'est pas émis.",
    };
  });
}

/**
 * ── NIVEAU 3 : LA TRANSMISSION, AUTOMATIQUE ET BORNÉE ───────────────────────
 *
 * C'est une EXCEPTION à la règle 4, décidée le 30/08/2026 : ce courriel part
 * sans validation humaine.
 *
 * La règle 4 protège contre un agent qui agirait sur le MÉTIER de l'artisan —
 * envoyer un devis à un client, émettre une facture. Ici, rien de tel : le
 * message part chez l'éditeur, à la demande explicite de quelqu'un qui vient
 * de demander de l'aide. Exiger un clic de plus ferait abandonner celui qui
 * est déjà bloqué.
 *
 * L'exception est rendue inoffensive par sa FORME, pas par une promesse :
 *
 *   — le destinataire n'est PAS un paramètre. Le modèle ne peut pas le
 *     choisir : il vient de `SUPPORT_ESCALADE_EMAIL`, et de nulle part
 *     ailleurs. Aucune formulation ne lui fera écrire à un client ;
 *   — le second courriel part à l'adresse de l'utilisateur CONNECTÉ, lue dans
 *     la session, jamais dans le texte de la conversation ;
 *   — aucun document métier n'est joint.
 *
 * Trois tests figent ces trois propriétés. Les retirer demanderait de les
 * faire rougir, donc d'y penser.
 */
export const OUTIL_TRANSMISSION = {
  type: "function" as const,
  function: {
    name: "transmettre_a_l_equipe",
    description:
      "Transmet le problème à l'équipe nodaq et prévient l'utilisateur par courriel. "
      + "À utiliser quand le diagnostic ne suffit pas, ou que l'utilisateur demande "
      + "de l'aide humaine. Ne demande AUCUNE adresse : elles sont connues.",
    parameters: {
      type: "object",
      properties: {
        resume: {
          type: "string",
          description:
            "Le problème en quelques lignes, avec ce qui a déjà été vérifié et trouvé. "
            + "C'est ce que lira l'équipe : sois précis, cite les états constatés.",
        },
      },
      required: ["resume"],
    },
  },
};

/** La déclaration des outils, telle que le modèle la reçoit. */
export const OUTILS_DIAGNOSTIC = [
  {
    type: "function" as const,
    function: {
      name: "diagnostic_facture",
      description:
        "Regarde les factures de l'entreprise et dit pourquoi l'une refuse de s'émettre. "
        + "À utiliser dès que l'utilisateur signale un blocage sur une facture.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Numéro ou fragment de numéro. Facultatif." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "diagnostic_chantiers",
      description:
        "Compte les chantiers par statut. À utiliser quand un compteur de chantiers "
        + "semble faux ou vide.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "diagnostic_envois",
      description:
        "Rend les derniers courriels partis, avec leur destinataire et leur statut. "
        + "À utiliser dès que l'utilisateur dit ne pas avoir reçu quelque chose.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "DEVIS, FACTURE, INVITATION, CODE_CONNEXION. Facultatif." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "diagnostic_impayes",
      description:
        "Répartit les factures par statut. À utiliser quand un montant d'impayés "
        + "ou de chiffre d'affaires surprend l'utilisateur.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/** Exécute un outil de diagnostic. Aucun n'écrit — c'est vérifié par un test. */
export async function executerDiagnostic(
  tenantId: string,
  nom: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (nom) {
    case "diagnostic_facture":
      return diagnosticFacture(tenantId, typeof args["reference"] === "string" ? args["reference"] : undefined);
    case "diagnostic_chantiers":
      return diagnosticChantiers(tenantId);
    case "diagnostic_envois":
      return diagnosticEnvois(tenantId, typeof args["type"] === "string" ? args["type"] : undefined);
    case "diagnostic_impayes":
      return diagnosticImpayes(tenantId);
    default:
      return { erreur: `Diagnostic inconnu : ${nom}` };
  }
}

/** Ce que l'appelant doit fournir — jamais une adresse, jamais un destinataire. */
export interface ContexteTransmission {
  readonly tenantId: string;
  /** L'adresse de l'utilisateur CONNECTÉ, lue dans la session. */
  readonly emailUtilisateur: string;
  readonly role: string;
  readonly historique: readonly { role: string; contenu: string }[];
}

export interface ResultatTransmission {
  readonly transmis: boolean;
  readonly reference?: string;
  readonly motif?: string;
}

/**
 * Transmet à l'équipe, et prévient l'utilisateur. Deux courriels, deux
 * destinataires, aucun des deux choisi par le modèle.
 */
export async function transmettreALEquipe(
  ctx: ContexteTransmission,
  resume: string,
  envoyer: (opts: { to: string; subject: string; body: string; tenantId: string }) => Promise<boolean>,
): Promise<ResultatTransmission> {
  const equipe = process.env["SUPPORT_ESCALADE_EMAIL"]?.trim();
  if (!equipe) {
    // Aucune valeur par défaut : une adresse devinée enverrait le dossier dans
    // le vide, et l'artisan croirait avoir alerté quelqu'un.
    return { transmis: false, motif: "SUPPORT_ESCALADE_EMAIL n'est pas configurée." };
  }

  const reference = `SUP-${Date.now().toString(36).toUpperCase()}`;

  const dossier = [
    `Référence   : ${reference}`,
    `Entreprise  : ${ctx.tenantId}`,
    `Utilisateur : ${ctx.emailUtilisateur} (${ctx.role})`,
    ``,
    `── Ce que l'assistant a établi ──`,
    resume,
    ``,
    `── L'échange complet ──`,
    ...ctx.historique.map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.contenu}`),
  ].join("\n");

  const versEquipe = await envoyer({
    tenantId: ctx.tenantId,
    to: equipe,
    subject: `[nodaq] ${reference} — ${resume.split("\n")[0]?.slice(0, 70) ?? "demande d'aide"}`,
    body: dossier,
  });
  if (!versEquipe) {
    // Dire l'échec. Un « c'est transmis » qui ment laisse quelqu'un attendre
    // une réponse qui ne viendra jamais.
    return { transmis: false, motif: "L'envoi vers l'équipe a échoué." };
  }

  // L'accusé de réception. Il part à l'adresse de la SESSION, jamais à une
  // adresse trouvée dans la conversation — sans quoi une phrase bien tournée
  // ferait écrire l'assistant à n'importe qui.
  await envoyer({
    tenantId: ctx.tenantId,
    to: ctx.emailUtilisateur,
    subject: `Votre demande d'aide nodaq — ${reference}`,
    body: [
      `Bonjour,`,
      ``,
      `Nous avons bien reçu votre demande et nous nous en occupons.`,
      `Votre référence : ${reference}`,
      ``,
      `Nous revenons vers vous à cette adresse. Inutile de renvoyer votre message :`,
      `il est déjà entre nos mains, avec tout ce que l'assistant a vérifié.`,
      ``,
      `L'équipe nodaq`,
    ].join("\n"),
  });

  return { transmis: true, reference };
}
