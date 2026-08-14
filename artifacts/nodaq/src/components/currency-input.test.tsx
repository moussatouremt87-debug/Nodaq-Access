/**
 * Régression UAT — le champ "P.U. HT" corrompt la saisie multi-chiffres.
 *
 * Avant ce correctif, `value` était recalculé et reformaté (`.toFixed(2)`)
 * à chaque frappe à partir de l'état en centimes : React réinitialise alors
 * la position du curseur à chaque re-rendu, sans la préserver. Taper "3200"
 * produisait "3,00" au lieu de "32,00". Reproduit ici avec `userEvent.type`,
 * qui simule une frappe caractère par caractère (pas une seule mise à jour
 * groupée), exactement comme la saisie humaine qui a révélé le défaut.
 */
import { useState } from "react";
import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrencyInput } from "./currency-input";

function Harness({ initialCents = 0 }: { initialCents?: number }) {
  const [cents, setCents] = useState(initialCents);
  return <CurrencyInput valueCents={cents} onChangeCents={setCents} />;
}

/** Le champ change de rôle ARIA selon `type` (number → spinbutton, text → textbox) ; on cible l'input directement, indépendamment de son type. */
function champUnique(container: HTMLElement): HTMLInputElement {
  return container.querySelector("input") as HTMLInputElement;
}

describe("CurrencyInput — la frappe caractère par caractère n'est jamais corrompue", () => {
  test('taper "3200" sur un champ neuf produit 3200,00 €, pas 3,00 €', async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(<Harness />);
    const champ = champUnique(container);

    await utilisateur.clear(champ);
    await utilisateur.type(champ, "3200");

    expect(champ.value).toBe("3200");
    await utilisateur.tab();
    expect(champ.value).toBe("3200.00");
  });

  test('taper "45" ne produit pas "4,01" (pas d\'incrément de spinner)', async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(<Harness />);
    const champ = champUnique(container);

    await utilisateur.clear(champ);
    await utilisateur.type(champ, "45");

    expect(champ.value).toBe("45");
    await utilisateur.tab();
    expect(champ.value).toBe("45.00");
  });

  test('sur une ligne neuve, taper "1500" ne produit pas "15 000,00" (pas de zéro fantôme)', async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(<Harness initialCents={0} />);
    const champ = champUnique(container);

    await utilisateur.clear(champ);
    await utilisateur.type(champ, "1500");

    expect(champ.value).toBe("1500");
    await utilisateur.tab();
    expect(champ.value).toBe("1500.00");
  });

  test("une frappe lente, avec des pauses, reste fidèle à ce qui a été tapé", async () => {
    const utilisateur = userEvent.setup({ delay: 20 });
    const { container } = render(<Harness />);
    const champ = champUnique(container);

    await utilisateur.clear(champ);
    await utilisateur.type(champ, "850");

    expect(champ.value).toBe("850");
  });

  test("perdre le focus reformate en deux décimales et arrondit au centime", async () => {
    const utilisateur = userEvent.setup();
    const { container } = render(<Harness />);
    const champ = champUnique(container);

    await utilisateur.clear(champ);
    await utilisateur.type(champ, "32.5");
    await utilisateur.tab();

    expect(champ.value).toBe("32.50");
  });

  test("une valeur externe (chargement d'un devis existant) s'affiche quand le champ n'a pas le focus", () => {
    const { container } = render(<Harness initialCents={4590} />);
    const champ = champUnique(container);
    expect(champ.value).toBe("45.90");
  });
});
