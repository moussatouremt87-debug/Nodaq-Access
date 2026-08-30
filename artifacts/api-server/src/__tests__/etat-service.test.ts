/**
 * La page d'état — ce qu'elle doit dire, et surtout ce qu'elle ne doit pas.
 *
 * Deux propriétés valent la peine d'être gardées :
 *
 *   1. elle est PUBLIQUE. Une page d'état derrière une session ne répond pas à
 *      la question qu'on lui pose — « est-ce en panne, ou c'est moi ? » se
 *      demande précisément quand on n'arrive pas à entrer ;
 *   2. elle ne DIVULGUE RIEN. Elle est lisible par n'importe qui : un défaut
 *      de configuration ne doit pas devenir une carte du système.
 *
 * ── POURQUOI LES DEUX ÉTATS SONT PARCOURUS ──────────────────────────────────
 *
 * La première version de ces gardes n'interrogeait la route qu'une fois, dans
 * l'environnement de test — où tout est configuré. Elle ne voyait donc QUE les
 * messages du cas nominal.
 *
 * Injection faite : `LLM_BASE_URL absent` et `Uptime` glissés dans le message
 * de panne. Les dix tests sont restés verts. La branche piégée n'était jamais
 * rendue, et c'est justement celle qui porte le risque — la façon naturelle
 * d'écrire un diagnostic utile est de NOMMER ce qui manque.
 *
 * D'où `vi.stubEnv` : chaque garde est passée sur les deux réponses, celle où
 * tout fonctionne et celle où plus rien n'est configuré. Une garde qui n'a
 * jamais vu la panne ne protège pas contre elle.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import app from "../app";
import { serveurTest } from "./helpers";
import { MESSAGE_GLOBAL } from "../routes/etat-service";

const ETATS = ["operationnel", "degrade", "indisponible"] as const;

type Composant = { nom: string; etat: string; consequence: string | null; tempsReponseMs?: number };
type Corps = { global: string; message: string; composants: Composant[]; limite: string; verifieLe: string };

async function etat(): Promise<Corps> {
  const res = await request(serveurTest(app)).get("/api/etat");
  expect(res.status).toBe(200);
  return res.body as Corps;
}

/** L'état tel qu'il se présente quand PLUS RIEN n'est configuré. */
async function etatToutEnPanne(): Promise<Corps> {
  for (const v of ["LLM_BASE_URL", "LLM_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    vi.stubEnv(v, "");
  }
  return etat();
}

/** Tout ce qu'un visiteur LIT réellement sur la page. */
function texteLisible(c: Corps): string {
  return [c.message, c.limite, ...c.composants.flatMap((x) => [x.nom, x.consequence ?? ""])].join(" ");
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("l'état des services est public", () => {
  test("il se sert sans session", async () => {
    const c = await etat();
    expect(c.composants.length).toBeGreaterThanOrEqual(3);
  });

  test("chaque composant porte un état connu et un nom en français", async () => {
    for (const x of (await etat()).composants) {
      expect(ETATS).toContain(x.etat);
      expect(x.nom.length).toBeGreaterThan(0);
    }
  });

  test("la base est réellement interrogée — pas seulement déclarée saine", async () => {
    const base = (await etat()).composants.find((x) => x.nom === "Base de données")!;
    // Une mesure de temps prouve qu'un aller-retour a eu lieu. Sans elle, la
    // ligne « opérationnel » ne vaudrait pas plus qu'une constante.
    expect(base.etat).toBe("operationnel");
    expect(typeof base.tempsReponseMs).toBe("number");
  });

  test("l'état d'ensemble est le PIRE des composants, jamais une moyenne", async () => {
    const c = await etat();
    const etats = c.composants.map((x) => x.etat);
    const attendu = etats.includes("indisponible")
      ? "indisponible" : etats.includes("degrade") ? "degrade" : "operationnel";
    expect(c.global).toBe(attendu);
    expect(c.message).toBe(MESSAGE_GLOBAL[attendu as keyof typeof MESSAGE_GLOBAL]);
  });

  test("une sortie modèle absente rend le service indisponible, pas la page entière", async () => {
    const c = await etatToutEnPanne();
    // La page doit RESTER servie : c'est au moment de la panne qu'on la lit.
    expect(c.global).toBe("indisponible");
    const assistant = c.composants.find((x) => x.nom.startsWith("Assistant"))!;
    expect(assistant.etat).toBe("indisponible");
    expect(assistant.consequence).toBeTruthy();
    // Et la base, elle, continue d'être rapportée comme fonctionnelle.
    expect(c.composants.find((x) => x.nom === "Base de données")!.etat).toBe("operationnel");
  });

  test("elle n'est jamais servie depuis un cache", async () => {
    const res = await request(serveurTest(app)).get("/api/etat");
    // Une page d'état lue dans un cache est un mensonge daté : elle dirait
    // « tout va bien » pendant la panne qu'elle est censée annoncer.
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  test("elle dit franchement ce qu'elle ne peut pas voir", async () => {
    // Servie par l'application qu'elle surveille, elle se tait avec elle. Le
    // taire serait promettre une couverture qu'elle n'a pas.
    expect((await etat()).limite).toMatch(/interrompu/i);
  });
});

describe("elle ne divulgue aucune configuration", () => {
  const INTERDITS = [
    "LLM_BASE_URL", "LLM_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
    "DATABASE_URL", "process.env", "scw.cloud", "rdb.", "postgres://",
  ];

  test("aucune variable nommée — ni en marche, ni en panne", async () => {
    for (const corps of [await etat(), await etatToutEnPanne()]) {
      const texte = JSON.stringify(corps);
      for (const mot of INTERDITS) {
        expect(texte, `« ${mot} » divulgué sur une page publique`).not.toContain(mot);
      }
    }
  });

  test("aucune valeur d'environnement ne fuit — ni en marche, ni en panne", async () => {
    const valeurs = Object.entries(process.env)
      // Les valeurs courtes ('1', 'test') apparaîtraient par hasard ; seules
      // celles assez longues pour être identifiantes sont vérifiées.
      .filter(([, v]) => v && v.length >= 12) as [string, string][];
    for (const corps of [await etat(), await etatToutEnPanne()]) {
      const texte = JSON.stringify(corps);
      for (const [nom, valeur] of valeurs) {
        expect(texte, `valeur de ${nom} présente dans la réponse`).not.toContain(valeur);
      }
    }
  });
});

describe("le texte parle à un artisan", () => {
  const JARGON = [
    "uptime", "downtime", "healthcheck", "status", "endpoint", "latency",
    "dashboard", "sla", "incident.io", "monitoring", "timeout",
  ];

  test("aucun terme anglo-saxon — ni en marche, ni en panne", async () => {
    for (const corps of [await etat(), await etatToutEnPanne()]) {
      const lisible = texteLisible(corps).toLowerCase();
      for (const mot of JARGON) {
        expect(lisible, `jargon « ${mot} » (règle 3 bis b)`).not.toContain(mot);
      }
    }
  });

  test("chaque panne dit ce qu'on PEUT encore faire", async () => {
    /*
     * Une page d'état qui se contente d'afficher « interrompu » laisse
     * l'artisan devant un mur. Chaque composant en panne porte donc sa
     * conséquence, et cette conséquence nomme ce qui continue de marcher.
     */
    const c = await etatToutEnPanne();
    const enPanne = c.composants.filter((x) => x.etat !== "operationnel");
    expect(enPanne.length).toBeGreaterThan(0);
    for (const x of enPanne) {
      expect(x.consequence, `${x.nom} sans conséquence`).toBeTruthy();
      expect(x.consequence!.length).toBeGreaterThan(30);
    }
    // Au moins une dit explicitement ce qui reste utilisable.
    expect(enPanne.map((x) => x.consequence).join(" "))
      .toMatch(/fonctionne normalement|continuer à travailler/);
  });

  test("l'écran public rend la page hors de la coquille de l'application", () => {
    // Un visiteur sans session ne doit voir ni la navigation du produit ni la
    // requête `/auth/me` qu'entraîne l'AppShell — même raison qu'au ticket des
    // pages publiques de devis.
    const app = readFileSync(new URL("../../../nodaq/src/App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/ROUTES_PUBLIQUES[\s\S]*'\/etat'/);
  });
});
