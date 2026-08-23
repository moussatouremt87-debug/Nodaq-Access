/*
 * Le QR de virement SEPA — reste du ticket 4.21.
 *
 * ── Pourquoi ces tests sont détaillés ─────────────────────────────────────
 * Un QR mal formé n'échoue pas bruyamment. Il s'ouvre dans l'application
 * bancaire du client avec un champ de travers — un montant, un IBAN — et c'est
 * LUI qui le découvre, s'il le découvre. Il n'y a pas de « 500 » pour un QR :
 * la seule protection possible est ici.
 *
 * ── Ce qui n'est PAS retesté ici ──────────────────────────────────────────
 * La clé de contrôle de l'IBAN. Elle a son module (`iban.ts`) et son fichier
 * (`iban.test.ts`) depuis le ticket 4.19 ; ce module s'appuie dessus au lieu
 * d'en écrire une seconde. On vérifie seulement qu'un IBAN refusé N'ATTEINT
 * PAS le QR — le branchement, pas l'algorithme.
 */
import { describe, test, expect } from "vitest";
import { chargeUtileEpc, motifRefusQr } from "../src/qrVirement.js";

/** IBAN d'exemple de la documentation publique française, clé juste. */
const IBAN_OK = "FR7630006000011234567890189";

const VIREMENT = {
  beneficiaire: "SARL Dupont Bâtiment",
  iban: IBAN_OK,
  montantCents: 145_050, // 1 450,50 €
  reference: "FACT-2026-0042",
};

describe("la charge utile EPC069-12", () => {
  test("elle porte les douze lignes de la norme, dans l'ordre", () => {
    const charge = chargeUtileEpc(VIREMENT)!;
    const lignes = charge.split("\n");
    expect(lignes).toHaveLength(12);
    expect(lignes[0]).toBe("BCD");
    expect(lignes[1]).toBe("002");
    expect(lignes[2]).toBe("1");
    expect(lignes[3]).toBe("SCT");
    expect(lignes[4]).toBe("");                       // BIC absent, autorisé en 002
    expect(lignes[5]).toBe("SARL Dupont Bâtiment");
    expect(lignes[6]).toBe(IBAN_OK);
    expect(lignes[7]).toBe("EUR1450.50");
    expect(lignes[8]).toBe("");
    expect(lignes[9]).toBe("");                       // référence structurée vide…
    expect(lignes[10]).toBe("FACT-2026-0042");        // …car la libre est remplie
    expect(lignes[11]).toBe("");
  });

  test("le montant est rendu au centime, sans arrondi ni virgule", () => {
    // Le piège : `(centimes / 100).toFixed(2)` passe par un flottant. Sur des
    // montants de facture, il finit par rendre 1450.49 ou 1450.51 — et le QR
    // dirait autre chose que la ligne « Total TTC » juste au-dessus.
    const m = (c: number) => chargeUtileEpc({ ...VIREMENT, montantCents: c })!.split("\n")[7];
    expect(m(1)).toBe("EUR0.01");
    expect(m(100)).toBe("EUR1.00");
    expect(m(105)).toBe("EUR1.05");
    expect(m(145_050)).toBe("EUR1450.50");
    expect(m(123_456_789)).toBe("EUR1234567.89");
    expect(m(99_999_999_999)).toBe("EUR999999999.99");
  });

  test("le BIC est repris quand il est donné", () => {
    const charge = chargeUtileEpc({ ...VIREMENT, bic: " agrifrpp " })!;
    expect(charge.split("\n")[4]).toBe("AGRIFRPP");
  });

  test("l'IBAN saisi avec des espaces est encodé sans", () => {
    const charge = chargeUtileEpc({ ...VIREMENT, iban: "FR76 3000 6000 0112 3456 7890 189" })!;
    expect(charge.split("\n")[6]).toBe(IBAN_OK);
  });

  test("un bénéficiaire trop long est coupé à 70 caractères", () => {
    const charge = chargeUtileEpc({ ...VIREMENT, beneficiaire: "É".repeat(120) })!;
    expect(charge.split("\n")[5]).toHaveLength(70);
  });
});

describe("le repli est le silence, jamais un QR approximatif", () => {
  const refuse = (patch: Partial<typeof VIREMENT>) =>
    chargeUtileEpc({ ...VIREMENT, ...patch });

  test("un IBAN refusé par `verifierIban` n'atteint pas le QR", () => {
    // Le branchement, pas l'algorithme : c'est `iban.test.ts` qui prouve que
    // ces trois-là sont bien refusés.
    expect(refuse({ iban: "" })).toBeNull();
    expect(refuse({ iban: "FR7630006000011234567890188" })).toBeNull();  // clé fausse
    expect(refuse({ iban: "FR76300060000112345678901" })).toBeNull();    // longueur
  });

  test("un montant nul ou négatif ne produit aucun QR", () => {
    // Un avoir, une facture à zéro : il n'y a rien à virer. Imprimer un QR à
    // 0 € inviterait à faire un virement qui n'a pas lieu d'être.
    expect(refuse({ montantCents: 0 })).toBeNull();
    expect(refuse({ montantCents: -5_000 })).toBeNull();
  });

  test("un montant non entier ne produit aucun QR", () => {
    // Des centimes fractionnaires signalent un calcul en amont qui a dérapé.
    // Le QR n'est pas l'endroit où rattraper ça.
    expect(refuse({ montantCents: 1450.5 })).toBeNull();
    expect(refuse({ montantCents: Number.NaN })).toBeNull();
  });

  test("un montant hors des bornes SEPA ne produit aucun QR", () => {
    expect(refuse({ montantCents: 100_000_000_000 })).toBeNull();
  });

  test("un bénéficiaire vide ne produit aucun QR", () => {
    expect(refuse({ beneficiaire: "   " })).toBeNull();
  });

  test("une charge utile au-delà de 331 octets ne produit aucun QR", () => {
    // La référence est déjà coupée à 140 caractères ; c'est en UTF-8
    // multi-octet que le plafond se franchit — et le dépassement passerait
    // inaperçu sur un test qui ne compterait que les caractères.
    expect(refuse({ reference: "€".repeat(140) })).toBeNull();
  });
});

describe("le motif de refus est dit, jamais tu", () => {
  test("chaque cause a son texte, en français et sans jargon", () => {
    // « Pas de QR sur vos factures » sans raison est un défaut qu'on ne
    // signale jamais — et que l'artisan ne peut pas corriger.
    expect(motifRefusQr({ ...VIREMENT, iban: "" })).toMatch(/vide/i);
    expect(motifRefusQr({ ...VIREMENT, iban: "FR7630006000011234567890188" }))
      .toMatch(/clé de contrôle/);
    expect(motifRefusQr({ ...VIREMENT, montantCents: 0 })).toMatch(/Aucun montant/);
    expect(motifRefusQr({ ...VIREMENT, beneficiaire: "" })).toMatch(/nom de votre entreprise/);
  });

  test("tout motif dit aussi la conséquence : pas de QR", () => {
    // Un message qui explique la cause sans dire l'effet laisse l'artisan
    // découvrir l'absence du QR par lui-même, sur une facture déjà partie.
    for (const patch of [
      { iban: "" }, { iban: "FR7630006000011234567890188" },
      { beneficiaire: "" }, { montantCents: 0 }, { montantCents: 100_000_000_000 },
    ]) {
      expect(motifRefusQr({ ...VIREMENT, ...patch })).toMatch(/QR/);
    }
  });

  test("un virement encodable n'a pas de motif", () => {
    expect(motifRefusQr(VIREMENT)).toBeNull();
  });
});
