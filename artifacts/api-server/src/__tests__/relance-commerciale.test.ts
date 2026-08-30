/**
 * Relancer un devis sans réponse — ticket 4.33.
 *
 * « Si je choisis les statuts prospect, devis envoyé, devis accepté, on doit
 * prévoir une relance du client par email et WhatsApp. »
 *
 * La route PROPOSE : chaque devis retenu devient une `pending_action` à
 * valider. Relancer un client engage le nom de l'entreprise — règle 4, sans
 * exception.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers.js";
// Les MÊMES fonctions que l'application : une garde qui recalculerait l'écart
// à sa façon vérifierait sa propre arithmétique, pas celle du produit.
import { toDateString, joursEntre } from "@nodaq/shared";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  const email = `rc-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Couverture Lemarchand" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantId = body.tenantId;
  tenantIds.push(tenantId);
  cookie = headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/**
 * ── LE DÉFAUT, ET POURQUOI LA PREMIÈRE CORRECTION NE CORRIGEAIT RIEN ────────
 *
 * Symptôme : `il y a 19 jours` devenait `20` sous `Pacific/Auckland`, après
 * 12 h UTC. Vert le matin, rouge l'après-midi, sans un changement de code.
 *
 * Mécanique. La donnée de test écrivait `now() - 19 jours`, soustraction faite
 * par PostgreSQL À L'INSERTION. L'application, elle, calcule `aujourdhui` À LA
 * REQUÊTE. Deux « maintenant » différents. En Nouvelle-Zélande (UTC+12),
 * minuit local tombe à 12 h 00 UTC PILE : une insertion à 11 h 59 min 59 s et
 * une requête 200 ms plus tard se retrouvent de part et d'autre du changement
 * de jour, et l'écart gagne un jour.
 *
 * PREMIÈRE CORRECTION, FAUSSE : construire la date passée sur le calendrier
 * local, à midi, « loin de minuit ». Reproduit hors base, elle donnait
 * toujours 20 — parce que le repère décalé n'est pas la date passée, c'est le
 * « quel jour on est », pris DEUX FOIS. Midi ou minuit, l'écart entre les deux
 * prises reste le même.
 *
 * CORRECTION RÉELLE : que les deux bouts partagent UN SEUL instant. L'horloge
 * est gelée le temps du test — `toFake: ["Date"]` uniquement, pour que les
 * minuteries de `pg` et de supertest continuent de tourner normalement. Le
 * serveur est dans le même processus : il voit la même heure que la donnée.
 *
 * La leçon dépasse ce fichier. Un test qui fabrique une DATE MÉTIER et
 * interroge ensuite un service qui recalcule « aujourd'hui » compare deux
 * horloges. Tant qu'elles ne sont pas la même, il existe une seconde par jour,
 * dans un fuseau quelque part, où il ment.
 *
 * L'application, elle, n'a pas ce défaut : elle écrit et relit `dateEnvoi`
 * avec la même horloge. Le défaut était dans le test — mais un test qui ment
 * une fois sur deux journées de CI aurait tout aussi bien pu masquer un vrai
 * défaut à côté.
 */
function ilYaNJours(jours: number): Date {
  const maintenant = new Date();
  return new Date(
    maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - jours,
    12, 0, 0, 0,
  );
}

/** Un devis ENVOYÉ il y a `jours` jours, avec un client joignable ou non. */
async function devisEnvoye(opts: {
  jours: number; telephone?: string | null; validUntil?: string | null; ttc?: number;
}): Promise<string> {
  const clientId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, $3, $4)`,
    [clientId, tenantId, "Delacroix", opts.telephone ?? null],
  );
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, client_id, status,
                        date_envoi, valid_until, total_ttc_cents)
     VALUES ($1, $2::uuid, $3, 'Delacroix', $4, 'ENVOYE', $5, $6, $7)`,
    [id, tenantId, `DEV-${crypto.randomBytes(3).toString("hex")}`, clientId,
     ilYaNJours(opts.jours), opts.validUntil ?? null, opts.ttc ?? 1454030],
  );
  return id;
}

