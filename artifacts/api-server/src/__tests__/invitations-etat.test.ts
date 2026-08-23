/*
 * L'état d'une invitation, de bout en bout — ticket 4.27.
 *
 * ── Le verbatim que ces tests rendent faux ────────────────────────────────
 * « Quand j'invite un comptable, je check la boîte mail, aucune invitation
 * n'apparaît même dans les spams. » Le courrier ne partait pas, et RIEN ne le
 * disait : l'écran affichait une invitation « en attente », indistinguable
 * d'une invitation partie.
 *
 * ── Ce que l'audit du 23/08 avait sous-estimé ─────────────────────────────
 * L'échec était déjà capté — `envois_journal` porte statut, motif et date, en
 * append-only. Ce qui manquait, c'est de le LIRE, de pouvoir renvoyer, et de
 * retrouver le lien. Ces tests couvrent ces trois-là.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `inv-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Inv ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

/** Invite quelqu'un, et rend la réponse de la route. */
const inviter = (c: string, email: string, role = "ACCOUNTANT") =>
  request(serveurTest(app)).post("/api/membres/inviter").set("Cookie", c)
    .send({ email, role });

/** L'invitation telle que l'écran « Membres » la voit. */
async function vueEcran(c: string, email: string) {
  const { body } = await request(serveurTest(app)).get("/api/membres").set("Cookie", c).expect(200);
  return body.invitationsEnAttente.find((i: { email: string }) => i.email === email);
}

