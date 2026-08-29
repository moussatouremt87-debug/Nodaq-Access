/**
 * L'agent de chat est l'OPÉRATEUR du produit — ticket 4.23.
 *
 * ── Le défaut d'origine ───────────────────────────────────────────────────
 * Session de test du 22 août 2026. À « tu sais faire des factures au format
 * officiel du 1er septembre 2026 ? », l'agent répondait :
 *
 *   « Non, je ne peux pas créer de factures. […] Tu peux utiliser un logiciel
 *     de comptabilité ou faire appel à un expert-comptable. »
 *
 * Le produit recommandait la concurrence dans sa première minute d'usage.
 *
 * La cause n'était PAS l'absence d'outils — l'agent en avait quatorze, dont
 * neuf d'écriture. C'était le refus n° 2 du prompt système, « avis
 * professionnel réglementé […] fiscal », qui attrapait le cœur du métier :
 * établir une facture conforme EST la fonction du produit, pas un conseil
 * fiscal. Le modèle a obéi à une consigne trop large.
 */
import { describe, test, expect } from "vitest";
import {
  OUTILS_ECRITURE,
  proposerEcriture,
  TOOLS,
} from "../lib/mistralAgent.js";
import { TYPES_INTENTION, CHAMPS_A_COMPLETER } from "@nodaq/shared";

/** Les noms d'outils que le modèle voit réellement. */
const nomsDeclares = new Set(
  (TOOLS as ReadonlyArray<{ function: { name: string } }>).map((t) => t.function.name),
);

describe("a — tout outil d'écriture produit l'intention qu'il annonce", () => {
  test.each(OUTILS_ECRITURE.map((o) => [o] as const))(
    "%s ne retombe pas sur le repli générique",
    (outil) => {
      // `proposerEcritureBrute` a un `default` qui rend `consigner_activite`.
      // Une faute de frappe dans `OUTILS_ECRITURE` transformerait donc
      // silencieusement « facture ce devis » en « consigner une activité » :
      // l'utilisateur validerait une opération qui n'a rien à voir, et rien ne
      // le signalerait. C'est LE mode d'échec que cette garde attrape.
      const op = proposerEcriture(outil, {}, "");
      if (outil === "log_activity") {
        expect(op.type).toBe("consigner_activite");
        return;
      }
      expect(op.type, `${outil} retombe sur le repli`).not.toBe("consigner_activite");
    },
  );

  test("chaque outil d'écriture rend un type d'intention connu", () => {
    for (const outil of OUTILS_ECRITURE) {
      const op = proposerEcriture(outil, {}, "");
      expect(TYPES_INTENTION as readonly string[]).toContain(op.type);
    }
  });

  test("tout outil d'écriture est DÉCLARÉ au modèle", () => {
    // Un outil exécutable mais non déclaré est inatteignable : le modèle ne
    // sait pas qu'il existe, et l'agent répond « je ne peux pas ».
    for (const outil of OUTILS_ECRITURE) {
      expect(nomsDeclares, `${outil} n'est pas déclaré dans TOOLS`).toContain(outil);
    }
  });
});

describe("b — les fonctions du produit sont atteignables", () => {
  test.each([
    ["facturer un devis accepté", "facturer_devis"],
    ["saisir des heures", "pointer_heures"],
    ["créer une fiche client", "create_client"],
    ["enregistrer un règlement", "enregistrer_reglement"],
    ["relancer les impayés", "lancer_relance"],
    ["ajouter un article au catalogue", "create_article_catalogue"],
    ["déclarer une charge récurrente", "create_charge_recurrente"],
    ["créer un contrat", "create_contrat"],
  ])("« %s » a un outil : %s", (_tache, outil) => {
    expect(nomsDeclares).toContain(outil);
  });

  test("les lectures nécessaires aux écritures existent", () => {
    // Sans identifiant, pas d'écriture : `facturer_devis` a besoin de
    // `list_devis` comme `declare_absence` a besoin de `list_team_members`.
    for (const lecture of ["list_devis", "list_factures", "list_clients", "list_catalogue"]) {
      expect(nomsDeclares).toContain(lecture);
    }
  });
});

