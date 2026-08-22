/**
 * US-A6.3 — Refus explicite d'une demande hors périmètre.
 *
 * Ce que ces tests protègent :
 *   a. la garde elle-même — un montant reformaté depuis une source passe, un
 *      montant que le modèle a fabriqué (typiquement un total qu'il a
 *      additionné) ne passe pas ;
 *   b. AC1 bout en bout — le modèle renvoie « environ 3 000 € » sans aucune
 *      source, et l'utilisateur ne voit JAMAIS ce montant : il reçoit une
 *      explication à la place ;
 *   c. non-régression — une réponse qui cite un montant réellement présent
 *      dans un résultat d'outil traverse la garde intacte. C'est le test qui
 *      empêche la garde de devenir un filtre qui casse les bonnes réponses ;
 *   d. AC2/AC3 — le périmètre de refus part bien au modèle, avec la consigne
 *      d'expliquer plutôt que de lâcher une erreur technique.
 *
 * La règle 3 du CLAUDE.md — « un chiffre affiché à l'utilisateur vient toujours
 * d'un calcul déterministe, jamais du modèle » — n'était appliquée sur le chat
 * que par la rédaction du prompt. Ces tests vérifient qu'elle est désormais
 * VRAIE, pas seulement demandée.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  montantsEnonces,
  montantsSources,
  montantsNonSources,
  MESSAGE_REFUS_CHIFFRAGE,
} from "../lib/garde-montants";
import { cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie: string;

beforeAll(async () => {
  const email = `a63-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron A63", tenantNom: "Tenant A63" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  cookie = reg.headers["set-cookie"][0];
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

/**
 * Fait répondre au faux modèle le texte voulu, sans appel d'outil, puis
 * restaure `fetch`. Le `finally` n'est pas décoratif : une assertion qui
 * échoue laisserait sinon toute la suite avec un fetch détourné.
 */
async function avecReponseDuModele<T>(texte: string, action: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes("/chat/completions")) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-a63",
          object: "chat.completion",
          model: "test/fake-chat-model",
          choices: [{ index: 0, message: { role: "assistant", content: texte }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return original(input as Parameters<typeof original>[0], init);
  }) as typeof fetch;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

// ── a. La garde, unitairement ──────────────────────────────────────────────

describe("a — la garde distingue un montant sourcé d'un montant fabriqué", () => {
  test("un montant reformaté depuis des centimes est accepté", () => {
    // L'outil rend des centimes bruts, le modèle écrit des euros lisibles :
    // c'est le cas NOMINAL, il ne doit jamais être bloqué.
    const sources = ['[{"label":"Toiture","quotedAmountCents":150000}]'];
    expect(montantsNonSources("Le devis Toiture est à 1 500 €.", sources)).toEqual([]);
  });

  test("un montant déjà formaté en euros dans le prompt est accepté", () => {
    const sources = ["Pipeline actif : 3 affaires · 12 400 € de devis en cours"];
    expect(montantsNonSources("Vous avez 12 400 € de devis en cours.", sources)).toEqual([]);
  });

  test("un total additionné par le modèle est refusé", () => {
    // 1 500 + 2 000 : les deux termes sont sourcés, la SOMME ne l'est pas.
    // C'est exactement ce que la règle 3 interdit — le modèle a calculé.
    const sources = ['[{"quotedAmountCents":150000},{"quotedAmountCents":200000}]'];
    expect(montantsNonSources("Au total, cela fait 3 500 €.", sources)).toEqual([350000]);
  });

  test("un montant repris d'un message de l'utilisateur est accepté", () => {
    // Répéter ce que l'utilisateur vient de dire n'est pas l'inventer.
    const sources = ["J'ai facturé 2 000 € à Dupont le mois dernier"];
    expect(montantsNonSources("Vos 2 000 € facturés à Dupont sont bien enregistrés.", sources)).toEqual([]);
  });

  test("un nombre qui n'est pas un montant ne déclenche rien", () => {
    // « 7 affaires », « 2026 » : des nombres, pas des montants. Les confondre
    // ferait bloquer des réponses qui ne chiffrent rien du tout.
    expect(montantsEnonces("Vous avez 7 affaires en cours depuis 2026.")).toEqual([]);
    expect(montantsNonSources("Vous avez 7 affaires en cours depuis 2026.", [])).toEqual([]);
  });

  test("les variantes d'écriture d'un montant sont reconnues", () => {
    expect(montantsEnonces("1 500 €")).toEqual([150000]);
    expect(montantsEnonces("1500€")).toEqual([150000]);
    expect(montantsEnonces("1 500,50 euros")).toEqual([150050]);
    expect(montantsEnonces("2000 EUR")).toEqual([200000]);
  });

  test("les sources versent leurs deux lectures possibles, centimes et euros", () => {
    const s = montantsSources(["150000"]);
    expect(s.has(150000)).toBe(true);
    expect(s.has(15000000)).toBe(true);
  });
});

