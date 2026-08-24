/*
 * Aucune page ne déborde horizontalement sous 390 px.
 *
 * ── Pourquoi cette garde existe ───────────────────────────────────────────
 * Le produit s'adresse à des artisans, et la décision a été prise le
 * 24/08/2026 : ils doivent pouvoir TOUT faire depuis leur téléphone, y compris
 * le compte de résultat et l'export comptable, parce que beaucoup n'ont pas
 * d'ordinateur.
 *
 * Or une page se développe sur un écran large. Le débordement horizontal ne se
 * voit jamais en écrivant le code — il se découvre sur le terrain, quand la
 * dernière colonne d'un tableau est hors d'atteinte et que le bouton
 * « Émettre » est derrière.
 *
 * ── Ce qu'elle mesure, et ce qu'elle NE mesure PAS ────────────────────────
 * Elle lit le source, pas un rendu : jsdom n'a pas de moteur de mise en page,
 * donc aucune largeur réelle n'est calculable ici. Elle attrape les motifs qui
 * produisent un débordement HORIZONTAL — le seul défaut dont l'utilisateur ne
 * peut pas se sortir.
 *
 * Elle ne dit RIEN de la taille des cibles tactiles, de la lisibilité, ni des
 * formulaires trop longs. Une page qui passe cette garde n'est pas certifiée
 * bonne sur mobile ; elle est seulement exempte de ces trois défauts-là.
 *
 * ── Les faux positifs sont nommés, pas contournés ─────────────────────────
 * Trois motifs ressemblent à des défauts et n'en sont pas :
 *   — `min-w-[640px]` DANS un conteneur `overflow-x-auto` : c'est le remède,
 *     pas la maladie. Un tableau dense doit défiler, pas se comprimer ;
 *   — `whitespace-nowrap` sur une cellule de date : une date coupée en deux
 *     est illisible, et le tableau qui la contient défile déjà ;
 *   — `flex items-start gap-4` avec une icône `shrink-0` et un contenu
 *     `flex-1 min-w-0` : c'est le motif mobile CORRECT.
 * La garde les connaît. Une garde qui hurle à tort apprend à être ignorée.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGES = dirname(fileURLToPath(import.meta.url));

/** iPhone SE/14 — le plus étroit encore massivement utilisé. */
const LARGEUR_CIBLE = 390;
/** La largeur utile, marges de page déduites. */
const LARGEUR_UTILE = LARGEUR_CIBLE - 40;

interface Defaut { page: string; ligne: number; motif: string; extrait: string }

function pages(): string[] {
  return readdirSync(PAGES).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
}

function analyser(fichier: string): Defaut[] {
  const lignes = readFileSync(join(PAGES, fichier), "utf8").split("\n");
  const out: Defaut[] = [];
  const ajoute = (i: number, motif: string) =>
    out.push({ page: fichier, ligne: i + 1, motif, extrait: lignes[i]!.trim().slice(0, 90) });

  lignes.forEach((l, i) => {
    // ── 1. Une grille à colonnes fixes ────────────────────────────────────
    // `grid-cols-3` sans repli : 117 px par colonne à 390 px. Un champ de
    // date ou un montant en euros n'y tient pas.
    // Exempté : la ligne porte `min-w-`, donc elle défile délibérément.
    if (/\bgrid-cols-([2-9]|1[0-2])\b/.test(l)
      && !/\b(sm|md|lg|xl):grid-cols-/.test(l)
      && !/\bmin-w-/.test(l)
      // Deux colonnes de contenu COURT (codes, paires clé/valeur en `text-xs`)
      // tiennent sans peine. Le seuil est à trois.
      && !(/\bgrid-cols-2\b/.test(l) && /\btext-xs\b|\bfont-mono-nums\b/.test(l))) {
      ajoute(i, "grille à colonnes fixes, sans repli mobile");
    }

    // ── 2. Une largeur en dur plus large que l'écran ──────────────────────
    // Exemptée si un conteneur défilant la précède de près : c'est alors le
    // remède appliqué sciemment.
    const largeurs = [...l.matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)];
    if (largeurs.some((m) => Number(m[1]) > LARGEUR_UTILE)) {
      // Quinze lignes en arrière. Le nombre est arbitraire et l'assumer vaut
      // mieux que de le cacher : il doit couvrir un conteneur défilant qui
      // enveloppe PLUSIEURS éléments — l'en-tête et le corps d'un planning
      // hebdomadaire, par exemple, séparés par la boucle qui rend les jours.
      // Trop court, la garde crie sur un remède correctement appliqué ; trop
      // long, elle avale un vrai défaut situé plus bas dans la page.
      const contexte = lignes.slice(Math.max(0, i - 15), i + 1).join("\n");
      if (!/overflow-x-auto/.test(contexte)) {
        ajoute(i, `largeur en pixels supérieure à ${LARGEUR_UTILE} px, hors conteneur défilant`);
      }
    }

    // ── 3. Une rangée de PLUSIEURS éléments longs, sans repli ─────────────
    // `gap-6` marque une rangée de blocs autonomes — statistiques, contrôles.
    // Le motif « icône + contenu » (`items-start gap-4`) n'est PAS visé : il
    // est correct sur mobile, et l'attraper aurait noyé la garde.
    if (/\bflex\b/.test(l) && /\bgap-[6-9]\b/.test(l)
      && !/flex-wrap|flex-col|(sm|md|lg):flex-row/.test(l)) {
      ajoute(i, "rangée de plusieurs éléments longs, sans repli");
    }
  });
  return out;
}

