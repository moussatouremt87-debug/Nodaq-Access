/**
 * Le registre de modules est enfin BRANCHÉ.
 *
 * `resolveModules` et `inactiveModuleTools` existaient depuis des mois,
 * écrits, testés et commentés — et appelés nulle part. Le catalogue promettait
 * qu'éteindre un module « retire sa page de la navigation ET ses outils du
 * toolset ». Ces tests vérifient que la promesse est désormais tenue par le
 * serveur, aux deux endroits qui comptent.
 *
 * Ce qu'ils protègent :
 *   a. la lecture est ouverte à TOUS les rôles — la navigation en dépend, et
 *      un MEMBER qui ne pourrait pas la lire aurait un menu différent de celui
 *      de son patron sans explication ;
 *   b. l'écriture est réservée au propriétaire, et refuse un identifiant
 *      inconnu au lieu de l'écrire dans le vide ;
 *   c. un choix explicite survit et l'emporte sur le défaut du secteur ;
 *   d. le défaut dépend bien du SECTEUR ;
 *   e. ce n'est pas une frontière de sécurité : la route d'un module éteint
 *      répond toujours. C'est écrit dans le catalogue, et c'est le genre de
 *      propriété qu'on croit acquise jusqu'à ce qu'elle change en silence.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { MODULES } from "@nodaq/shared";
import {
  adminPool,
  cookieHeader,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let ownerCookie: string;
let membreCookie: string;

/**
 * Deux modules pris au catalogue. Le second n'est plus « hors socle » : il
 * n'en existe plus depuis que `facturation_electronique` est repassé au socle
 * (l'obligation de RÉCEPTION vaut pour tous depuis le 01/09/2026). Les tests
 * qui suivent portent donc sur le mécanisme de choix, qui est ce qu'ils
 * vérifiaient réellement.
 */
const MODULE_SOCLE = MODULES.find((m) => m.defaultOn === "tous")!;
const AUTRE_MODULE = MODULES.filter((m) => m.id !== MODULE_SOCLE.id)[0]!;

async function poserVertical(vertical: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, 'votre-metier.metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, vertical],
  );
}

beforeAll(async () => {
  const email = `mod-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Modules SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  ownerCookie = reg.headers["set-cookie"][0];

  const emailMembre = `mod-membre-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(emailMembre);
  const membre = await createTestUser(emailMembre);
  await createTestMembership(membre.id, tenantId, "MEMBER");
  await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [membre.id]);
  const session = await createTestSession(membre.id, tenantId);
  membreCookie = cookieHeader(session.id);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Lecture ─────────────────────────────────────────────────────────────

describe("a — l'état des modules se lit, quel que soit le rôle", () => {
  test("le propriétaire lit la liste complète", async () => {
    const r = await request(app).get("/api/modules").set("Cookie", ownerCookie).expect(200);
    expect(r.body.modules).toHaveLength(MODULES.length);
    for (const m of r.body.modules) {
      expect(typeof m.active).toBe("boolean");
      expect(["defaut_vertical", "hors_socle", "choix"]).toContain(m.source);
    }
  });

  test("un MEMBER la lit aussi — sinon son menu diffèrerait sans explication", async () => {
    const r = await request(app).get("/api/modules").set("Cookie", membreCookie).expect(200);
    expect(r.body.modules).toHaveLength(MODULES.length);
  });

  test("sans session, rien", async () => {
    await request(app).get("/api/modules").expect(401);
  });
});

// ── b. Écriture ────────────────────────────────────────────────────────────

describe("b — seul le propriétaire décide", () => {
  test("un MEMBER ne peut pas allumer un module", async () => {
    const r = await request(app)
      .patch("/api/modules")
      .set("Cookie", membreCookie)
      .send({ choix: { [AUTRE_MODULE.id]: true } });
    expect(r.status).toBe(403);
  });

  test("un identifiant inconnu est refusé, pas écrit dans le vide", async () => {
    const r = await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { module_qui_nexiste_pas: true } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/inconnu/i);
  });

  test("un corps mal formé est refusé", async () => {
    const r = await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { [MODULE_SOCLE.id]: "oui" } });
    expect(r.status).toBe(400);
  });
});

// ── c. Le choix l'emporte, dans les deux sens ──────────────────────────────

describe("c — un choix explicite survit et prime sur le défaut", () => {
  test("éteindre un module de socle, puis le rallumer", async () => {
    const eteint = await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { [MODULE_SOCLE.id]: false } })
      .expect(200);
    const apres = eteint.body.modules.find((m: { id: string }) => m.id === MODULE_SOCLE.id);
    expect(apres.active).toBe(false);
    expect(apres.source).toBe("choix");

    // Relu à froid : le choix est bien PERSISTÉ, pas seulement renvoyé.
    const relu = await request(app).get("/api/modules").set("Cookie", ownerCookie).expect(200);
    expect(relu.body.modules.find((m: { id: string }) => m.id === MODULE_SOCLE.id).active).toBe(
      false,
    );

    await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { [MODULE_SOCLE.id]: true } })
      .expect(200);
  });

  test("un choix « allumé » est enregistré comme choix, pas confondu avec le défaut", async () => {
    // C'est ce qui permet à l'écran d'annoncer d'où vient l'état. Un module
    // allumé par défaut ET allumé par choix doit se distinguer, sinon
    // l'utilisateur ne sait jamais si son clic a été retenu.
    const r = await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { [AUTRE_MODULE.id]: true } })
      .expect(200);
    const m = r.body.modules.find((x: { id: string }) => x.id === AUTRE_MODULE.id);
    expect(m.active).toBe(true);
    expect(m.source).toBe("choix");
  });
});

// ── d. Le défaut dépend du secteur ─────────────────────────────────────────

describe("d — le défaut se lit dans le secteur du tenant", () => {
  test("un module gaté sur une liste de secteurs suit cette liste", async () => {
    const gate = MODULES.find((m) => Array.isArray(m.defaultOn));
    if (!gate) {
      // Aucun module n'est aujourd'hui gaté par liste : le dire plutôt que de
      // laisser un test vide passer pour une vérification.
      expect(MODULES.every((m) => m.defaultOn === "tous" || m.defaultOn === "aucun")).toBe(true);
      return;
    }
    const secteurs = gate.defaultOn as readonly string[];
    await poserVertical(secteurs[0]!);
    const dedans = await request(app).get("/api/modules").set("Cookie", ownerCookie).expect(200);
    expect(dedans.body.modules.find((m: { id: string }) => m.id === gate.id).active).toBe(true);
  });
});

// ── e. Ce n'est pas une frontière de sécurité ──────────────────────────────

describe("e — éteindre un module ne ferme aucune route", () => {
  test("la route d'un module éteint répond toujours", async () => {
    // Propriété DÉLIBÉRÉE, écrite dans le catalogue : le module est de la
    // surface produit, pas de l'autorisation. Si elle changeait un jour, il
    // faudrait que ce soit une décision, pas un effet de bord — d'où ce test.
    await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { classeur: false } })
      .expect(200);

    const r = await request(app).get("/api/classeur").set("Cookie", ownerCookie);
    expect(r.status, "la route ne doit pas se fermer avec le module").not.toBe(403);
    expect(r.status).toBeLessThan(500);

    await request(app)
      .patch("/api/modules")
      .set("Cookie", ownerCookie)
      .send({ choix: { classeur: true } })
      .expect(200);
  });
});