// ── b. AC1 — bout en bout, le montant inventé n'atteint pas l'utilisateur ──

describe("b — AC1 : un chiffre sans source n'atteint jamais l'écran", () => {
  test("« environ 3 000 € » est remplacé par une explication", async () => {
    const res = await avecReponseDuModele(
      "D'après mon expérience, ce genre de chantier tourne autour de 3 000 €.",
      () => request(serveurTest(app)).post("/api/chat/messages").set("Cookie", cookie).send({ content: "Combien pour une toiture ?" }),
    );

    expect(res.status).toBe(200);
    const contenu = res.body.content ?? res.body.message?.content ?? JSON.stringify(res.body);
    // Le montant n'est nulle part dans ce que reçoit l'utilisateur.
    expect(contenu).not.toContain("3 000");
    expect(contenu).not.toContain("3000");
    // Et il comprend pourquoi (AC3) — pas un code d'erreur.
    expect(contenu).toContain("ne provient d'aucune de vos données");
    expect(contenu).toBe(MESSAGE_REFUS_CHIFFRAGE);
  });
});

// ── c. Non-régression — la garde ne casse pas les bonnes réponses ─────────

describe("c — une réponse honnête traverse la garde intacte", () => {
  test("une réponse sans aucun montant est rendue telle quelle", async () => {
    const texte = "Vous avez 3 affaires en cours et 2 prospects à relancer.";
    const res = await avecReponseDuModele(texte, () =>
      request(serveurTest(app)).post("/api/chat/messages").set("Cookie", cookie).send({ content: "Où en suis-je ?" }),
    );
    expect(res.status).toBe(200);
    const contenu = res.body.content ?? res.body.message?.content ?? "";
    expect(contenu).toBe(texte);
  });

  test("un montant repris de la question de l'utilisateur est rendu tel quel", async () => {
    const texte = "Bien noté, je retiens 2 000 € pour ce devis.";
    const res = await avecReponseDuModele(texte, () =>
      request(serveurTest(app))
        .post("/api/chat/messages")
        .set("Cookie", cookie)
        .send({ content: "Note que le devis Dupont est à 2 000 €" }),
    );
    expect(res.status).toBe(200);
    const contenu = res.body.content ?? res.body.message?.content ?? "";
    expect(contenu).toBe(texte);
  });
});

// ── d. AC2/AC3 — le périmètre de refus part bien au modèle ────────────────

describe("d — AC2/AC3 : le périmètre de refus est dans le prompt", () => {
  test("le prompt système énonce les trois refus et la consigne d'expliquer", async () => {
    const original = globalThis.fetch;
    const prompts: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes("/chat/completions") && init?.body) {
        const body = JSON.parse(init.body as string) as { messages?: Array<{ role: string; content: unknown }> };
        for (const m of body.messages ?? []) {
          if (m.role === "system" && typeof m.content === "string") prompts.push(m.content);
        }
      }
      return original(input as Parameters<typeof original>[0], init);
    }) as typeof fetch;

    try {
      await request(serveurTest(app)).post("/api/chat/messages").set("Cookie", cookie).send({ content: "Bonjour" });
    } finally {
      globalThis.fetch = original;
    }

    const texte = prompts.join("\n");
    expect(texte).toContain("CE QUE TU REFUSES");
    expect(texte).toMatch(/n'estimes aucun prix/i);
    expect(texte).toMatch(/avis professionnel réglementé/i);
    expect(texte).toMatch(/engager l'entreprise/i);
    // AC3 : le refus doit s'expliquer, pas se contenter d'être un refus.
    expect(texte).toMatch(/explique POURQUOI/i);
  });
});