beforeAll(async () => {
  const t = await inscrire("a");
  cookie = t.cookie; tenantId = t.tenantId;
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("l'échec d'envoi cesse d'être invisible", () => {
  test("sans serveur d'envoi, l'écran dit que le courrier n'est pas parti", async () => {
    // La suite tourne sans SMTP : c'est exactement la situation du testeur du
    // 22/08. L'invitation est créée, le courrier ne part pas.
    const destinataire = `compta-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body } = await inviter(cookie, destinataire).expect(201);

    const vue = await vueEcran(cookie, destinataire);
    expect(vue).toBeDefined();

    if (body.envoye) {
      // Un environnement AVEC serveur d'envoi : l'état doit alors dire
      // « envoyé », jamais rester muet.
      expect(vue.etat).toBe("ENVOYEE");
      expect(vue.libelleEtat).toBe("Courrier envoyé");
    } else {
      expect(vue.etat).toBe("ECHOUEE");
      expect(vue.libelleEtat).toBe("Le courrier n'est pas parti");
      // Et surtout : ce qu'il faut FAIRE, pas seulement ce qui a échoué.
      expect(vue.explication).toMatch(/Renvoyez|copiez le lien/i);
      expect(vue.actions.renvoyer).toBe(true);
      expect(vue.actions.copierLien).toBe(true);
    }
  });

  test("le lien est rendu en clair à la création — la sortie de secours", async () => {
    // C'est ce qui permet d'inviter son comptable quand aucun serveur d'envoi
    // n'est branché. Aucun secret nouveau : c'est ce que l'e-mail transporte.
    const destinataire = `secours-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body } = await inviter(cookie, destinataire).expect(201);
    expect(body.lienInvitation).toMatch(/\/membres\/accepter\/[0-9a-f]{64}$/);
  });

  test("le motif technique est rendu, pas seulement « échec »", async () => {
    const destinataire = `motif-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body } = await inviter(cookie, destinataire).expect(201);
    if (!body.envoye) {
      // « boîte pleine » et « aucun serveur configuré » ne se corrigent pas au
      // même endroit : un « échec » nu enverrait chercher au mauvais.
      expect(body.motifEchec).toBeTruthy();
    }
  });
});

describe("l'ouverture du lien", () => {
  test("suivre le lien fait passer l'invitation à « ouverte »", async () => {
    const t = await inscrire("ouvre");
    const destinataire = `ouvre-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body } = await inviter(t.cookie, destinataire).expect(201);
    const token = body.lienInvitation.split("/").pop();

    // Avant : jamais ouverte.
    const [{ rows: avant }] = [await adminPool.query(
      "SELECT opened_at FROM tenant_invites WHERE id = $1", [body.id],
    )];
    expect(avant[0].opened_at).toBeNull();

    await request(serveurTest(app)).get(`/api/membres/inviter/${token}`).expect(200);

    const { rows: apres } = await adminPool.query(
      "SELECT opened_at FROM tenant_invites WHERE id = $1", [body.id],
    );
    expect(apres[0].opened_at).not.toBeNull();
  });

  test("recharger le lien ne réécrit pas la date — c'est une première fois", async () => {
    const t = await inscrire("recharge");
    const destinataire = `recharge-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body } = await inviter(t.cookie, destinataire).expect(201);
    const token = body.lienInvitation.split("/").pop();

    await request(serveurTest(app)).get(`/api/membres/inviter/${token}`).expect(200);
    const { rows: premier } = await adminPool.query(
      "SELECT opened_at FROM tenant_invites WHERE id = $1", [body.id],
    );

    await request(serveurTest(app)).get(`/api/membres/inviter/${token}`).expect(200);
    const { rows: second } = await adminPool.query(
      "SELECT opened_at FROM tenant_invites WHERE id = $1", [body.id],
    );

    // Écraser la date à chaque rechargement effacerait l'information qu'on
    // cherche : quand l'invitation a-t-elle été vue pour la PREMIÈRE fois.
    expect(second[0].opened_at.getTime()).toBe(premier[0].opened_at.getTime());
  });
});

describe("le renvoi", () => {
  test("renvoyer crée un NOUVEAU lien, et invalide l'ancien", async () => {
    const t = await inscrire("renvoi");
    const destinataire = `renvoi-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body: initial } = await inviter(t.cookie, destinataire).expect(201);
    const ancienToken = initial.lienInvitation.split("/").pop();

    const { body: renvoi } = await request(serveurTest(app))
      .post(`/api/membres/invitations/${initial.id}/renvoyer`).set("Cookie", t.cookie)
      .expect(200);

    const nouveauToken = renvoi.lienInvitation.split("/").pop();
    expect(nouveauToken).not.toBe(ancienToken);

    // L'ancien lien ne fonctionne plus : seul le condensat du jeton est
    // conservé, on ne peut pas réexpédier celui d'origine. L'écran le dit.
    await request(serveurTest(app)).get(`/api/membres/inviter/${ancienToken}`).expect(404);
    await request(serveurTest(app)).get(`/api/membres/inviter/${nouveauToken}`).expect(200);
  });

  test("renvoyer remet le compteur d'ouverture à zéro", async () => {
    // Le nouveau lien n'a jamais été ouvert : garder l'ancienne date ferait
    // afficher « ouvert » pour un courrier que personne n'a encore vu.
    const t = await inscrire("renvoi-ouvre");
    const destinataire = `ro-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    const { body: initial } = await inviter(t.cookie, destinataire).expect(201);
    const token = initial.lienInvitation.split("/").pop();
    await request(serveurTest(app)).get(`/api/membres/inviter/${token}`).expect(200);

    await request(serveurTest(app))
      .post(`/api/membres/invitations/${initial.id}/renvoyer`).set("Cookie", t.cookie).expect(200);

    const { rows } = await adminPool.query(
      "SELECT opened_at, renvoyee_le FROM tenant_invites WHERE id = $1", [initial.id],
    );
    expect(rows[0].opened_at).toBeNull();
    expect(rows[0].renvoyee_le).not.toBeNull();
  });

  test("une invitation acceptée ne se renvoie pas", async () => {
    const t = await inscrire("acceptee");
    const destinataire = `acc-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    emails.push(destinataire);
    const { body: initial } = await inviter(t.cookie, destinataire).expect(201);
    const token = initial.lienInvitation.split("/").pop();

    await request(serveurTest(app))
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password: "test-pass-1234", nom: "Comptable" })
      .expect((r) => { if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`); });

    // Le nouveau jeton n'aurait aucun effet sur un accès déjà ouvert, mais
    // laisserait croire le contraire.
    await request(serveurTest(app))
      .post(`/api/membres/invitations/${initial.id}/renvoyer`).set("Cookie", t.cookie)
      .expect(409);
  });

  test("l'invitation d'un autre tenant ne se renvoie pas", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const { body } = await inviter(a.cookie, `iso-${crypto.randomBytes(3).toString("hex")}@exemple.fr`).expect(201);

    // RLS : `withTenant` ne voit pas la ligne, la route rend 404 — jamais 403,
    // qui confirmerait l'existence de l'invitation.
    await request(serveurTest(app))
      .post(`/api/membres/invitations/${body.id}/renvoyer`).set("Cookie", b.cookie)
      .expect(404);
  });
});

describe("le parcours complet du ticket", () => {
  test("inviter → échec visible → renvoyer → accepter → disparaît des invitations", async () => {
    const t = await inscrire("parcours");
    const destinataire = `parcours-${crypto.randomBytes(3).toString("hex")}@exemple.fr`;
    emails.push(destinataire);

    // 1. Inviter.
    const { body: initial } = await inviter(t.cookie, destinataire).expect(201);
    let vue = await vueEcran(t.cookie, destinataire);
    expect(["ECHOUEE", "ENVOYEE"]).toContain(vue.etat);

    // 2. Renvoyer — l'action que l'écran propose dans les deux cas.
    expect(vue.actions.renvoyer).toBe(true);
    const { body: renvoi } = await request(serveurTest(app))
      .post(`/api/membres/invitations/${initial.id}/renvoyer`).set("Cookie", t.cookie).expect(200);
    const token = renvoi.lienInvitation.split("/").pop();

    // 3. Le destinataire ouvre.
    await request(serveurTest(app)).get(`/api/membres/inviter/${token}`).expect(200);
    vue = await vueEcran(t.cookie, destinataire);
    // Ouvert PRIME sur envoyé, mais pas sur un échec : si le renvoi a lui
    // aussi échoué, l'écran doit continuer à le dire.
    expect(["OUVERTE", "ECHOUEE"]).toContain(vue.etat);

    // 4. Il accepte.
    await request(serveurTest(app))
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password: "test-pass-1234", nom: "Comptable" })
      .expect((r) => { if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`); });

    // 5. L'invitation quitte la liste des invitations en attente, et le
    //    comptable apparaît dans les membres.
    const { body: apres } = await request(serveurTest(app))
      .get("/api/membres").set("Cookie", t.cookie).expect(200);
    expect(apres.invitationsEnAttente.some((i: { email: string }) => i.email === destinataire)).toBe(false);
    expect(apres.membres.some((m: { email: string }) => m.email === destinataire)).toBe(true);
  });
});
