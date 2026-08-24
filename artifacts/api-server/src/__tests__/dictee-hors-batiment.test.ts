/*
 * La dictée hors du bâtiment — US-A2.2.
 *
 * ── Ce que ces tests prouvent, et ce qu'ils ne prouvent pas ───────────────
 * Ils ne prouvent PAS qu'un vrai modèle comprend « balayage californien ».
 * Le modèle est simulé (`vitest.setup.ts`), il l'est dans toute la suite, et
 * la CI ne dépend d'aucun secret — un test qui appellerait un fournisseur
 * réel se sauterait silencieusement le jour où la clé manque, ce qui est
 * précisément le défaut que le dépôt a déjà payé sept fois.
 *
 * Ils prouvent l'autre moitié de la chaîne, celle qui est à nous : à partir
 * d'un découpage identique, tout ce qui suit — rapprochement au catalogue du
 * tenant, marquage « à compléter », total qui n'additionne que le chiffrable —
 * se comporte pour un restaurant, un salon, une aide à domicile et un
 * kinésithérapeute exactement comme pour un maçon.
 *
 * Le troisième critère est celui qui compte ici : « un terme métier propre au
 * secteur est reconnu SANS nécessiter un vocabulaire BTP ». La reconnaissance
 * est déterministe — elle rapproche un libellé dicté du catalogue du tenant —
 * donc elle est vérifiable pour de bon.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `sect-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Secteur ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

/** Le secteur déclaré du tenant — ce qui choisit son vocabulaire. */
async function poserSecteur(tenantId: string, vertical: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, 'company.pack_metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, vertical],
  );
}

const catalogue = (cookie: string, libelle: string, unite: string, cents: number) =>
  request(serveurTest(app)).post("/api/catalogue").set("Cookie", cookie)
    .send({ libelle, unite, prixUnitaireHtCents: cents, tauxTva: 20 }).expect(201);

const dicter = (cookie: string, texte: string) =>
  request(serveurTest(app)).post("/api/devis/dictee/proposer")
    .set("Cookie", cookie).send({ texte });

interface Ligne { libelle: string; prixUnitaireHtCents: number | null; provenance: string; quantite: number | null }
const lignes = (body: unknown) => (body as { lignes: Ligne[] }).lignes;

afterAll(async () => {
  await adminPool.query(`DELETE FROM catalogue_lignes WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/**
 * Quatre métiers, quatre vocabulaires, une seule chaîne.
 *
 * Chaque cas dicte DEUX prestations : une au catalogue, une absente. C'est le
 * couple qui compte — il éprouve la reconnaissance ET le refus d'inventer,
 * dans la même réponse.
 */
const METIERS = [
  {
    nom: "restaurant", vertical: "restauration_chr",
    tarife: { libelle: "Menu du soir", unite: "couvert", cents: 3_200 },
    dictee: "Quarante couverts pour le menu du soir, plus la location de la salle",
    absent: "location",
  },
  {
    nom: "salon", vertical: "artisanat_service",
    tarife: { libelle: "Shampoing", unite: "prestation", cents: 800 },
    dictee: "Deux shampoing et un balayage californien",
    absent: "balayage",
  },
  {
    nom: "aide à domicile", vertical: "services_personne",
    tarife: { libelle: "Prestation de ménage", unite: "h", cents: 2_500 },
    dictee: "Six heures de ménage cette semaine et le nettoyage des vitres en hauteur",
    absent: "vitres",
  },
  {
    nom: "kinésithérapeute", vertical: "sante_liberale",
    tarife: { libelle: "Consultation", unite: "séance", cents: 5_000 },
    dictee: "Trois consultation ce mois-ci, et un bilan postural complet",
    absent: "bilan",
  },
] as const;

describe("un terme métier est reconnu sans vocabulaire BTP — critère 3", () => {
  test.each(METIERS)("$nom : « $tarife.libelle » est rapproché de son catalogue", async (m) => {
    const t = await inscrire(m.nom.replace(/\W/g, ""));
    await poserSecteur(t.tenantId, m.vertical);
    await catalogue(t.cookie, m.tarife.libelle, m.tarife.unite, m.tarife.cents);

    const { body } = await dicter(t.cookie, m.dictee).expect(200);
    const reconnue = lignes(body).find((l) => l.provenance === "catalogue");

    expect(reconnue, `aucune ligne rapprochée pour ${m.nom}`).toBeDefined();
    expect(reconnue!.prixUnitaireHtCents).toBe(m.tarife.cents);
  });
});

describe("ce qui n'est pas au catalogue n'est jamais chiffré — critère 2", () => {
  test.each(METIERS)("$nom : la prestation absente ressort « à compléter »", async (m) => {
    // Un prix inventé sur une prestation de santé ou de coiffure est aussi
    // grave que sur du gros œuvre — et plus difficile à repérer, parce que
    // personne n'a d'ordre de grandeur en tête pour un « bilan postural ».
    const t = await inscrire(`${m.nom.replace(/\W/g, "")}-abs`);
    await poserSecteur(t.tenantId, m.vertical);
    await catalogue(t.cookie, m.tarife.libelle, m.tarife.unite, m.tarife.cents);

    const { body } = await dicter(t.cookie, m.dictee).expect(200);
    const absente = lignes(body).find((l) => l.libelle.toLowerCase().includes(m.absent));

    expect(absente, `« ${m.absent} » absent de la réponse`).toBeDefined();
    expect(absente!.prixUnitaireHtCents).toBeNull();
    expect(absente!.provenance).toBe("a_completer");
  });

  test.each(METIERS)("$nom : catalogue VIDE → aucune ligne chiffrée", async (m) => {
    const t = await inscrire(`${m.nom.replace(/\W/g, "")}-vide`);
    await poserSecteur(t.tenantId, m.vertical);

    const { body } = await dicter(t.cookie, m.dictee).expect(200);
    expect(lignes(body).length).toBeGreaterThan(0);
    for (const l of lignes(body)) {
      expect(l.prixUnitaireHtCents).toBeNull();
      expect(l.provenance).toBe("a_completer");
    }
    expect((body as { totalHtCents: number }).totalHtCents).toBe(0);
  });
});

describe("les quantités et unités survivent au secteur — critère 1", () => {
  test("quarante couverts restent quarante, et le total s'ensuit", async () => {
    // Une quantité perdue en route se voit moins qu'un prix faux, et coûte
    // autant : 40 couverts facturés 1 couvert.
    const t = await inscrire("couverts");
    await poserSecteur(t.tenantId, "restauration_chr");
    await catalogue(t.cookie, "Menu du soir", "couvert", 3_200);

    const { body } = await dicter(t.cookie, METIERS[0].dictee).expect(200);
    const menu = lignes(body).find((l) => l.provenance === "catalogue")!;
    expect(menu.quantite).toBe(40);
    expect((body as { totalHtCents: number }).totalHtCents).toBe(40 * 3_200);
  });

  test("le total n'additionne QUE le chiffrable, hors bâtiment aussi", async () => {
    const t = await inscrire("total");
    await poserSecteur(t.tenantId, "sante_liberale");
    await catalogue(t.cookie, "Consultation", "séance", 5_000);

    const { body } = await dicter(t.cookie, METIERS[3].dictee).expect(200);
    const b = body as { totalHtCents: number; lignesChiffrees: number; lignesACompleter: number };
    expect(b.totalHtCents).toBe(3 * 5_000);
    expect(b.lignesChiffrees).toBe(1);
    expect(b.lignesACompleter).toBe(1);
  });
});
