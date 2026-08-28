/**
 * Garde — aucune migration n'insère dans une table APRÈS l'avoir forcée en RLS.
 *
 * ── LE DÉFAUT QUI L'A FAIT ÉCRIRE ─────────────────────────────────────────
 * `065_tarification.sql` créait `subscriptions`, l'enfermait derrière
 * `FORCE ROW LEVEL SECURITY`, puis tentait d'y remplir les tenants existants.
 * `FORCE` soumet le PROPRIÉTAIRE lui-même aux policies — c'est sa raison
 * d'être. Une migration tourne sans `app.current_tenant_id` : la policy compare
 * `tenant_id` à NULL, le `WITH CHECK` n'est jamais vrai, et PostgreSQL refuse :
 *
 *   new row violates row-level security policy for table "subscriptions"
 *
 * ── POURQUOI LA CI NE POUVAIT PAS LE VOIR ─────────────────────────────────
 * Deux raisons, et la seconde est décisive.
 *
 * D'abord, aucune base de test ne contient de tenant au moment des migrations :
 * le `SELECT … FROM tenants` du remplissage ne rend aucune ligne.
 *
 * Surtout, les migrations tournent en local et en intégration sous `postgres`,
 * un rôle SUPERUTILISATEUR (`rolsuper`, `rolbypassrls`) qui contourne la RLS,
 * `FORCE` compris. En production elles tournent sous `nodaq_owner` —
 * propriétaire mais NON superutilisateur — où la policy s'applique.
 *
 * Mesuré : en insérant un tenant préexistant dans une base locale puis en
 * rejouant l'ordre fautif, la migration PASSE quand même. Aucune exécution de
 * la suite, dans aucun fuseau, ne pouvait révéler ce défaut.
 *
 * D'où une garde qui lit le SQL comme du TEXTE plutôt que de compter sur son
 * exécution. C'est le seul type de garde qui pouvait attraper celui-ci.
 *
 * ── CE QUE CETTE GARDE VÉRIFIE ────────────────────────────────────────────
 * Dans CHAQUE fichier de migration : si une table est passée en `FORCE ROW
 * LEVEL SECURITY`, aucun `INSERT INTO` cette table ne doit apparaître plus
 * bas dans le même fichier. Remplir AVANT de fermer, jamais après.
 *
 * Elle lit le SQL comme du texte — c'est grossier, et c'est voulu : un
 * analyseur SQL complet serait une dépendance de plus pour une règle qui tient
 * en une ligne.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const DOSSIER = join(__dirname, "..", "..", "..", "..", "lib", "db", "migrations");

const FICHIERS = readdirSync(DOSSIER)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Les infractions d'un fichier : une table forcée puis remplie. */
function infractions(sql: string): string[] {
  const lignes = sql.split("\n");
  const forcees = new Map<string, number>();
  const fautes: string[] = [];

  lignes.forEach((ligne, i) => {
    const force = ligne.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    if (force?.[1]) {
      const table = force[1].toLowerCase();
      if (!forcees.has(table)) forcees.set(table, i);
    }

    const insert = ligne.match(/^\s*INSERT\s+INTO\s+"?(\w+)"?/i);
    if (insert?.[1]) {
      const table = insert[1].toLowerCase();
      const ligneForce = forcees.get(table);
      if (ligneForce !== undefined && i > ligneForce) {
        fautes.push(
          `INSERT INTO ${table} ligne ${i + 1}, après FORCE RLS ligne ${ligneForce + 1}`,
        );
      }
    }
  });

  return fautes;
}

describe("Ordre des migrations : remplir avant de fermer", () => {
  test("il y a bien des migrations à vérifier", () => {
    // Sans ça, un dossier renommé rendrait cette garde silencieusement inutile.
    expect(FICHIERS.length).toBeGreaterThan(60);
  });

  test.each(FICHIERS)("%s n'insère pas dans une table déjà forcée en RLS", (fichier) => {
    const fautes = infractions(readFileSync(join(DOSSIER, fichier), "utf8"));
    expect(fautes, `${fichier} :\n  ${fautes.join("\n  ")}`).toEqual([]);
  });

  test("la garde sait reconnaître le défaut qu'elle traque", () => {
    // Éprouvée sur le cas RÉEL, dans l'ordre où il était écrit. Une garde
    // qu'on n'a jamais vue se déclencher n'est pas une garde.
    const fautif = [
      "CREATE TABLE subscriptions (tenant_id UUID);",
      "ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE subscriptions FORCE  ROW LEVEL SECURITY;",
      "INSERT INTO subscriptions (tenant_id) SELECT id FROM tenants;",
    ].join("\n");
    expect(infractions(fautif)).toHaveLength(1);

    // Et l'ordre corrigé passe.
    const correct = [
      "CREATE TABLE subscriptions (tenant_id UUID);",
      "INSERT INTO subscriptions (tenant_id) SELECT id FROM tenants;",
      "ALTER TABLE subscriptions FORCE  ROW LEVEL SECURITY;",
    ].join("\n");
    expect(infractions(correct)).toEqual([]);
  });
});
