/**
 * Les articles d'aide — UNE source, deux publics.
 *
 * ── POURQUOI CE N'EST PLUS UNE CONSTANTE TYPESCRIPT ─────────────────────────
 *
 * La connaissance de l'assistant vivait dans une chaîne de caractères, au
 * milieu du code. Elle marchait, et elle avait deux défauts qui se paient plus
 * tard :
 *
 *   — un utilisateur ne peut pas la LIRE. Il doit poser la question à un
 *     robot pour apprendre quelque chose qui pourrait être une page ;
 *   — corriger une explication demandait de modifier du code, donc une PR,
 *     une CI et un déploiement — pour une phrase.
 *
 * ElevenLabs fait l'inverse, et c'est la partie la plus solide de leur pile :
 * une documentation publiée, servie aux humains ET lue par leur agent. Un seul
 * texte, corrigé une fois, qui profite aux deux. Ils vont jusqu'à publier un
 * index `llms.txt` destiné aux modèles.
 *
 * ── OÙ VIVENT LES FICHIERS ──────────────────────────────────────────────────
 *
 * Dans `docs/aide/*.md`, versionnés avec le code, et COPIÉS dans l'image — le
 * disque d'un conteneur est éphémère, rien ne s'écrit à l'exécution. Même
 * mécanique que les migrations, qui ont résolu ce problème avant nous.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface ArticleAide {
  readonly slug: string;
  readonly titre: string;
  /** Mots par lesquels un artisan cherche — pas des mots-clés de moteur. */
  readonly sujets: readonly string[];
  readonly corps: string;
}

/**
 * Le dossier des articles.
 *
 * `AIDE_DIR` d'abord, comme `MIGRATIONS_DIR` : dans l'image, les fichiers ne
 * sont pas là où le source les voyait. Sinon on remonte depuis le module, ce
 * qui couvre le développement et les tests.
 */
function dossierArticles(): string | null {
  const impose = process.env["AIDE_DIR"]?.trim();
  if (impose) return existsSync(impose) ? impose : null;

  /*
   * On REMONTE au lieu de deviner. Une liste de chemins relatifs écrite à la
   * main marchait depuis `src/` et pas depuis `dist/` : le module bundlé ne
   * vit pas à la même profondeur que sa source, et la première version n'a
   * rien servi en production tout en passant les tests.
   *
   * Remonter jusqu'à trouver `docs/aide` couvre les deux, plus le cas où
   * quelqu'un lance le serveur depuis un autre répertoire.
   */
  const depart = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const base of depart) {
    let courant = base;
    for (let i = 0; i < 6; i++) {
      const candidat = join(courant, "docs", "aide");
      if (existsSync(candidat)) return candidat;
      const parent = dirname(courant);
      if (parent === courant) break;
      courant = parent;
    }
  }
  // Dans l'image, les articles sont copiés à plat — voir le Dockerfile.
  return existsSync("/app/aide") ? "/app/aide" : null;
}

/** Découpe l'en-tête `---` d'un fichier. Volontairement minimal : trois clés. */
function lireArticle(slug: string, brut: string): ArticleAide {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(brut);
  if (!m) return { slug, titre: slug, sujets: [], corps: brut.trim() };
  const entete = m[1]!;
  const titre = /titre:\s*(.+)/.exec(entete)?.[1]?.trim() ?? slug;
  const sujetsBruts = /sujets:\s*\[(.*?)\]/.exec(entete)?.[1] ?? "";
  return {
    slug,
    titre,
    sujets: sujetsBruts.split(",").map((s) => s.trim()).filter(Boolean),
    corps: m[2]!.trim(),
  };
}

let cache: ArticleAide[] | null = null;

/**
 * Les articles, lus une fois.
 *
 * Le cache est volontaire : les fichiers sont figés dans l'image, ils ne
 * changent pas entre deux requêtes. Relire le disque à chaque question du
 * support serait payer un accès fichier pour un contenu immuable.
 */
export function articlesAide(): readonly ArticleAide[] {
  if (cache) return cache;
  const dossier = dossierArticles();
  if (!dossier) {
    // Pas d'exception : un support sans articles répond moins bien, il ne
    // tombe pas. L'absence se voit dans `llms.txt`, qui sera vide.
    console.error("[aide] dossier d'articles introuvable — l'assistant répondra sans documentation");
    cache = [];
    return cache;
  }
  cache = readdirSync(dossier)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => lireArticle(f.replace(/\.md$/, ""), readFileSync(join(dossier, f), "utf8")));
  return cache;
}

/**
 * L'index destiné aux modèles, au format que publie ElevenLabs.
 *
 * Il sert à deux choses : donner à un agent extérieur (Claude, Cursor) de quoi
 * trouver la bonne page, et prouver d'un coup d'œil ce que le support SAIT.
 */
export function indexLlms(base: string): string {
  const articles = articlesAide();
  return [
    "# nodaq — aide",
    "",
    "> Logiciel de gestion pour artisans et TPE du bâtiment et des services.",
    "> Chaque page est servie en markdown brut à l'adresse indiquée.",
    "",
    "## Articles",
    "",
    ...articles.map((a) => `- [${a.titre}](${base}/api/aide/${a.slug}.md) — ${a.sujets.join(", ")}`),
    "",
  ].join("\n");
}
