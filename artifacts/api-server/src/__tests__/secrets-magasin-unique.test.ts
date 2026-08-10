/**
 * Garde structurelle — un secret ne se range que dans `tenant_secrets`.
 *
 * Sur le modèle de `llm-single-exit.test.ts` : elle lit le TEXTE des migrations
 * et échoue si une colonne dont le nom évoque un secret naît ailleurs que dans
 * le magasin.
 *
 * ── Ce qu'elle protège ──────────────────────────────────────────────────────
 * Le magasin unique n'a de valeur que s'il est le SEUL endroit. Le jour où
 * quelqu'un ajoute `connectors.api_token TEXT`, il n'y a plus un chemin de code
 * qui chiffre mais deux, dont un qui ne chiffre pas — et la deuxième colonne
 * restera en clair pour toujours parce que personne ne saura qu'elle existe.
 *
 * ── Ce qu'elle ne prétend PAS faire ─────────────────────────────────────────
 * Elle repose sur les NOMS de colonnes. Une colonne `truc_machin` qui porterait
 * un jeton lui échapperait. Elle attrape la faute d'inattention, pas la
 * dissimulation — c'est le contrat de toute garde structurelle de ce dépôt.
 *
 * ── Comment déroger ─────────────────────────────────────────────────────────
 * Poser `chiffrement-derogation:` suivi de la raison, en commentaire SQL sur la
 * ligne de la colonne ou juste au-dessus. Le marqueur est délibérément verbeux :
 * on doit avoir à l'écrire, donc à le justifier, donc à y réfléchir.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../../../lib/db/migrations");

/** La table qui a le droit — et le devoir — de porter des secrets. */
const MAGASIN = "tenant_secrets";

/** Ce qui, dans un nom de colonne, annonce un secret. */
const MOTS = ["password", "secret", "token", "api_key", "credential"];

const MARQUEUR = "chiffrement-derogation:";

/**
 * Dérogations pour des colonnes ANTÉRIEURES à ce lot.
 *
 * Elles vivent ici et non dans le SQL parce qu'une migration LIVRÉE ne se
 * modifie pas : `_migrations` indexe par nom de fichier, une édition ne serait
 * jamais rejouée, et toucher à ces fichiers est précisément l'habitude que
 * `CLAUDE.md` interdit. Toute colonne NOUVELLE doit porter le marqueur dans son
 * propre SQL.
 */
const DEROGATIONS_HISTORIQUES: ReadonlyArray<{
  readonly fichier: string;
  readonly colonne: string;
  readonly raison: string;
}> = [
  {
    fichier: "001_initial_schema.sql",
    colonne: "password_hash",
    raison:
      "Condensat bcrypt, pas un secret réversible. Le chiffrer n'apporterait rien : " +
      "on ne peut rien en faire même en clair, et il n'ouvre aucun accès chez un tiers.",
  },
  {
    fichier: "001_initial_schema.sql",
    colonne: "accept_token",
    raison:
      "Jeton de capacité d'un devis, envoyé au client pour qu'il accepte en ligne. " +
      "Il n'ouvre aucun accès chez un tiers, et surtout il se CHERCHE " +
      "(WHERE accept_token = $1, policy RLS app.devis_accept_token) : un chiffré " +
      "n'est pas comparable, l'IV étant tiré au sort. Le ranger dans le magasin " +
      "rendrait la route publique d'acceptation impossible à écrire. " +
      "RÉSERVE : c'est bien un porteur — quiconque lit la base peut accepter un " +
      "devis à la place du client. Le traitement correct serait d'en stocker le " +
      "condensat et de comparer des condensats, ce qui est une refonte de la " +
      "route publique et non de ce lot. Signalé, pas corrigé.",
  },
  {
    fichier: "002_columns.sql",
    colonne: "accept_token",
    raison:
      "Même colonne que ci-dessus : 002_columns.sql la RÉ-AJOUTE en ALTER … ADD COLUMN " +
      "IF NOT EXISTS, pour les bases créées avant 001. Deux déclarations, une seule " +
      "colonne — la dérogation vaut donc pour les deux fichiers.",
  },
];

interface Trouvaille {
  fichier: string;
  ligne: number;
  colonne: string;
  texte: string;
}

/** Les types de colonne susceptibles de porter un secret. */
const TYPES = "TEXT|VARCHAR|CHAR|BYTEA|JSON|JSONB|INTEGER|BIGINT|UUID";

/**
 * Une colonne définie dans le corps d'un `CREATE TABLE` : nom en tête de ligne,
 * puis un type.
 */
const DANS_CREATE = new RegExp(`^\\s*([a-z_][a-z0-9_]*)\\s+(?:${TYPES})\\b`, "i");

/**
 * Un `ADD COLUMN`, N'IMPORTE OÙ dans la ligne.
 *
 * Sans le « n'importe où », la forme d'une seule ligne
 * `ALTER TABLE t ADD COLUMN IF NOT EXISTS x TEXT;` — qui est la plus courante,
 * et celle qu'emploie la migration 013 elle-même — passait sous le nez de la
 * garde. C'est le trou qu'a révélé le cassage volontaire : la première version
 * de ce détecteur ancrait tout en début de ligne et n'attrapait donc que les
 * colonnes déclarées dans un `CREATE TABLE`.
 */
const ADD_COLUMN = new RegExp(
  `ALTER\\s+TABLE\\s+([a-z_][a-z0-9_]*)[\\s\\S]*?ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_][a-z0-9_]*)\\s+(?:${TYPES})\\b`,
  "i",
);

