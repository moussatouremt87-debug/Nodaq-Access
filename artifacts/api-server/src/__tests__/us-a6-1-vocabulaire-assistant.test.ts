/**
 * US-A6.1 — Vocabulaire de l'assistant adapté au secteur.
 *
 * Ce que ces tests protègent :
 *   a. AC1 — le prompt envoyé au modèle porte le vocabulaire du secteur
 *      DÉCLARÉ, et pas celui d'un autre : un consultant n'y trouve jamais
 *      « chantier ». Vérifié sur les TROIS chemins (agent, dictée vocale,
 *      dictée de devis), parce que les trois avaient leur propre prompt écrit
 *      en dur pour le bâtiment ;
 *   b. AC3 — un changement de secteur s'applique dès la requête suivante,
 *      sans redémarrage ni vidage de cache ;
 *   c. AC2 — le libellé d'une action soumise à validation emploie le mot du
 *      secteur, jamais celui d'un autre ;
 *   d. garde structurelle — aucun fichier de prompt ne réintroduit un mot de
 *      secteur en dur. C'est elle qui tiendra au prochain ajustement de
 *      prompt, quand personne ne se souviendra de cette story.
 *
 * Le prompt sortant est capté en interceptant `globalThis.fetch` — même patron
 * que `chat-media-adversarial.test.ts`.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import app from "../app";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];

interface Locataire { cookie: string; tenantId: string }

async function inscrire(nom: string): Promise<Locataire> {
  const email = `a61-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  return { cookie: reg.headers["set-cookie"][0], tenantId: reg.body.tenantId };
}

async function declarerSecteur(tenantId: string, metier: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'votre-metier.metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2`,
    [tenantId, metier],
  );
}

/**
 * Exécute `action` en captant les prompts « system » envoyés au modèle.
 * Restaure toujours le `fetch` d'origine — sans quoi une assertion qui échoue
 * laisserait la suite entière avec un fetch détourné.
 */
async function capterPromptsSysteme(action: () => Promise<unknown>): Promise<string[]> {
  const original = globalThis.fetch;
  const captures: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes("/chat/completions") && init?.body) {
      const body = JSON.parse(init.body as string) as { messages?: Array<{ role: string; content: unknown }> };
      for (const m of body.messages ?? []) {
        if (m.role === "system" && typeof m.content === "string") captures.push(m.content);
      }
    }
    return original(input as Parameters<typeof original>[0], init);
  }) as typeof fetch;

  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
  return captures;
}

let batiment: Locataire;
let conseil: Locataire;