const proposer = () =>
  request(serveurTest(app)).post("/api/relance/devis/proposer").set("Cookie", cookie);

const actions = async (): Promise<Array<Record<string, unknown>>> => {
  const { rows } = await adminPool.query(
    `SELECT label, description, payload FROM pending_actions
      WHERE tenant_id = $1 AND type = 'relance_devis' ORDER BY created_at DESC`, [tenantId],
  );
  return rows as Array<Record<string, unknown>>;
};

/*
 * L'horloge est gelée pour CHAQUE test de ce fichier — voir l'explication au
 * dessus de `ilYaNJours`. Seul `Date` est simulé : les minuteries du pool
 * PostgreSQL et de supertest doivent continuer de tourner, sans quoi la
 * moindre attente réseau se figerait avec elle.
 *
 * Gelée sur l'instant RÉEL, sans décalage : il ne s'agit pas de se placer à
 * une heure commode, mais d'empêcher que deux « maintenant » diffèrent. Un
 * instant déplacé dans le passé passerait d'ailleurs avant la création de la
 * session du `beforeAll`, et l'authentification s'écroulerait.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("le repère de date tient à minuit, dans tous les fuseaux", () => {
  test("l'écart est exact à TOUTE heure de la journée", () => {
    /*
     * Vingt-quatre instants, chacun à une seconde de la fin d'une heure — donc
     * l'un d'eux tombe forcément juste avant minuit local, quel que soit le
     * fuseau du processus. C'est précisément la seconde où le défaut se
     * manifestait ; elle est désormais parcourue à chaque exécution, partout,
     * et plus seulement quand la CI a la malchance de tourner à ce moment-là.
     */
    for (let heure = 0; heure < 24; heure++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 30, heure, 59, 59, 900)));
      const aujourdhui = toDateString(new Date());
      for (const n of [0, 1, 7, 19, 30, 365]) {
        expect(
          joursEntre(toDateString(ilYaNJours(n)), aujourdhui),
          `à ${heure} h 59 UTC, « il y a ${n} jours » ne vaut pas ${n} jours`,
        ).toBe(n);
      }
    }
  });

  test("l'horloge est bien gelée — c'est ELLE qui corrige, pas l'arithmétique", () => {
    /*
     * La garde ci-dessus passerait même sans gel : elle ne prend « maintenant »
     * qu'une fois. Or le défaut venait de le prendre DEUX fois, à l'insertion
     * puis à la requête. Ce qu'il faut donc protéger, c'est le gel lui-même —
     * et cela se lit dans la source, pas dans un calcul.
     *
     * Une première correction fixait la date fabriquée à midi et se croyait
     * suffisante. Reproduite hors base, elle rendait toujours 20 sous
     * Pacific/Auckland. Sans cette garde-ci, rien n'empêcherait d'y revenir.
     */
    const source = readFileSync(new URL(import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(source, "le gel de l'horloge a disparu de ce fichier")
      .toMatch(/vi\.useFakeTimers\(\{\s*toFake:\s*\["Date"\]\s*\}\)/);
    // Seul `Date` est simulé : simuler les minuteries figerait le pool
    // PostgreSQL et supertest avec lui, et le fichier entier s'arrêterait.
    expect(source).not.toMatch(/vi\.useFakeTimers\(\)/);
  });
});

