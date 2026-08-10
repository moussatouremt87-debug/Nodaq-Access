/**
 * Authentification du domaine d'envoi.
 *
 * Ces tests garantissent deux choses :
 *   — le diagnostic NOMME précisément ce qui manque (c'est tout l'intérêt de
 *     l'écran : un artisan ne devine pas un enregistrement DNS) ;
 *   — aucune valeur de fournisseur n'est codée en dur : tout vient de la
 *     configuration passée en entrée.
 */
import { describe, test, expect } from "vitest";
import {
  enregistrementsAttendus,
  verifierDomaine,
  envoisJournalCutoff,
  ENVOIS_JOURNAL_RETENTION_DAYS,
  type ConfigurationDomaine,
} from "../src/envoiDomaine.js";

/** Valeurs FICTIVES : aucun fournisseur réel n'est supposé ici. */
const CONFIG: ConfigurationDomaine = {
  domaine: "toituremartin.fr",
  spfInclude: "include:_spf.exemple-fournisseur.test",
  dkimSelecteur: "sel1",
  dkimValeur: "v=DKIM1; k=rsa; p=EXEMPLE",
};

describe("enregistrements attendus", () => {
  test("SPF, DKIM et DMARC, aux bons noms DNS", () => {
    const a = enregistrementsAttendus(CONFIG);
    expect(a.map((x) => x.nom)).toEqual([
      "toituremartin.fr",
      "sel1._domainkey.toituremartin.fr",
      "_dmarc.toituremartin.fr",
    ]);
  });

  test("le DKIM n'est PAS demandé tant que sa valeur est inconnue", () => {
    // Réclamer un enregistrement dont on ignore le contenu n'avance à rien, et
    // afficher un attendu vide laisserait croire l'étape faite.
    const a = enregistrementsAttendus({ ...CONFIG, dkimSelecteur: null, dkimValeur: null });
    expect(a.map((x) => x.type)).toEqual(["SPF", "DMARC"]);
  });

  test("aucune valeur de fournisseur en dur — le SPF reprend la configuration", () => {
    const a = enregistrementsAttendus({ ...CONFIG, spfInclude: "include:autre.test" });
    const spf = a.find((x) => x.type === "SPF")!;
    expect(spf.doitContenir).toBe("include:autre.test");
    expect(spf.commentFaire).toContain("include:autre.test");
  });

  test("la consigne SPF prévient du piège du second enregistrement", () => {
    const spf = enregistrementsAttendus(CONFIG).find((x) => x.type === "SPF")!;
    expect(spf.commentFaire).toMatch(/un seul enregistrement SPF/i);
  });
});

describe("diagnostic — nommer précisément ce qui manque", () => {
  test("rien de publié → les trois sont signalés, avec leur nom DNS", () => {
    const d = verifierDomaine(CONFIG, new Map());
    expect(d.conforme).toBe(false);
    expect(d.manquants).toEqual([
      "SPF (toituremartin.fr)",
      "DKIM (sel1._domainkey.toituremartin.fr)",
      "DMARC (_dmarc.toituremartin.fr)",
    ]);
    expect(d.enregistrements[0]!.message).toContain("Aucun enregistrement TXT");
  });

  test("tout publié et conforme → domaine utilisable", () => {
    const d = verifierDomaine(
      CONFIG,
      new Map([
        ["toituremartin.fr", ["v=spf1 include:_spf.exemple-fournisseur.test ~all"]],
        ["sel1._domainkey.toituremartin.fr", ["v=DKIM1; k=rsa; p=EXEMPLE"]],
        ["_dmarc.toituremartin.fr", ["v=DMARC1; p=none"]],
      ]),
    );
    expect(d.conforme).toBe(true);
    expect(d.manquants).toEqual([]);
  });

  test("SPF présent mais SANS l'include attendu → non conforme, et on montre l'écart", () => {
    const d = verifierDomaine(
      CONFIG,
      new Map([["toituremartin.fr", ["v=spf1 include:un-autre-service.test ~all"]]]),
    );
    const spf = d.enregistrements.find((e) => e.type === "SPF")!;
    expect(spf.present).toBe(true);
    expect(spf.conforme).toBe(false);
    expect(spf.valeurTrouvee).toContain("un-autre-service.test");
    expect(spf.message).toContain("include:_spf.exemple-fournisseur.test");
  });

  test("un SPF conforme SEUL ne rend pas le domaine utilisable", () => {
    // Un SPF sans DKIM passe certains filtres et pas d'autres : annoncer
    // « prêt » enverrait l'artisan en indésirables sans qu'il comprenne.
    const d = verifierDomaine(
      CONFIG,
      new Map([["toituremartin.fr", ["v=spf1 include:_spf.exemple-fournisseur.test ~all"]]]),
    );
    expect(d.conforme).toBe(false);
    expect(d.manquants).toHaveLength(2);
  });

  test("un TXT découpé par le DNS est recollé avant comparaison", () => {
    // Le DNS renvoie les TXT longs en morceaux de 255 caractères.
    const d = verifierDomaine(
      CONFIG,
      new Map([
        ["toituremartin.fr", ["v=spf1 include:_spf.exemple", "-fournisseur.test ~all"]],
        ["sel1._domainkey.toituremartin.fr", ["v=DKIM1; k=rsa; p=EXEMPLE"]],
        ["_dmarc.toituremartin.fr", ["v=DMARC1; p=none"]],
      ]),
    );
    expect(d.conforme).toBe(true);
  });

  test("un DMARC qui n'en est pas un est refusé", () => {
    const d = verifierDomaine(
      CONFIG,
      new Map([["_dmarc.toituremartin.fr", ["ceci n'est pas un dmarc"]]]),
    );
    const dmarc = d.enregistrements.find((e) => e.type === "DMARC")!;
    expect(dmarc.present).toBe(true);
    expect(dmarc.conforme).toBe(false);
  });

  test("la comparaison ignore la casse", () => {
    const d = verifierDomaine(
      CONFIG,
      new Map([
        ["toituremartin.fr", ["V=SPF1 INCLUDE:_SPF.EXEMPLE-FOURNISSEUR.TEST ~ALL"]],
        ["sel1._domainkey.toituremartin.fr", ["v=DKIM1; k=rsa; p=EXEMPLE"]],
        ["_dmarc.toituremartin.fr", ["V=DMARC1; p=none"]],
      ]),
    );
    expect(d.conforme).toBe(true);
  });
});

describe("conservation du journal d'envois", () => {
  test("douze mois, explicites", () => {
    expect(ENVOIS_JOURNAL_RETENTION_DAYS).toBe(365);
  });

  test("la date limite recule bien d'un an", () => {
    const cutoff = envoisJournalCutoff(new Date(2026, 7, 10));
    expect(cutoff.getFullYear()).toBe(2025);
    expect(cutoff.getMonth()).toBe(7);
    expect(cutoff.getDate()).toBe(10);
  });
});
