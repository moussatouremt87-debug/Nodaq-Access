/**
 * Régression #42 — le premier affichage d'une tuile Cockpit n'est jamais
 * animé depuis zéro.
 *
 * Avant ce correctif, `AnimatedKpi` faisait toujours courir un ressort de 0
 * vers `target`, y compris au tout premier montage — alors que le composant
 * n'est monté qu'une fois les données réellement chargées (voir le Skeleton
 * dans cockpit.tsx). Le ressort a un seuil de convergence ABSOLU
 * (`restDelta`) : pour un grand nombre (un montant en centimes), l'atteindre
 * prend plusieurs secondes, pendant lesquelles la tuile affiche un nombre
 * intermédiaire plausible mais FAUX — exactement le symptôme de l'issue
 * (« CA du mois » différent à chaque rechargement, sans que les données
 * n'aient changé).
 */
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendingUp } from "lucide-react";
import { AnimatedKpi } from "./animated-kpi";

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

/** Normalise les espaces (dont l'espace fine insécable des séparateurs de milliers). */
const sansEspaces = (s: string) => s.replace(/\s/g, "");

describe("régression #42 — AnimatedKpi n'anime pas le premier affichage", () => {
  test("un grand montant s'affiche immédiatement, sans passer par une valeur intermédiaire", () => {
    // 374 202 centimes — grand target représentatif du CA du mois de l'issue.
    render(
      <AnimatedKpi label="CA du mois" target={374202} format={euros} icon={TrendingUp} testId="kpi-test" />,
    );
    expect(sansEspaces(screen.getByTestId("kpi-test").textContent ?? "")).toContain(sansEspaces(euros(374202)));
  });

  test("un petit compteur s'affiche aussi immédiatement à sa vraie valeur", () => {
    render(
      <AnimatedKpi label="Affaires en cours" target={2} format={String} icon={TrendingUp} testId="kpi-count" />,
    );
    expect(screen.getByTestId("kpi-count")).toHaveTextContent("2");
  });

  test("une cible à zéro (donnée réellement nulle) s'affiche à 0, pas vide", () => {
    render(
      <AnimatedKpi label="Actions à valider" target={0} format={String} icon={TrendingUp} testId="kpi-zero" />,
    );
    expect(screen.getByTestId("kpi-zero")).toHaveTextContent("0");
  });
});
