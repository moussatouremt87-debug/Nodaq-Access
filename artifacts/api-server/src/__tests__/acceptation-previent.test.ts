/**
 * Un devis accepté PRÉVIENT l'artisan.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * L'acceptation publique écrivait quatre champs dans la table des devis —
 * statut, horodatage, signataire, adresse — et strictement rien d'autre. Pas
 * d'entrée dans `activity`, pas d'e-mail, aucun signal.
 *
 * Un client signait, et l'artisan ne l'apprenait qu'en allant regarder sa
 * liste de devis. C'est l'événement commercialement le plus important du
 * produit, et celui où le rappel doit être le plus rapide : on cale une date
 * au moment de la signature, pas trois jours après.
 *
 * ── CE QUE CES TESTS PROTÈGENT ────────────────────────────────────────────
 * Le premier est la garde du défaut. Les deux autres couvrent les façons de
 * l'abîmer sans le voir :
 *
 *   — une seconde acceptation qui rejouerait l'annonce : l'artisan croirait
 *     à deux signatures, et rappellerait un client déjà rappelé ;
 *   — une notification qui ferait ÉCHOUER l'acceptation. L'acceptation est
 *     l'acte du client, elle est écrite et ne se rejoue pas. Un e-mail qui
 *     ne part pas ne doit jamais la défaire — et en environnement de test
 *     aucun SMTP n'est configuré, donc ce cas est le cas NORMAL ici.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
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
let tenantId = "";

/** Une adresse distincte par appel : la limitation de débit compte par IP et
 *  on ne désarme pas une garde qu'on traverse. */
let compteurIp = 0;
const ipUnique = () => `198.51.100.${(compteurIp++ % 250) + 1}`;
const publicPost = (chemin: string) =>
  request(serveurTest(app)).post(chemin).set("X-Forwarded-For", ipUnique());

beforeAll(async () => {
  const email = `acc-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Menuiserie Aubert" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
}, 90_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM activity WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Un devis ENVOYÉ, jeton en clair rendu — condensat seul en base, comme la
 *  vraie route d'envoi. */
async function devisEnvoye(montantCents = 24_000): Promise<{ token: string; reference: string }> {
  const token = crypto.randomUUID();
  const reference = `DEV-${crypto.randomBytes(3).toString("hex")}`;
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, status,
                        total_ttc_cents, accept_token_sha256, date_envoi)
     VALUES ($1, $2::uuid, $3, 'Madame Delacroix', 'ENVOYE', $4, $5, NOW())`,
    [
      crypto.randomUUID(),
      tenantId,
      reference,
      montantCents,
      crypto.createHash("sha256").update(token).digest("hex"),
    ],
  );
  return { token, reference };
}

async function annonces(): Promise<Array<{ label: string; meta: string }>> {
  const { rows } = await adminPool.query(
    `SELECT label, meta FROM activity
      WHERE tenant_id = $1::uuid AND type = 'devis.accepte'
      ORDER BY created_at`,
    [tenantId],
  );
  return rows;
}

async function viderAnnonces(): Promise<void> {
  await adminPool.query(`DELETE FROM activity WHERE tenant_id = $1::uuid`, [tenantId]);
}

describe("Accepter un devis prévient l'artisan", () => {
  test("l'acceptation écrit une annonce dans le fil d'activité", async () => {
    await viderAnnonces();
    const { token, reference } = await devisEnvoye(24_000);

    await publicPost(`/api/public/devis/${token}/accept`)
      .send({ signataire: "Jean Delacroix" })
      .expect(200);

    // LA garde du défaut : sans elle, l'acceptation était silencieuse.
    const lignes = await annonces();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.label).toContain("Jean Delacroix");
    expect(lignes[0]!.label).toContain(reference);
    // Le montant y figure : c'est ce qui fait décider de rappeler ou non.
    expect(lignes[0]!.label).toContain("240.00 €");
  });

  test("une seconde acceptation ne rejoue pas l'annonce", async () => {
    await viderAnnonces();
    const { token } = await devisEnvoye();

    await publicPost(`/api/public/devis/${token}/accept`)
      .send({ signataire: "Jean Delacroix" })
      .expect(200);
    // Refusée : le devis porte déjà un horodatage d'acceptation.
    await publicPost(`/api/public/devis/${token}/accept`)
      .send({ signataire: "Quelqu'un d'autre" })
      .expect(409);

    // Deux annonces feraient croire à deux signatures, et l'artisan
    // rappellerait un client déjà rappelé.
    expect(await annonces()).toHaveLength(1);
  });

  test("deux acceptations simultanées ne produisent qu'UNE annonce", async () => {
    await viderAnnonces();
    const { token } = await devisEnvoye();

    // Le cas que le test précédent NE couvre PAS, et je l'ai découvert en
    // éprouvant la garde : sur une seconde tentative séquentielle, la route
    // rend 409 AVANT d'entrer dans la transaction — le garde `lignes[0]` n'y
    // est jamais sollicité.
    //
    // En concurrence, les deux requêtes passent le pré-contrôle et entrent
    // toutes deux dans la transaction ; seule celle dont l'UPDATE trouve
    // encore `acceptedAt IS NULL` met une ligne à jour. La perdante ne doit
    // rien annoncer — sinon l'artisan lit deux signatures pour un seul
    // engagement.
    const [un, deux] = await Promise.all([
      publicPost(`/api/public/devis/${token}/accept`).send({ signataire: "A" }),
      publicPost(`/api/public/devis/${token}/accept`).send({ signataire: "B" }),
    ]);
    expect([un.status, deux.status].sort()).toEqual([200, 409]);

    const lignes = await annonces();
    expect(lignes).toHaveLength(1);
    // Et c'est le gagnant qui est annoncé, pas l'autre.
    const gagnant = un.status === 200 ? "A" : "B";
    expect(lignes[0]!.label).toContain(gagnant);
  });

  test("l'acceptation réussit même si l'annonce ne peut pas partir", async () => {
    await viderAnnonces();
    const { token } = await devisEnvoye();

    // En environnement de test, `getTransporter()` rend `null` par
    // construction — aucun test n'atteint un serveur de messagerie réel.
    // L'e-mail d'annonce ne part donc PAS, et c'est exactement le cas à
    // éprouver : la signature du client ne doit pas en dépendre.
    const { body } = await publicPost(`/api/public/devis/${token}/accept`)
      .send({ signataire: "Jean Delacroix" })
      .expect(200);

    expect(body.accepted).toBe(true);
    expect(body.acceptedBy).toBe("Jean Delacroix");
    // La trace en base, elle, est écrite dans la transaction : elle ne dépend
    // pas du réseau.
    expect(await annonces()).toHaveLength(1);
  });
});
