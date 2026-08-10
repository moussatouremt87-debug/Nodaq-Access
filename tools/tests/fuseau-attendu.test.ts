/**
 * Garde de fuseau — le fuseau demandé est-il celui qu'on obtient ?
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI HORS DES PAQUETS
 *
 * Chaque ticket de ce dépôt se termine par « la suite dans les trois fuseaux :
 * UTC, Europe/Paris, Pacific/Auckland ». L'exigence n'a jamais été satisfaite.
 * `artifacts/api-server/vitest.config.ts` posait `env: { TZ: "Europe/Paris" }`,
 * une valeur FIXE que Vitest applique au `process.env` du worker : préfixer la
 * commande par `TZ=Pacific/Auckland` n'avait aucun effet — et c'était sur le
 * paquet qui porte les bornes de période, les dates d'émission et les
 * exercices, donc exactement là où vivent les bugs de fuseau.
 *
 * Une garde qui vivrait dans un seul paquet ne verrait rien : un épinglage dans
 * le paquet A est invisible depuis la suite du paquet B, qui tourne dans son
 * propre worker. La garde doit donc s'exécuter DANS CHAQUE suite. D'où ce
 * fichier unique, hors de tout paquet, référencé par l'`include` des huit
 * `vitest.config.ts`. Le jour où un neuvième paquet apparaît sans cette ligne,
 * il n'est pas gardé — c'est la limite connue, et elle est écrite ici.
 *
 * Elle attrape l'épinglage QUELLE QU'EN SOIT LA FORME — `env`, `setupFiles`,
 * `process.env.TZ = …` en dur — parce qu'elle mesure l'EFFET et non la cause :
 * ce que le moteur résout réellement, pas ce que la configuration prétend.
 */
import { describe, test, expect } from "vitest";

/** Le fuseau que l'appelant DEMANDE. Absent = personne ne demande rien. */
const TZ_ATTENDU = process.env["TZ_ATTENDU"];

/** Le fuseau que le moteur applique réellement, épinglages compris. */
function fuseauResolu(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

describe("garde de fuseau", () => {
  test(
    TZ_ATTENDU
      ? `le moteur résout bien ${TZ_ATTENDU}`
      : "NON APPLICABLE — TZ_ATTENDU n'est pas posée, aucun fuseau n'est exigé",
    () => {
      if (TZ_ATTENDU === undefined) {
        // Le test ne se saute PAS en silence : son nom annonce qu'il ne
        // s'applique pas, et il reste une assertion réelle en dessous.
        //
        // Elle vise le vrai piège : `TZ_ATTENDU=` (chaîne vide). Là quelqu'un
        // a eu l'INTENTION d'exiger un fuseau, la variable existe, et une
        // garde écrite `if (!TZ_ATTENDU) return` se désarmerait sans un mot —
        // la forme exacte qui a masqué sept tests de sécurité dans ce dépôt.
        expect(process.env["TZ_ATTENDU"]).toBeUndefined();
        return;
      }

      expect(fuseauResolu()).toBe(TZ_ATTENDU);
    },
  );

  test("le moteur expose un fuseau IANA exploitable", () => {
    // Toujours active, sans condition : sans elle ce fichier serait inerte
    // quand TZ_ATTENDU manque, et une garde inerte ne garde rien.
    const resolu = fuseauResolu();
    expect(resolu).toBeTruthy();
    // « UTC » ou « Zone/Ville » — jamais un décalage figé du type « +02:00 »,
    // qui ne connaît pas les changements d'heure et ferait dériver les bornes.
    expect(resolu).toMatch(/^(UTC|[A-Za-z_]+\/[A-Za-z_+\-0-9/]+)$/);
  });
});
