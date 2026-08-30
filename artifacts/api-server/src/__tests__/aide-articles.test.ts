/**
 * La documentation d'aide — une source, deux publics.
 *
 * Ces tests protègent la propriété qui fait la valeur du montage : les articles
 * servis aux humains sont EXACTEMENT ceux que lit l'assistant. Deux corpus qui
 * divergeraient ramèneraient le défaut qu'on vient de retirer — un robot qui
 * sait des choses qu'aucune page ne dit.
 */
import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { serveurTest } from "./helpers";
import { articlesAide, indexLlms } from "../lib/aide-articles";
import { consigneSupport } from "../lib/support-connaissances";

describe("les articles se chargent depuis le dépôt", () => {
  test("il y en a, et ils portent un titre et des sujets", () => {
    const articles = articlesAide();
    // Une garde creuse serait pire que rien : sans article, tout le reste passe.
    expect(articles.length).toBeGreaterThanOrEqual(5);
    for (const a of articles) {
      expect(a.titre, `${a.slug} sans titre`).not.toBe(a.slug);
      expect(a.sujets.length, `${a.slug} sans sujets`).toBeGreaterThan(0);
      expect(a.corps.length).toBeGreaterThan(200);
    }
  });

  test("la consigne de l'assistant CONTIENT la documentation", () => {
    const consigne = consigneSupport();
    for (const a of articlesAide()) {
      expect(consigne, `${a.slug} absent de la consigne`).toContain(a.titre);
    }
    // Le marqueur doit avoir été remplacé, pas rendu tel quel.
    expect(consigne).not.toContain("{{DOCUMENTATION}}");
  });
});

describe("l'aide est publique — sans session", () => {
  /*
   * LA garde de ce lot. Celui qui n'arrive pas à se connecter est précisément
   * celui qui a besoin de la page « le code n'arrive pas ». La lui fermer
   * derrière une session serait absurde.
   */
  test("l'index llms.txt se sert sans authentification", async () => {
    const res = await request(serveurTest(app)).get("/api/aide/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# nodaq — aide");
    for (const a of articlesAide()) expect(res.text).toContain(a.titre);
  });

  test("une page se sert en markdown brut, sans authentification", async () => {
    const premier = articlesAide()[0]!;
    const res = await request(serveurTest(app)).get(`/api/aide/${premier.slug}.md`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.text).toContain(premier.corps.slice(0, 80));
  });

  /*
   * Une page qui porte DEUX titres se lit mal et trahit un préfixe ajouté par
   * la route par-dessus celui de l'article. C'est arrivé au premier jet.
   */
  test("chaque page n'a qu'un seul titre de premier niveau", async () => {
    for (const a of articlesAide()) {
      const res = await request(serveurTest(app)).get(`/api/aide/${a.slug}.md`);
      const titres = (res.text.match(/^# /gm) ?? []).length;
      expect(titres, `${a.slug} porte ${titres} titres`).toBe(1);
    }
  });

  test("la liste se sert sans authentification", async () => {
    const res = await request(serveurTest(app)).get("/api/aide/articles");
    expect(res.status).toBe(200);
    expect(res.body.articles.length).toBe(articlesAide().length);
  });

  test("un slug inconnu rend 404, pas une erreur serveur", async () => {
    const res = await request(serveurTest(app)).get("/api/aide/ceci-nexiste-pas.md");
    expect(res.status).toBe(404);
  });
});

describe("aucune donnée d'entreprise ne fuit par l'aide", () => {
  /*
   * Ces routes sont publiques : elles ne doivent rendre QUE des fichiers
   * versionnés. Un jour où quelqu'un voudra « personnaliser l'aide selon le
   * tenant », ce test lui rappellera pourquoi c'est une mauvaise idée ici.
   */
  test("l'index ne contient aucun identifiant", () => {
    const texte = indexLlms("https://exemple.test");
    expect(texte).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(texte).not.toMatch(/@[\w-]+\.[a-z]{2,}/i);
  });
});