beforeAll(async () => {
  batiment = await inscrire("batiment");
  conseil = await inscrire("conseil");
  await declarerSecteur(batiment.tenantId, "batiment");
  await declarerSecteur(conseil.tenantId, "services_projet");
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a. AC1 — le vocabulaire suit le secteur déclaré ────────────────────────

describe("a — AC1 : le prompt porte le vocabulaire du secteur déclaré", () => {
  test("agent conversationnel : « chantier » pour le bâtiment, « mission » pour le conseil", async () => {
    const pourBatiment = await capterPromptsSysteme(() =>
      request(serveurTest(app)).post("/api/chat/messages").set("Cookie", batiment.cookie).send({ content: "Bonjour" }),
    );
    expect(pourBatiment.length).toBeGreaterThan(0);
    expect(pourBatiment.join("\n")).toContain("chantier");

    const pourConseil = await capterPromptsSysteme(() =>
      request(serveurTest(app)).post("/api/chat/messages").set("Cookie", conseil.cookie).send({ content: "Bonjour" }),
    );
    expect(pourConseil.length).toBeGreaterThan(0);
    const texteConseil = pourConseil.join("\n");
    expect(texteConseil).toContain("mission");
    // Le point de la story : pas seulement « dit mission », mais « ne dit
    // JAMAIS chantier » — c'est le mot de travers qui trahit l'outil pensé
    // pour un autre métier.
    expect(texteConseil).not.toContain("chantier");
  });

  test("dictée vocale : idem, sur son propre prompt", async () => {
    const pourConseil = await capterPromptsSysteme(() =>
      request(serveurTest(app)).post("/api/voix/interpreter").set("Cookie", conseil.cookie).send({ texte: "voix-test-vocabulaire" }),
    );
    const texte = pourConseil.join("\n");
    expect(texte).toContain("mission");
    expect(texte).not.toContain("chantier");
    // Le cadrage « artisan du bâtiment » a bien disparu du prompt.
    expect(texte).not.toContain("artisan du bâtiment");
  });

  test("dictée de devis : idem, y compris dans l'exemple travaillé", async () => {
    const pourConseil = await capterPromptsSysteme(() =>
      request(serveurTest(app))
        .post("/api/devis/dictee/proposer")
        .set("Cookie", conseil.cookie)
        .send({ texte: "trois heures de diagnostic" }),
    );
    const texte = pourConseil.join("\n");
    expect(texte).not.toContain("chantier");
    expect(texte).not.toContain("artisan du bâtiment");
    // L'exemple d'origine parlait de toiture et de gouttière — sans rapport
    // avec le métier d'un consultant.
    expect(texte).not.toContain("toiture");
    expect(texte).not.toContain("gouttière");
  });
});

// ── b. AC3 — un changement de secteur s'applique à chaud ───────────────────

describe("b — AC3 : le changement de secteur s'applique sans redémarrage", () => {
  test("le même tenant, le même processus : le prompt suit le nouveau secteur dès la requête suivante", async () => {
    const t = await inscrire("bascule");
    await declarerSecteur(t.tenantId, "batiment");

    const avant = await capterPromptsSysteme(() =>
      request(serveurTest(app)).post("/api/chat/messages").set("Cookie", t.cookie).send({ content: "Bonjour" }),
    );
    expect(avant.join("\n")).toContain("chantier");

    // Rien d'autre ne bouge : ni redémarrage, ni cache vidé, ni reconnexion.
    await declarerSecteur(t.tenantId, "services_projet");

    const apres = await capterPromptsSysteme(() =>
      request(serveurTest(app)).post("/api/chat/messages").set("Cookie", t.cookie).send({ content: "Bonjour" }),
    );
    const texte = apres.join("\n");
    expect(texte).toContain("mission");
    expect(texte).not.toContain("chantier");
  });
});

// ── c. AC2 — le libellé soumis à validation parle la langue du secteur ─────

describe("c — AC2 : le libellé d'une action à valider emploie le mot du secteur", () => {
  test("une création dictée chez un consultant se lit « Créer la mission … »", async () => {
    const res = await request(serveurTest(app))
      .post("/api/voix/interpreter")
      .set("Cookie", conseil.cookie)
      .send({ texte: "voix-test-libelle" })
      .expect(200);

    const libelles = (res.body.operations ?? []).map((o: { libelle: string }) => o.libelle);
    expect(libelles.length).toBeGreaterThan(0);
    expect(libelles.join(" ")).toContain("mission");
    expect(libelles.join(" ")).not.toContain("chantier");
    // « affaire » est le mot NEUTRE de la base : correct en soi, mais ce
    // n'est pas celui que l'écran de ce tenant affiche.
    expect(libelles.join(" ")).not.toContain("l'affaire");
  });

  test("chez un tenant bâtiment, le même chemin dit « chantier »", async () => {
    const res = await request(serveurTest(app))
      .post("/api/voix/interpreter")
      .set("Cookie", batiment.cookie)
      .send({ texte: "voix-test-libelle" })
      .expect(200);

    const libelles = (res.body.operations ?? []).map((o: { libelle: string }) => o.libelle);
    expect(libelles.join(" ")).toContain("chantier");
  });
});

// ── d. Garde structurelle ──────────────────────────────────────────────────

describe("d — garde : aucun mot de secteur écrit en dur dans un prompt", () => {
  /**
   * Les trois fichiers qui construisent un prompt système. Le mot « chantier »
   * n'y a plus sa place : il doit venir de `verticalPack()`. Sans cette garde,
   * la régression reviendrait au premier ajustement de prompt rédigé « pour un
   * artisan » par réflexe — et personne ne s'en apercevrait avant qu'un
   * consultant ne le signale.
   */
  const FICHIERS_DE_PROMPT = [
    "lib/vertical-tenant.ts",
    "routes/voix.ts",
    "routes/devis-dictee.ts",
  ];

  test("« chantier » n'apparaît dans aucun fichier de prompt", () => {
    const racine = path.resolve(__dirname, "..");
    for (const fichier of FICHIERS_DE_PROMPT) {
      const src = readFileSync(path.join(racine, fichier), "utf8");
      const lignes = src.split("\n");
      const coupables = lignes
        .map((ligne, i) => ({ ligne, n: i + 1 }))
        // Les commentaires expliquent la règle et citent parfois le mot :
        // c'est de la prose, pas du prompt.
        .filter(({ ligne }) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
        .filter(({ ligne }) => /chantier/i.test(ligne));

      expect(
        coupables,
        `${fichier} contient « chantier » en dur — le mot doit venir de verticalPack() :\n` +
          coupables.map((c) => `  ligne ${c.n} : ${c.ligne.trim()}`).join("\n"),
      ).toEqual([]);
    }
  });
});
