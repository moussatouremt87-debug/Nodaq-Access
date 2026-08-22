/**
 * L'écran des connexions parle bénéfice, pas mécanique — ticket 4.32.
 *
 * ── Les deux reproches du test du 22/08 ───────────────────────────────────
 * « Beaucoup trop compliqué pour des artisans d'intégrer leurs outils de cette
 * manière. » — « Pourquoi ces messages d'erreur ? Il faut connecter quoi ? »
 *
 * Trois causes distinctes, et cette garde en tient trois :
 *
 * 1. Les descriptions disaient ce que le LOGICIEL fait (« Synchronisation des
 *    transactions bancaires ») et non ce que l'utilisateur y gagne.
 * 2. Chaque tuile affichait « Non connecté », transformant six choix possibles
 *    en six manques. Une intégration non connectée est un état NORMAL.
 * 3. Les échecs disaient « Erreur » et le message technique, sans jamais dire
 *    quoi faire.
 *
 * Cette garde lit la source : rendre l'écran demanderait de simuler six
 * requêtes pour vérifier des CHOIX DE TEXTE, ce qui coûterait plus cher que ce
 * que ça protège.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(__dirname, "connecteurs.tsx"), "utf8");

describe("a — chaque connexion dit ce qu'elle apporte", () => {
  test("les six connecteurs ont un bénéfice rédigé", () => {
    for (const type of ["BANQUE", "PENNYLANE", "STRIPE", "GOOGLE_DRIVE", "SLACK", "ZAPIER"]) {
      expect(SOURCE, `${type} n'a pas de bénéfice`).toMatch(
        new RegExp(`${type}:\\s*"[^"]{25,}"`),
      );
    }
  });

  test("le bénéfice est rendu à la place de la description technique", () => {
    // La description stockée en base parle de « synchronisation » et de
    // « workflows ». Elle reste en repli, mais ce n'est plus elle qu'on lit.
    expect(SOURCE).toContain("BENEFICES[c.type] ?? c.description");
  });
});

describe("b — un connecteur non branché n'est pas un défaut", () => {
  test("le badge d'état n'apparaît QUE s'il s'est passé quelque chose", () => {
    // Afficher « Non connecté » sur chaque tuile transforme six possibilités
    // en six reproches, avant même que l'utilisateur ait tenté quoi que ce
    // soit.
    expect(SOURCE).toContain("c.status !== 'NON_CONNECTE' &&");
  });
});

describe("c — un message d'échec dit quoi faire", () => {
  test("plus aucun toast intitulé « Erreur » tout court", () => {
    // « Erreur » + le message technique du serveur laisse l'utilisateur devant
    // un mur : il apprend que ça a raté, pas comment s'en sortir.
    expect(SOURCE).not.toMatch(/title:\s*'Erreur'/);
  });

  test.each([
    ["clé refusée", /Vérifiez que vous avez copié la clé en entier/],
    ["connexion bancaire", /écrivez-nous, on regarde/],
    ["déconnexion", /rien n'a été modifié/],
  ])("l'échec « %s » propose une suite", (_cas, motif) => {
    expect(SOURCE).toMatch(motif);
  });

  test("la déconnexion rassure sur les données", () => {
    // « Déconnecter » sonne comme « perdre » : dire ce qui reste évite de
    // faire hésiter sur un geste réversible et sans danger.
    expect(SOURCE).toMatch(/Vos données restent dans nodaq/);
  });
});

describe("d — on dit où trouver ce qu'on demande", () => {
  test.each(["PENNYLANE", "STRIPE", "GOOGLE_DRIVE", "SLACK", "ZAPIER"])(
    "%s indique où chercher son identifiant",
    (type) => {
      // Réclamer une « Secret key » sans dire où elle se trouve, c'est
      // demander de chercher un objet qu'on n'a jamais vu.
      const bloc = SOURCE.slice(SOURCE.indexOf("const OU_TROUVER"));
      expect(bloc.slice(0, bloc.indexOf("};"))).toContain(`${type}:`);
    },
  );

  test("chaque connecteur qui réclame un identifiant explique où le prendre", () => {
    const champs = SOURCE.slice(
      SOURCE.indexOf("const CONNECTOR_FIELDS"),
      SOURCE.indexOf("const STATUS_META"),
    );
    const ouTrouver = SOURCE.slice(SOURCE.indexOf("const OU_TROUVER"));
    const aide = ouTrouver.slice(0, ouTrouver.indexOf("};"));

    const demandeurs = [...champs.matchAll(/^\s{2}([A-Z_]+):\s*\[/gm)].map((m) => m[1]!);
    const sansAide = demandeurs.filter((t) => !aide.includes(`${t}:`));

    expect(
      sansAide,
      `Ces connecteurs demandent un identifiant sans dire où le trouver : ${sansAide.join(", ")}`,
    ).toEqual([]);
  });
});