describe("a — la proposition, pas l'envoi", () => {
  test("un devis sans réponse depuis 19 jours devient une action à valider", async () => {
    await devisEnvoye({ jours: 19, telephone: "06 12 34 56 78" });
    const { body } = await proposer().expect(201);

    expect(body.proposes).toBe(1);
    const [a] = await actions();
    expect(String(a!["label"])).toContain("Relancer Delacroix");

    const p = a!["payload"] as Record<string, unknown>;
    // Le message est FIGÉ à la proposition : le recalculer à la validation
    // ferait valider un texte et en envoyer un autre.
    expect(String(p["corps"])).toContain("14540.30 € TTC");
    expect(String(p["corps"])).toContain("il y a 19 jours");
    expect(String(p["lienWhatsApp"])).toContain("https://wa.me/33612345678?text=");
  });

  test("RIEN n'est envoyé — aucune trace de relance au journal d'envois", async () => {
    /*
     * L'assertion portait sur un journal VIDE. C'était un raccourci commode
     * tant que rien d'autre n'y écrivait — et il a cessé de l'être le
     * 30/08/2026, quand l'inscription s'est mise à envoyer un code de
     * connexion, qui laisse légitimement sa trace ici.
     *
     * L'intention, elle, ne bouge pas : la règle 4 n'admet pas d'exception,
     * relancer se VALIDE d'abord. On la dit désormais telle quelle, en
     * excluant le courriel de sécurité qui n'a rien à voir avec la relance.
     * Plus précis qu'avant, et non plus permissif.
     */
    const { rows } = await adminPool.query(
      `SELECT coalesce(string_agg(DISTINCT document_type, ','), '') AS types
         FROM envois_journal
        WHERE tenant_id = $1 AND document_type <> 'CODE_CONNEXION'`,
      [tenantId],
    );
    expect(rows[0].types, "aucun document commercial ne doit être parti").toBe("");
  });
});

describe("b — les refus, et leur motif", () => {
  test("un devis trop récent n'est pas proposé, et on dit pourquoi", async () => {
    const t2 = await inscrireAutre("recent");
    await devisPour(t2, 2);
    const { body } = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);

    expect(body.proposes).toBe(0);
    // Une campagne qui ne propose rien doit pouvoir dire pourquoi, sinon elle
    // passe pour cassée.
    expect(body.ecartes[0].motif).toBe("delai_non_atteint");
  });

  test("un devis EXPIRÉ se refait, il ne se relance pas", async () => {
    const t2 = await inscrireAutre("expire");
    await devisPour(t2, 30, "2020-01-01");
    const { body } = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    expect(body.proposes).toBe(0);
    expect(body.ecartes[0].motif).toBe("expire");
  });
});

describe("c — on ne relance pas deux fois", () => {
  test("relancer la campagne ne reproduit pas la même action", async () => {
    const t2 = await inscrireAutre("doublon");
    await devisPour(t2, 20);

    const un = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    expect(un.body.proposes).toBe(1);

    const deux = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    // Sans marquage immédiat, la file se remplirait de doublons à chaque
    // exécution — l'humain n'ayant pas encore tranché la première.
    expect(deux.body.proposes).toBe(0);
    expect(deux.body.ecartes[0].motif).toBe("deja_relance");
  });
});

describe("d — sans numéro exploitable, l'e-mail seul", () => {
  test("le lien WhatsApp est nul, et la description le dit", async () => {
    const t2 = await inscrireAutre("sans-tel");
    await devisPour(t2, 20, null, null);
    await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);

    const { rows } = await adminPool.query(
      `SELECT description, payload FROM pending_actions
        WHERE tenant_id = $1 AND type = 'relance_devis'`, [t2.tenantId],
    );
    expect((rows[0].payload as Record<string, unknown>)["lienWhatsApp"]).toBeNull();
    expect(String(rows[0].description)).toContain("e-mail seulement");
  });
});

// ── Aides ───────────────────────────────────────────────────────────────────

interface Autre { cookie: string; tenantId: string }

async function inscrireAutre(nom: string): Promise<Autre> {
  const email = `rc-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `T-${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function devisPour(
  t: Autre, jours: number, validUntil: string | null = null, telephone: string | null = "0612345678",
): Promise<void> {
  const clientId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, 'Delacroix', $3)`,
    [clientId, t.tenantId, telephone],
  );
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, client_id, status,
                        date_envoi, valid_until, total_ttc_cents)
     VALUES ($1, $2::uuid, $3, 'Delacroix', $4, 'ENVOYE',
             now() - ($5 || ' days')::interval, $6, 100000)`,
    [crypto.randomUUID(), t.tenantId, `DEV-${crypto.randomBytes(3).toString("hex")}`,
     clientId, String(jours), validUntil],
  );
}
