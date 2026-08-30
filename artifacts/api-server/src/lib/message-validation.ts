/**
 * Une erreur de validation dite en français, pas un vidage de bibliothèque.
 *
 * ── CE QUI A ÉTÉ CONSTATÉ ───────────────────────────────────────────────────
 *
 * Le 29/08/2026, l'acceptation d'un devis renvoyait ceci — sur la page PUBLIQUE,
 * celle que voit le client de l'artisan :
 *
 *   [
 *     {
 *       "code": "invalid_type",
 *       "expected": "string",
 *       "received": "undefined",
 *       "path": [ "signataire" ],
 *       "message": "Required"
 *     }
 *   ]
 *
 * 109 routes rendaient `parsed.error.message`, qui est ce JSON sérialisé. La
 * règle du dépôt est pourtant explicite : les messages destinés à l'utilisateur
 * sont en français.
 *
 * ── LES MESSAGES SUR MESURE SONT CONSERVÉS ─────────────────────────────────
 *
 * Beaucoup de schémas portent déjà leur propre message — « Le nom est
 * obligatoire », « Adresse e-mail invalide », « Taux TVA : 20, 10, 5.5, 2.1
 * ou 0 ». Ils sont meilleurs que tout ce qu'on écrirait ici, et ils passent
 * tels quels. On ne traduit QUE les libellés anglais par défaut de la
 * bibliothèque, reconnus à leur forme.
 */
/**
 * Volontairement STRUCTUREL, et non le `ZodError` d'une version précise : le
 * dépôt importe encore `zod` et `zod/v4` selon les fichiers, et leurs types
 * nominaux ne s'acceptent pas l'un l'autre. Ce traducteur n'a besoin que de la
 * forme des anomalies — il traverse donc les deux versions sans les connaître.
 */
export interface AnomalieValidation {
  readonly message: string;
  readonly path: readonly PropertyKey[];
  readonly options?: readonly unknown[];
}
export interface ErreurValidation {
  readonly issues: readonly AnomalieValidation[];
}

/** Les libellés anglais par défaut, reconnus pour être remplacés. */
function traduireDefaut(issue: AnomalieValidation): string | null {
  const m = issue.message;
  if (m === "Required") return "obligatoire";
  // Zod v4 reformule : « Invalid input: expected string, received undefined ».
  // Un seul fichier l'importe aujourd'hui (`classeur.ts`), mais la migration
  // viendra, et un message anglais qui repasse en silence serait une régression
  // invisible.
  if (/^Invalid input: expected .+, received undefined$/.test(m)) return "obligatoire";
  if (/^Invalid input: expected (\w+)/.test(m)) {
    const attendu = /^Invalid input: expected (\w+)/.exec(m)?.[1];
    const noms: Record<string, string> = {
      string: "du texte", number: "un nombre", boolean: "oui ou non",
      array: "une liste", object: "un objet", date: "une date",
    };
    return `attendu : ${attendu ? (noms[attendu] ?? attendu) : "une autre valeur"}`;
  }
  if (/^Expected .+, received undefined$/.test(m)) return "obligatoire";
  if (/^Expected (\w+), received/.test(m)) {
    const attendu = /^Expected (\w+)/.exec(m)?.[1];
    const noms: Record<string, string> = {
      string: "du texte", number: "un nombre", boolean: "oui ou non",
      array: "une liste", object: "un objet", date: "une date",
    };
    return `attendu : ${attendu ? (noms[attendu] ?? attendu) : "une autre valeur"}`;
  }
  if (/^Invalid enum value/.test(m)) {
    const options = issue.options;
    return options?.length
      ? `valeur attendue parmi : ${options.join(", ")}`
      : "valeur non reconnue";
  }
  if (/^Invalid email/.test(m)) return "adresse e-mail invalide";
  if (/^Invalid url/i.test(m)) return "adresse web invalide";
  if (/^Invalid uuid/i.test(m)) return "identifiant invalide";
  if (/^Invalid/.test(m)) return "valeur invalide";
  if (/^String must contain at least (\d+)/.test(m)) {
    return `au moins ${/(\d+)/.exec(m)?.[1]} caractères`;
  }
  if (/^String must contain at most (\d+)/.test(m)) {
    return `au plus ${/(\d+)/.exec(m)?.[1]} caractères`;
  }
  if (/^Number must be greater than or equal to (.+)$/.test(m)) {
    return `au minimum ${/([\d.-]+)$/.exec(m)?.[1]}`;
  }
  if (/^Number must be less than or equal to (.+)$/.test(m)) {
    return `au maximum ${/([\d.-]+)$/.exec(m)?.[1]}`;
  }
  if (/^Unrecognized key/.test(m)) return "champ inconnu";
  return null; // message sur mesure : on n'y touche pas.
}

/** Le nom du champ tel qu'un humain peut le retrouver à l'écran. */
function cheminLisible(issue: AnomalieValidation): string | null {
  const chemin = issue.path.filter(p => typeof p === "string" || typeof p === "number");
  return chemin.length ? chemin.join(" › ") : null;
}

/** Au-delà, on n'énumère plus : la liste cesse d'aider. */
const MAX_CHAMPS = 4;

/**
 * Rend une phrase française. Jamais du JSON, jamais un code de bibliothèque.
 */
export function messageValidation(erreur: ErreurValidation): string {
  const issues = erreur.issues ?? [];
  if (issues.length === 0) return "Requête invalide.";

  const parts = issues.slice(0, MAX_CHAMPS).map((issue) => {
    const raison = traduireDefaut(issue) ?? issue.message;
    const champ = cheminLisible(issue);
    return champ ? `« ${champ} » : ${raison}` : raison;
  });

  const reste = issues.length - parts.length;
  const suite = reste > 0 ? ` (et ${reste} autre${reste > 1 ? "s" : ""})` : "";
  return `${parts.join(" ; ")}${suite}.`;
}
