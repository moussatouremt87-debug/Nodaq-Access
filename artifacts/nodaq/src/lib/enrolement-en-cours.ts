/**
 * L'enrôlement MFA en cours, conservé le temps d'aller chercher son code.
 *
 * ── Le défaut que ce module corrige ───────────────────────────────────────
 * Constaté sur un iPhone le 2026-08-20. Chaque affichage de l'écran MFA
 * demande un NOUVEAU secret au serveur. Sur ordinateur ça ne se voit pas : on
 * garde la page ouverte et on scanne le QR avec son téléphone.
 *
 * Sur téléphone, il faut QUITTER la page pour configurer l'authentificateur —
 * Réglages, ou l'application dédiée. Au retour, Safari recharge volontiers
 * l'onglet : le serveur émet une autre clé, et le code fraîchement configuré
 * est refusé. « Code incorrect », sans rien qui explique pourquoi. On
 * recommence, et on échoue à l'identique.
 *
 * L'enrôlement en cours est donc conservé pour la durée de l'onglet, et
 * réutilisé au lieu d'en redemander un.
 *
 * ── Ce que ça n'ouvre PAS ─────────────────────────────────────────────────
 * Le secret conservé ici est PROVISOIRE : le serveur ne l'enregistre qu'au
 * moment où un code correct le valide (voir `/mfa/verify`). Tant qu'il n'est
 * pas validé, il n'ouvre aucun compte — et il est déjà affiché à l'écran, en
 * clair, puisque c'est sa raison d'être.
 *
 * `sessionStorage` et non `localStorage`, délibérément : la portée est
 * l'onglet, pas l'appareil. Fermer l'onglet abandonne l'enrôlement, ce qui est
 * exactement ce qu'on veut d'un secret non validé.
 */
const CLE = 'nodaq-mfa-enrolement';

export interface EnrolementEnCours {
  secret: string;
  qrDataUri: string;
  otpauthUri: string;
}

function estComplet(v: unknown): v is EnrolementEnCours {
  const o = v as Partial<EnrolementEnCours> | null;
  return (
    !!o &&
    typeof o.secret === 'string' &&
    typeof o.qrDataUri === 'string' &&
    typeof o.otpauthUri === 'string' &&
    o.secret.length > 0
  );
}

/** L'enrôlement de cet onglet, s'il y en a un d'exploitable. */
export function lireEnrolement(): EnrolementEnCours | null {
  try {
    const brut = sessionStorage.getItem(CLE);
    if (!brut) return null;
    const valeur: unknown = JSON.parse(brut);
    // Un enregistrement partiel (ancienne version du format, écriture
    // interrompue) est traité comme absent : mieux vaut redemander un secret
    // que d'afficher un QR sans la clé qui va avec.
    return estComplet(valeur) ? valeur : null;
  } catch {
    return null;
  }
}

export function memoriserEnrolement(e: EnrolementEnCours): void {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(e));
  } catch {
    // Stockage indisponible : on retombe sur le comportement d'avant, où
    // chaque affichage redemande un secret. Dégradé, jamais bloquant.
  }
}

/** À appeler dès que l'enrôlement a ABOUTI — le secret est alors persisté. */
export function oublierEnrolement(): void {
  try {
    sessionStorage.removeItem(CLE);
  } catch {
    /* idem */
  }
}
