/*
 * L'état d'une invitation — ticket 4.27.
 *
 * ── Le défaut qu'il ferme ─────────────────────────────────────────────────
 * Verbatim de la session de test du 22/08 : « quand j'invite un comptable, je
 * check la boîte mail, aucune invitation n'apparaît même dans les spams ».
 *
 * Ce que l'audit du 23/08 avait sous-estimé : l'échec ÉTAIT déjà capté. Chaque
 * tentative d'envoi est journalisée dans `envois_journal` — statut, motif,
 * horodatage — en append-only. La donnée existait ; c'est l'écran qui ne la
 * montrait pas. Rien ne disait à l'utilisateur que rien n'était parti.
 *
 * ── L'état est DÉRIVÉ, jamais stocké ──────────────────────────────────────
 * Il n'y a pas de colonne `statut`. Un état stocké se désynchronise de ses
 * causes : on accepte l'invitation et on oublie de passer le statut, ou
 * l'inverse. Ici l'état est une LECTURE de quatre faits qui, eux, sont
 * datés et immuables — acceptée, ouverte, expirée, dernier envoi.
 *
 * ── L'ordre de priorité n'est pas arbitraire ──────────────────────────────
 * Une invitation acceptée reste acceptée même si son lien a expiré depuis.
 * Une invitation ouverte l'a forcément été après un envoi réussi. Le calcul
 * va donc du plus définitif au plus provisoire, et jamais l'inverse.
 */

export const ETATS_INVITATION = [
  "ACCEPTEE", "EXPIREE", "OUVERTE", "ENVOYEE", "ECHOUEE", "EN_ATTENTE",
] as const;
export type EtatInvitation = (typeof ETATS_INVITATION)[number];

/** Les faits datés d'où l'état se déduit. Aucun n'est un statut. */
export interface FaitsInvitation {
  readonly acceptedAt: string | Date | null | undefined;
  readonly openedAt: string | Date | null | undefined;
  readonly expiresAt: string | Date;
  /** Le dernier envoi tenté, tel que `envois_journal` le porte. */
  readonly dernierEnvoi: { readonly statut: string; readonly erreur?: string | null } | null | undefined;
}

const instant = (v: string | Date | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

export function etatInvitation(f: FaitsInvitation, maintenant: Date = new Date()): EtatInvitation {
  // Définitif : une invitation acceptée l'est pour toujours, quelle que soit
  // la date d'expiration de son lien.
  if (instant(f.acceptedAt) !== null) return "ACCEPTEE";

  // Un échec d'envoi PRIME sur l'expiration : dire « expirée » d'un courrier
  // qui n'est jamais parti enverrait l'utilisateur corriger la mauvaise
  // chose. Ce qu'il doit voir, c'est que rien n'a été envoyé.
  if (f.dernierEnvoi && f.dernierEnvoi.statut !== "envoye") return "ECHOUEE";

  const fin = instant(f.expiresAt);
  if (fin !== null && fin <= maintenant.getTime()) return "EXPIREE";

  // Ouverte : le destinataire a suivi le lien. Daté par un clic, jamais par
  // un pixel de suivi.
  if (instant(f.openedAt) !== null) return "OUVERTE";

  if (f.dernierEnvoi) return "ENVOYEE";

  // Aucun envoi tenté : l'invitation existe en base et rien n'est parti. Cas
  // réel — la création de l'invitation et son envoi sont deux opérations.
  return "EN_ATTENTE";
}

/**
 * Ce que l'écran affiche. Français, sans jargon, et sans point final : ce sont
 * des étiquettes, pas des phrases (glossaire, ticket 4.29).
 */
export const LIBELLE_ETAT: Readonly<Record<EtatInvitation, string>> = {
  ACCEPTEE: "Invitation acceptée",
  EXPIREE: "Lien expiré",
  OUVERTE: "Lien ouvert",
  ENVOYEE: "Courrier envoyé",
  ECHOUEE: "Le courrier n'est pas parti",
  EN_ATTENTE: "Pas encore envoyée",
};

/**
 * Ce que l'utilisateur peut FAIRE, pour chaque état.
 *
 * Rendu ici et non à l'écran : un bouton « Renvoyer » proposé sur une
 * invitation déjà acceptée est une action qui casse un accès qui marche.
 */
export function actionsPossibles(etat: EtatInvitation): {
  readonly renvoyer: boolean;
  readonly copierLien: boolean;
} {
  // Une invitation acceptée ne se renvoie pas : le renvoi remplace le jeton,
  // ce qui n'aurait aucun effet sur un accès déjà ouvert — mais laisserait
  // croire le contraire.
  if (etat === "ACCEPTEE") return { renvoyer: false, copierLien: false };
  return { renvoyer: true, copierLien: true };
}

/**
 * La phrase qui explique un état, quand il en faut une.
 *
 * `null` pour les états qui se suffisent : « Invitation acceptée » n'a besoin
 * d'aucun commentaire, et en ajouter un ferait du bruit.
 */
export function explicationEtat(etat: EtatInvitation, motifEchec?: string | null): string | null {
  switch (etat) {
    case "ECHOUEE":
      // Le motif technique EST utile ici — c'est lui qui distingue « boîte
      // pleine » de « aucun serveur d'envoi configuré », deux problèmes qui
      // ne se corrigent pas au même endroit.
      return motifEchec
        ? `Le courrier n'a pas pu partir : ${motifEchec}. Renvoyez, ou copiez le lien et transmettez-le vous-même.`
        : "Le courrier n'a pas pu partir. Renvoyez, ou copiez le lien et transmettez-le vous-même.";
    case "EXPIREE":
      return "Le lien a dépassé ses sept jours. Renvoyez pour en créer un nouveau.";
    case "EN_ATTENTE":
      return "L'invitation est créée mais aucun courrier n'est parti. Renvoyez, ou copiez le lien.";
    case "ENVOYEE":
      return "Le courrier est parti. Tant qu'il n'est pas ouvert, pensez à vérifier les indésirables.";
    case "OUVERTE":
      return "Le lien a été ouvert, mais le compte n'est pas encore créé.";
    case "ACCEPTEE":
      return null;
  }
}

/**
 * Ce qu'il faut dire quand on renvoie une invitation.
 *
 * Le renvoi REMPLACE le jeton : seul son condensat est conservé en base, le
 * lien d'origine est irrécupérable. L'ancien cesse donc de fonctionner, et
 * quelqu'un qui l'aurait déjà transmis doit le savoir.
 */
export const AVERTISSEMENT_RENVOI =
  "Un nouveau lien va être créé. Si vous aviez déjà transmis le précédent, "
  + "il cessera de fonctionner.";