describe("aucune page ne déborde horizontalement sous 390 px", () => {
  test("la garde LIT vraiment les pages", () => {
    // Sans ce test, une expression régulière cassée ferait passer le suivant
    // sur une liste VIDE — vert, et ne protégeant plus rien. Le dépôt a déjà
    // payé ce défaut : sept tests de sécurité muets pendant des semaines.
    const liste = pages();
    expect(liste.length).toBeGreaterThanOrEqual(30);
    expect(liste).toContain("factures.tsx");
  });

  test("aucun motif de débordement", () => {
    const defauts = pages().flatMap(analyser);
    expect(
      defauts.map((d) => `${d.page}:${d.ligne} — ${d.motif}\n      ${d.extrait}`),
      "Un artisan doit pouvoir TOUT faire depuis son téléphone (décision du " +
      "24/08/2026), y compris le compte de résultat. Un débordement horizontal " +
      "met la dernière colonne — et le bouton d'action — hors d'atteinte.\n\n" +
      "Remèdes : `grid-cols-1 sm:grid-cols-N` pour une grille ; un conteneur " +
      "`overflow-x-auto` + `min-w-[…]` pour un tableau dense, qui doit défiler " +
      "plutôt que se comprimer ; `flex-wrap` avec `gap-x`/`gap-y` séparés pour " +
      "une rangée.",
    ).toEqual([]);
  });

  test("toute liste en tableau a sa présentation en CARTES", () => {
    // Lot 2 — un tableau qui défile est utilisable, pas agréable : atteindre
    // la dernière colonne fait perdre de vue la première, et le bouton
    // d'action se trouve au bout du glissement.
    //
    // Sont EXEMPTÉS les tableaux d'ÉDITION, qui portent des champs de saisie :
    // empiler quatre champs par ligne est une autre décision, à prendre
    // séparément. On les reconnaît à la présence d'un composant de saisie
    // dans le corps du tableau.
    const manquantes = pages().filter((f) => {
      const t = readFileSync(join(PAGES, f), "utf8");
      if (!/<table\b/.test(t)) return false;
      const editable = /<(Input|CurrencyInput|Select|Textarea|Checkbox)\b/.test(t)
        && /<td[^>]*>\s*(\n\s*)?<(Input|CurrencyInput|Select)/.test(t);
      if (editable) return false;
      return !/md:hidden/.test(t);
    });
    expect(
      manquantes,
      "Cette page affiche une liste en tableau sans version mobile. Ajoutez un " +
      "bloc `md:hidden` en cartes et masquez le tableau en `hidden md:block` — " +
      "en réutilisant LES MÊMES composants, sans quoi les deux présentations " +
      "divergeront.",
    ).toEqual([]);
  });

  test("les tableaux denses défilent au lieu de se comprimer", () => {
    // Un tableau de six colonnes comprimé sur 390 px est illisible ; le même
    // tableau qui défile reste utilisable. La différence tient au conteneur.
    const sansConteneur = pages().filter((f) => {
      const t = readFileSync(join(PAGES, f), "utf8");
      return /<table\b/.test(t) && !/overflow-x-auto/.test(t);
    });
    expect(sansConteneur, "tableau sans conteneur `overflow-x-auto`").toEqual([]);
  });
});
