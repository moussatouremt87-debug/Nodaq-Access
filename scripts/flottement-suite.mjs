#!/usr/bin/env node
/*
 * Caractériser le flottement de la suite api-server.
 *
 * ── Pourquoi ce script existe ─────────────────────────────────────────────
 * La suite échoue par intermittence, sur un fichier DIFFÉRENT à chaque fois,
 * toujours verte en isolation. CLAUDE.md attribue ces flottements aux ports
 * éphémères — ce qui explique les `ECONNRESET`, mais PAS les symptômes « la
 * ligne n'est pas là » (404 sur une route qui existe, compte à 0 au lieu de 2,
 * 200 au lieu de 201). Et `vitest.config.ts` pose `singleFork: true` : les
 * fichiers ne tournent donc pas en parallèle, ce que l'explication suppose.
 *
 * On ne débogue pas un défaut qu'on ne sait pas reproduire, et on ne discute
 * pas d'un taux qu'on n'a pas mesuré. Ce script exécute la suite N fois et
 * consigne, pour chaque échec, le fichier, le test et le message brut.
 *
 * ── Ce que ce script n'est PAS ────────────────────────────────────────────
 * Pas un `retry`, et pas une étape de CI. Une garde interdit de masquer un
 * flottement par une réexécution automatique (`flottements-suite.test.ts`), et
 * elle a raison : ce script MESURE, il ne rattrape rien. Il se lance à la main,
 * pendant une enquête.
 *
 * Usage :
 *   node scripts/flottement-suite.mjs [nombre d'exécutions]
 *
 * Il faut `DATABASE_URL` et `DATABASE_URL_APP` dans l'environnement — sur une
 * base de test jetable, JAMAIS l'instance de production (voir CLAUDE.md :
 * `app_user` est un rôle de cluster).
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAQUET = path.join(RACINE, "artifacts/api-server");
const EXECUTIONS = Number(process.argv[2] ?? 10);

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_APP) {
  console.error("DATABASE_URL et DATABASE_URL_APP sont requis (base de test jetable).");
  process.exit(2);
}

/** Une exécution de la suite. Rend la sortie brute et le code de sortie. */
function executer() {
  return new Promise((resolve) => {
    const proc = spawn("pnpm", ["exec", "vitest", "run"], {
      cwd: PAQUET,
      env: {
        // `env -i` en esprit : la CI ne dispose d'aucun secret local, et un
        // vert obtenu avec une variable d'environnement locale n'est pas un
        // vert. On ne transmet que le strict nécessaire.
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        NODE_ENV: "test",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "ci-test-session-secret-minimum-32chars",
        DATABASE_URL: process.env.DATABASE_URL,
        DATABASE_URL_APP: process.env.DATABASE_URL_APP,
        ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
      },
    });
    let sortie = "";
    proc.stdout.on("data", (d) => (sortie += d));
    proc.stderr.on("data", (d) => (sortie += d));
    proc.on("close", (code) => resolve({ code, sortie: sortie.replace(/\[[0-9;]*m/g, "") }));
  });
}

/**
 * Les échecs d'une sortie : fichier, test, et la ligne d'erreur qui suit.
 *
 * DEUX formes, et rater la seconde fait sous-compter — c'est arrivé à la
 * première mesure, qui a rendu une exécution « rouge sans échec » :
 *
 *   FAIL  src/x.test.ts > groupe > test        ← un test qui échoue
 *   FAIL  src/x.test.ts [ src/x.test.ts ]      ← le FICHIER qui ne se charge
 *                                                 même pas (ECONNRESET au
 *                                                 montage, import qui jette)
 *
 * La seconde forme est justement celle des `ECONNRESET`, c'est-à-dire le
 * symptôme qu'on enquête. Un harnais qui la manque mesure le contraire de ce
 * qu'on lui demande.
 */
function echecs(sortie) {
  const lignes = sortie.split("\n");
  const trouves = [];
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    const parTest = /^\s*FAIL\s+(\S+)\s+>\s+(.*)$/.exec(ligne);
    const parFichier = /^\s*FAIL\s+(\S+)\s+\[\s*(\S+)\s*\]\s*$/.exec(ligne);
    if (!parTest && !parFichier) continue;
    const message =
      lignes.slice(i + 1, i + 5).find((l) => /Error|AssertionError|expected/.test(l))?.trim() ?? "";
    trouves.push({
      fichier: (parTest ?? parFichier)[1],
      test: parTest ? parTest[2].trim() : "(le fichier entier n'a pas pu se charger)",
      message,
    });
  }
  return trouves;
}

const journal = [];
for (let i = 1; i <= EXECUTIONS; i++) {
  const debut = Date.now();
  const { code, sortie } = await executer();
  const trouves = echecs(sortie);
  journal.push({ execution: i, code, secondes: Math.round((Date.now() - debut) / 1000), echecs: trouves });
  const resume = trouves.length === 0 ? "vert" : trouves.map((e) => `${e.fichier} :: ${e.test}`).join(" | ");
  console.log(`[${i}/${EXECUTIONS}] code=${code} ${resume}`);
  for (const e of trouves) console.log(`        ${e.message}`);
}

const rouges = journal.filter((j) => j.code !== 0);
const parFichier = new Map();
for (const j of journal) {
  for (const e of j.echecs) parFichier.set(e.fichier, (parFichier.get(e.fichier) ?? 0) + 1);
}

console.log(`\n── Synthèse ──`);
console.log(`Exécutions rouges : ${rouges.length}/${EXECUTIONS}`);
console.log(`Fichiers distincts touchés : ${parFichier.size}`);
for (const [f, n] of [...parFichier].sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${f}`);
// Un fichier touché UNE seule fois sur N exécutions n'accuse pas ce fichier :
// c'est la signature d'un défaut d'environnement, pas d'un test fragile.

const destination = process.env.FLOTTEMENT_JOURNAL ?? path.join(RACINE, "flottement-journal.json");
writeFileSync(destination, JSON.stringify(journal, null, 2));
console.log(`\nJournal détaillé : ${destination}`);