describe("c — aucun montant ne vient du modèle", () => {
  test("un montant absent du message est ÉCARTÉ, pas écrit", () => {
    // Le modèle propose 4500 € sur un message qui ne les porte pas.
    const op = proposerEcriture(
      "create_article_catalogue",
      { libelle: "Pose de placo", prixUnitaireHtEuros: 4500 },
      "ajoute la pose de placo au catalogue",
    );
    expect(op.champs["prixUnitaireHtCents"]).toBeNull();
    // Écarté, donc réclamé à l'écran — jamais deviné.
    expect(op.aCompleter).toEqual(CHAMPS_A_COMPLETER["creer_article_catalogue"]);
  });

  test("un montant réellement écrit par l’utilisateur est retenu, en centimes", () => {
    const op = proposerEcriture(
      "create_article_catalogue",
      { libelle: "Pose de placo", prixUnitaireHtEuros: 45 },
      "ajoute la pose de placo au catalogue à 45 euros du m²",
    );
    expect(op.champs["prixUnitaireHtCents"]).toBe("4500");
    expect(op.aCompleter).toEqual([]);
  });

  test("aucun schéma d’outil ne demande des CENTIMES au modèle", () => {
    // Même règle structurelle que les intentions vocales : le modèle parle en
    // euros. S'il rendait des centimes, « 45 euros » s'écrirait 45 centimes.
    const json = JSON.stringify(TOOLS);
    expect(/[a-zA-Z]Cents"\s*:/.test(json), "un paramètre d'outil est en centimes").toBe(false);
  });
});


/*
 * ── UN PRIX DICTÉ SUR UN DEVIS ───────────────────────────────────────────
 *
 * Ouvert le 29/08/2026, après que « Pour le même client, Madame Touré, pour
 * la réfection du mur pour 1200 euros » se soit perdu : les lignes de devis
 * ne pouvaient porter AUCUN prix, et « la réfection du mur » n'est dans aucun
 * catalogue. Le devis restait vide.
 *
 * La règle 3 autorise ce cas — l'humain est la seule source du chiffre pour un
 * ouvrage neuf — MAIS sous condition : le montant doit se retrouver dans la
 * transcription. Ces gardes tiennent cette condition.
 */
describe("le prix dicté d'une ligne de devis", () => {
  const lignes = (prix?: number) => ({
    lignes: [{ libelle: "Réfection du mur", ...(prix !== undefined ? { prixUnitaireEuros: prix } : {}) }],
  });
  const lignesDe = (op: { champs: Record<string, string | null> }) =>
    JSON.parse(op.champs["lignesDicteesJson"] ?? "[]") as Array<Record<string, unknown>>;

  test("un montant PRONONCÉ est retenu, en centimes", () => {
    const op = proposerEcriture(
      "create_devis",
      lignes(1200),
      "Pour Madame Touré, la réfection du mur pour 1200 euros",
    );

    expect(lignesDe(op)[0]!["prixUnitaireHtCents"]).toBe(120000);
  });

  /*
   * LA garde. Un modèle qui invente un chiffre absent de la phrase est arrêté
   * ici : le champ retombe vide et se réclame à l'écran. Le repli est l'état
   * sûr — c'est la condition 2 de la règle 3, mot pour mot.
   */
  test("un montant ABSENT de la phrase est écarté, jamais nettoyé", () => {
    const op = proposerEcriture(
      "create_devis",
      lignes(1200),
      "Pour Madame Touré, la réfection du mur",   // aucun chiffre
    );

    expect(lignesDe(op)[0]!["prixUnitaireHtCents"]).toBeUndefined();
  });

  test("un montant DIFFÉRENT de celui prononcé est écarté", () => {
    const op = proposerEcriture(
      "create_devis",
      lignes(9900),
      "Pour Madame Touré, la réfection du mur pour 1200 euros",
    );

    expect(lignesDe(op)[0]!["prixUnitaireHtCents"]).toBeUndefined();
  });

  /*
   * Un forfait n'a pas de quantité. Sans ce défaut à 1, `totalProposition`
   * compterait la ligne « à compléter » alors qu'elle porte un prix, et
   * annoncerait un devis moins cher que la réalité — l'erreur qu'on ne peut
   * pas se permettre sur un prix envoyé à un client.
   */
  test("un forfait dicté vaut une unité", () => {
    const op = proposerEcriture(
      "create_devis",
      lignes(1200),
      "la réfection du mur pour 1200 euros",
    );

    expect(lignesDe(op)[0]!["quantite"]).toBe(1);
  });

  test("sans prix dicté, aucune quantité n'est inventée", () => {
    const op = proposerEcriture("create_devis", lignes(), "la réfection du mur");

    expect(lignesDe(op)[0]!["quantite"]).toBeNull();
    expect(lignesDe(op)[0]!["prixUnitaireHtCents"]).toBeUndefined();
  });

  /*
   * `facturer_devis` reste FERMÉ, et doit le rester : les montants viennent
   * du devis signé. Facturer autre chose que ce qui a été accepté ne se
   * rattrape pas.
   */
  test("facturer_devis ne porte toujours aucun montant", () => {
    const op = proposerEcriture(
      "facturer_devis",
      { devisId: "dev-1", prixUnitaireEuros: 9900, montantEuros: 9900 },
      "facture le devis pour 9900 euros",
    );

    expect(JSON.stringify(op.champs)).not.toMatch(/9900|990000/);
    expect(Object.keys(op.champs)).toEqual(["devisId"]);
  });
});