/**
 * Repère les définitions et ajouts de colonnes dont le nom évoque un secret.
 *
 * On vise la DÉFINITION (`CREATE TABLE` ou `ADD COLUMN`), pas toute mention :
 * un commentaire qui parle de mot de passe n'est pas une colonne, et une garde
 * qui hurle sur les commentaires finit désarmée.
 */
function scanner(): Trouvaille[] {
  const trouvailles: Trouvaille[] = [];
  const fichiers = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const fichier of fichiers) {
    const contenu = readFileSync(join(MIGRATIONS, fichier), "utf8");
    const lignes = contenu.split("\n");
    // Quelle table est en cours de définition — pour laisser passer le magasin.
    let tableCourante = "";

    for (let i = 0; i < lignes.length; i++) {
      const ligne = lignes[i]!;
      const sansCommentaire = ligne.split("--")[0] ?? "";

      const creation = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/i.exec(sansCommentaire);
      if (creation) tableCourante = creation[1]!.toLowerCase();

      const alter = /ALTER\s+TABLE\s+([a-z_]+)/i.exec(sansCommentaire);
      if (alter) tableCourante = alter[1]!.toLowerCase();

      // Quelle table est visée, et quelle colonne est définie ?
      let table = tableCourante;
      let colonne: string | null = null;

      const ajout = ADD_COLUMN.exec(sansCommentaire);
      if (ajout) {
        table = ajout[1]!.toLowerCase();
        colonne = ajout[2]!.toLowerCase();
      } else {
        const dansCreate = DANS_CREATE.exec(sansCommentaire);
        if (dansCreate) colonne = dansCreate[1]!.toLowerCase();
      }

      if (colonne === null) continue;
      if (table === MAGASIN) continue;
      if (!MOTS.some((m) => colonne!.includes(m))) continue;

      // Marqueur sur la ligne elle-même, ou sur celle juste au-dessus.
      const voisinage = `${lignes[i - 1] ?? ""}\n${ligne}`;
      if (voisinage.includes(MARQUEUR)) continue;

      const historique = DEROGATIONS_HISTORIQUES.some(
        (d) => d.fichier === fichier && d.colonne === colonne,
      );
      if (historique) continue;

      trouvailles.push({ fichier, ligne: i + 1, colonne, texte: ligne.trim() });
    }
  }
  return trouvailles;
}

describe("garde — un secret ne se range que dans tenant_secrets", () => {
  test("aucune colonne de secret hors du magasin", () => {
    const trouvailles = scanner();
    const rapport = trouvailles
      .map((t) => `  ${t.fichier}:${t.ligne} — colonne « ${t.colonne} »\n      ${t.texte}`)
      .join("\n");

    expect(
      trouvailles,
      trouvailles.length === 0
        ? ""
        : `Colonne(s) de secret hors de « ${MAGASIN} » :\n${rapport}\n\n` +
          `Que faire : ranger la valeur dans tenant_secrets via lib/tenant-secrets.ts, ` +
          `sous une clé « <domaine>.<champ> ». Si la colonne est légitime — un condensat, ` +
          `une clé PUBLIQUE — poser « ${MARQUEUR} <raison> » en commentaire SQL sur la ligne ` +
          `ou juste au-dessus.`,
    ).toEqual([]);
  });

  test.each([
    ["dans un CREATE TABLE", "  api_token        TEXT,", "api_token"],
    [
      "en ALTER … ADD COLUMN sur une seule ligne",
      "ALTER TABLE parametres_envoi ADD COLUMN IF NOT EXISTS foo_token        TEXT;",
      "foo_token",
    ],
    [
      "en ADD COLUMN sans IF NOT EXISTS",
      "ALTER TABLE connectors ADD COLUMN api_key TEXT;",
      "api_key",
    ],
    ["en majuscules et en bytea", "  CLIENT_SECRET   BYTEA,", "client_secret"],
  ])("la garde attrape une colonne de secret %s", (_forme, ligne, attendue) => {
    // La forme « ALTER … ADD COLUMN » sur une seule ligne est celle qui avait
    // ÉCHAPPÉ à la première version du détecteur, révélée en cassant la garde
    // exprès. Elle est donc éprouvée ici, avec les autres.
    const sansCommentaire = ligne.split("--")[0] ?? "";
    const ajout = ADD_COLUMN.exec(sansCommentaire);
    const dansCreate = DANS_CREATE.exec(sansCommentaire);
    const colonne = (ajout ? ajout[2] : dansCreate?.[1])?.toLowerCase();
    expect(colonne, `« ${ligne} » n'a pas été reconnue comme une colonne`).toBe(attendue);
    expect(MOTS.some((m) => colonne!.includes(m))).toBe(true);
  });

  test("les dérogations historiques disent POURQUOI", () => {
    // Une dérogation sans raison est une exception qu'on ne saura pas relire.
    for (const d of DEROGATIONS_HISTORIQUES) {
      expect(d.raison.length, `${d.fichier}:${d.colonne} sans raison`).toBeGreaterThan(40);
    }
  });

  test("dkim_valeur n'est PAS traitée comme un secret", () => {
    // C'est la clé PUBLIQUE DKIM, publiée dans le DNS par construction. Son nom
    // ne contient aucun des mots surveillés, et c'est volontaire : la nommer
    // « dkim_secret » aurait déclenché la garde à tort et poussé quelqu'un à
    // la chiffrer, ce qui n'a aucun sens.
    expect(MOTS.some((m) => "dkim_valeur".includes(m))).toBe(false);
  });
});
