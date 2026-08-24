/*
 * La frontière du produit en secteur santé — US-B9.4.
 *
 * ── Ce que cette story demande, et qui est inhabituel ─────────────────────
 * Ce n'est PAS une fonctionnalité à ajouter : c'est une limite de périmètre
 * volontaire, et la story insiste pour qu'elle soit « imposée par la structure
 * même des champs disponibles plutôt que par un simple principe d'usage ».
 *
 * Autrement dit : un praticien ne doit pas POUVOIR saisir un diagnostic, même
 * s'il le voulait. Une consigne dans une aide en ligne ne suffit pas — elle se
 * contourne par la bande, et ce qui se contourne finit en base.
 *
 * ── L'enjeu, en clair ─────────────────────────────────────────────────────
 * Héberger des données de santé au sens de l'article L.1111-8 du code de la
 * santé publique impose une certification HDS, qui est hors du périmètre
 * actuel de l'infrastructure. Le risque n'est donc pas une gêne : c'est une
 * obligation réglementaire que nodaq ne peut pas tenir aujourd'hui.
 *
 * ── LA RÉSERVE, à ne pas effacer ──────────────────────────────────────────
 * La story le dit elle-même, et il faut que ce fichier le porte :
 *
 *   « La frontière HDS/non-HDS n'est tranchée noir sur blanc par aucun texte
 *   officiel identifié à ce jour (art. L.1111-8 CSP et référentiel HDS v2,
 *   échéance de mise en conformité au 16/05/2026, définissent le périmètre par
 *   la nature prévention/diagnostic/soins des données, sans liste explicite
 *   d'exclusion administrative) — la lecture "hors HDS" retenue ici est une
 *   position défendable mais NON CERTAINE juridiquement ; à faire trancher
 *   formellement par un avocat spécialisé santé/CNIL avant tout déploiement
 *   réel en secteur de santé. »
 *
 * Ce module applique la contrainte dure décidée le 24/08/2026. Il ne
 * remplace pas cet avis juridique, et le fait qu'il existe ne doit pas laisser
 * croire que la question est réglée.
 */

/** Les secteurs où la contrainte s'applique. */
export const VERTICALS_SANTE = ["sante_liberale"] as const;

export function estSecteurSante(vertical: string | null | undefined): boolean {
  return (VERTICALS_SANTE as readonly string[]).includes(vertical ?? "");
}

/**
 * Les zones de texte libre RATTACHÉES À UNE PERSONNE.
 *
 * ── Pourquoi une liste par CHEMIN, et pas par nom de champ ────────────────
 * `notes` existe aussi sur `charges_recurrentes` (les charges de l'entreprise)
 * et `description` sur `connectors` (de la configuration technique). Aucune de
 * ces deux zones ne peut recevoir de donnée clinique, et les bloquer aurait
 * cassé la comptabilité et les réglages sans rien protéger.
 *
 * La liste est donc indexée sur le chemin de la ressource. Le mode de
 * défaillance est le bon sens inverse de `ECRANS_TIERS_LECTURE` : ici, un
 * routeur oublié reste OUVERT. C'est pourquoi une garde structurelle
 * (`perimetre-sante-exhaustif.test.ts`) énumère les colonnes de texte du
 * schéma et exige que chacune soit soit bloquée, soit exemptée avec un motif.
 */
export const ZONES_LIBRES_PATIENT: readonly { readonly chemin: string; readonly champs: readonly string[] }[] = [
  { chemin: "/clients", champs: ["notes"] },
  { chemin: "/prospects", champs: ["notes"] },
  { chemin: "/affaires", champs: ["notes"] },
  { chemin: "/devis", champs: ["notes"] },
  { chemin: "/factures", champs: ["notes"] },
  { chemin: "/contrats", champs: ["notes"] },
  { chemin: "/echeances", champs: ["notes"] },
  { chemin: "/pointages", champs: ["commentaire"] },
  { chemin: "/classeur", champs: ["notes"] },
];

/**
 * Les colonnes de texte du schéma qui NE sont pas rattachées à une personne,
 * avec le motif de leur exemption. Lue par la garde structurelle : une colonne
 * qui n'est ni bloquée ni listée ici fait échouer la CI.
 */
export const EXEMPTIONS_TEXTE_LIBRE: readonly { readonly table: string; readonly champ: string; readonly motif: string }[] = [
  { table: "charges_recurrentes", champ: "notes",
    motif: "charges de l'ENTREPRISE (loyer, assurance) — aucun patient n'y figure" },
  { table: "connectors", champ: "description",
    motif: "configuration technique d'un connecteur bancaire" },
  { table: "pending_actions", champ: "description",
    motif: "rédigée par le SERVEUR pour décrire une action à valider, jamais saisie" },
];

/**
 * Ce que l'utilisateur lit quand il bute sur la limite.
 *
 * Quatrième critère : « l'interface oriente explicitement vers un outil métier
 * de santé dédié et certifié HDS ». Le refus doit donc dire où aller — un
 * « champ non autorisé » sec laisserait croire à un défaut.
 *
 * Et il respecte la règle 3 bis a du dépôt : il exclut EXPLICITEMENT ce que
 * nodaq assure. Un refus rédigé trop largement attraperait le cœur du métier —
 * facturer une consultation reste la raison d'être du produit.
 */
export const MESSAGE_ORIENTATION_HDS =
  "nodaq gère l'administratif de votre cabinet — facturation, planning, trésorerie — " +
  "et rien de votre dossier patient. Cette zone de texte libre est fermée pour cette " +
  "raison : y noter un motif de consultation, un diagnostic ou un traitement ferait " +
  "de nodaq un hébergeur de données de santé, ce qu'il n'est pas et ne prétend pas " +
  "être. Ces informations ont leur place dans votre logiciel métier certifié HDS. " +
  "Vos devis, factures et encaissements, eux, continuent de fonctionner normalement.";

/** Les champs bloqués pour un chemin donné. Vide si la ressource est ouverte. */
export function champsBloquesSante(chemin: string): readonly string[] {
  const zone = ZONES_LIBRES_PATIENT.find(
    (z) => chemin === z.chemin || chemin.startsWith(`${z.chemin}/`),
  );
  return zone?.champs ?? [];
}

/**
 * Ce corps de requête porte-t-il du texte libre interdit ?
 *
 * Une chaîne VIDE n'est pas une violation : effacer une note est le geste
 * qu'on veut encourager, et le refuser empêcherait de nettoyer l'existant.
 */
export function texteLibreInterdit(
  chemin: string,
  corps: unknown,
): readonly string[] {
  const champs = champsBloquesSante(chemin);
  if (champs.length === 0 || corps === null || typeof corps !== "object") return [];
  const o = corps as Record<string, unknown>;
  return champs.filter((c) => typeof o[c] === "string" && (o[c] as string).trim() !== "");
}
