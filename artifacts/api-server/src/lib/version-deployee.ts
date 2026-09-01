/**
 * Quelle version tourne — la première question de tout diagnostic.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 *
 * Un dossier de support qui ne dit pas sur quelle version l'artisan était est
 * un dossier qu'on instruit à l'aveugle. On reproduit un défaut qui n'existe
 * plus, ou on cherche dans un code qui n'est pas celui qu'il utilisait.
 *
 * Le cas s'est présenté toute la semaine : cinq changements attendaient dans
 * `main` sans être déployés. Un défaut signalé pendant cette fenêtre pouvait
 * être corrigé depuis deux jours dans le dépôt et bien présent chez lui.
 *
 * ── ELLE DIT QUAND ELLE NE SAIT PAS ─────────────────────────────────────────
 *
 * `NODAQ_COMMIT` est posée à la construction de l'image. Absente — image
 * construite sans l'argument, ou exécution locale — la fonction ne devine pas
 * et ne rend pas une valeur plausible : elle dit « inconnue ». Une empreinte
 * fausse est pire qu'une empreinte absente, parce qu'on la croit.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cache: string | null = null;

/** Version lisible du code en cours d'exécution. Jamais une supposition. */
export function versionDeployee(): string {
  if (cache) return cache;

  const commit = process.env["NODAQ_COMMIT"]?.trim();
  if (commit) {
    cache = commit;
    return cache;
  }

  /*
   * Repli : la version du `package.json`. Elle bouge rarement, donc elle ne
   * désigne pas un commit — d'où le suffixe explicite. Mieux vaut « version 1.0
   * (commit inconnu) » qu'un identifiant qui ferait croire à une précision
   * qu'on n'a pas.
   */
  try {
    const ici = dirname(fileURLToPath(import.meta.url));
    for (const candidat of [join(ici, "..", "..", "package.json"), "/app/package.json"]) {
      try {
        const v = JSON.parse(readFileSync(candidat, "utf8")).version;
        if (v) { cache = `${v} (commit inconnu)`; return cache; }
      } catch { /* on essaie le suivant */ }
    }
  } catch { /* rien à faire */ }

  cache = "inconnue";
  return cache;
}
