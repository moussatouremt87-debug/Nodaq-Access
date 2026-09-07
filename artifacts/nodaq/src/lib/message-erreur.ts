/**
 * Ce qu'on montre à l'artisan quand une requête échoue.
 *
 * ── LE DÉFAUT QUE CE MODULE RÉPARE ──────────────────────────────────────────
 *
 * Deux écrans faisaient `throw new Error(\`HTTP ${res.status}\`)` et
 * affichaient « Transcription échouée — HTTP 403 ».
 *
 * Deux problèmes dans cette seule phrase. « HTTP 403 » est du jargon montré à
 * un artisan (règle 3 bis b). Et surtout, le serveur envoyait au même moment
 * une phrase qui disait exactement quoi faire — « Votre abonnement n'est pas
 * encore activé : […] Activez-le dans Réglages → Abonnement » — que l'écran
 * jetait à la poubelle.
 *
 * Le pire des deux mondes : on refuse ET on n'explique pas, alors que
 * l'explication était déjà écrite et déjà transmise.
 *
 * ── CE QUE FAIT CETTE FONCTION ──────────────────────────────────────────────
 *
 * Elle lit le corps de la réponse et rend le champ `error` du serveur. À
 * défaut — corps vide, HTML d'une passerelle, panne réseau — elle rend une
 * phrase française qui dit quoi faire, jamais un code.
 */

/** Repli par code, en français, orienté vers l'action. */
const REPLIS: Record<number, string> = {
  401: "Votre session a expiré. Reconnectez-vous.",
  403: "Cette action ne vous est pas ouverte pour le moment.",
  404: "Cet élément est introuvable.",
  413: "Le fichier est trop volumineux.",
  429: "Trop de demandes coup sur coup. Patientez un instant.",
  500: "Le service a rencontré une difficulté. Réessayez dans un instant.",
  502: "Le service n'a pas répondu. Réessayez dans un instant.",
  503: "Ce service est momentanément indisponible.",
};

/**
 * Le message à afficher pour une réponse en échec.
 *
 * `await`é : lire le corps est asynchrone, et c'est justement le corps qui
 * porte la phrase utile. Une version synchrone aurait forcé à retomber sur le
 * code — soit exactement le défaut qu'on corrige.
 */
export async function messageErreur(res: Response): Promise<string> {
  try {
    const corps = await res.json();
    const dit = (corps as { error?: unknown })?.error;
    // Le serveur écrit déjà en français et nomme le chemin : on le laisse
    // parler plutôt que de le paraphraser.
    if (typeof dit === "string" && dit.trim()) return dit.trim();
  } catch {
    // Corps absent ou illisible : on passe au repli, sans bruit.
  }
  return REPLIS[res.status] ?? "L'opération n'a pas abouti. Réessayez dans un instant.";
}
