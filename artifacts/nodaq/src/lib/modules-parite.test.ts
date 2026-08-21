/**
 * Garde de parité — un module ne déclare pas une page qui n'existe pas.
 *
 * ── Ce qu'elle aurait évité ──────────────────────────────────────────────
 * `moduleCatalog.ts` décrivait dix pages. SIX n'étaient routées nulle part
 * (`/rh`, `/stocks`, `/immobilisations`, `/reglementaire`, `/avis`, `/rgpd`)
 * et une septième pointait à côté : le module `facturation_electronique`
 * déclarait `href: "/factures"` avec un défaut « aucun ». Brancher le
 * filtrage de navigation aurait donc fait disparaître l'écran FACTURES chez
 * tous les tenants, tout en ne masquant aucune page réelle.
 *
 * Le catalogue était irréprochable en lui-même — versionné, commenté, avec
 * ses défauts par secteur. Il ne décrivait simplement plus le produit. Rien
 * ne pouvait le signaler, parce que rien ne le lisait : un registre que
 * personne n'appelle ne casse jamais.
 *
 * D'où cette garde. Elle est le prix d'entrée à tout câblage futur de
 * `resolveModules` : tant qu'elle passe, le catalogue peut être branché sans
 * faire disparaître un écran par surprise.
 *
 * Elle lit les SOURCES — `App.tsx` pour les routes, `moduleCatalog.ts` pour
 * les modules — plutôt que d'importer l'application, comme
 * `app-routes.test.ts` et `accessibilite-parite.test.ts`.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '@nodaq/shared';

const SOURCE_APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

function cheminsRoutes(): string[] {
  const trouves = [...SOURCE_APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!);
  expect(trouves.length, 'aucune route lue dans App.tsx').toBeGreaterThan(20);
  return trouves;
}

describe('a — chaque page annoncée par un module existe vraiment', () => {
  test("aucun module ne déclare un href sans route", () => {
    const routes = cheminsRoutes();
    const fantomes = MODULES.filter((m) => m.href !== undefined && !routes.includes(m.href)).map(
      (m) => `${m.id} → ${m.href}`,
    );
    expect(
      fantomes,
      "ces modules annoncent une page qui n'est routée nulle part — corriger le href, ou retirer le module s'il n'a jamais eu de surface",
    ).toEqual([]);
  });

  test('aucun module ne revendique la page d’un autre', () => {
    // Deux modules sur le même href, c'est un écran dont l'affichage
    // dépendrait de deux interrupteurs — et le plus restrictif gagnerait sans
    // que personne ne sache lequel.
    const avecPage = MODULES.filter((m) => m.href !== undefined).map((m) => m.href!);
    expect(new Set(avecPage).size, `href partagé entre modules : ${avecPage.join(', ')}`).toBe(
      avecPage.length,
    );
  });
});

describe('b — le catalogue reste utilisable', () => {
  test('il reste des modules, et ils ont tous un identifiant unique', () => {
    // Un catalogue vidé passerait les tests ci-dessus sans rien garantir.
    expect(MODULES.length).toBeGreaterThan(0);
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("un module hors socle ne cache pas un écran du socle", () => {
    // Le piège exact qui dormait ici : `facturation_electronique`, éteint par
    // défaut, pointait sur `/factures`. Éteindre un module optionnel ne doit
    // jamais emporter une page que tout le monde utilise.
    const SOCLE = ['/', '/factures', '/devis', '/affaires', '/pointages'];
    const horsSocle = MODULES.filter((m) => m.defaultOn === 'aucun' && m.href !== undefined);

    // Aucun module n'est éteint par défaut aujourd'hui — `facturation_electronique`
    // est repassé au socle, l'obligation de RECEVOIR une facture électronique
    // valant pour toutes les entreprises depuis le 01/09/2026. La boucle
    // ci-dessous ne s'exécuterait donc pas, et un test qui ne vérifie rien en
    // silence ne protège personne : on le CONSTATE.
    if (horsSocle.length === 0) {
      expect(MODULES.some((m) => m.defaultOn === 'aucun' && m.href !== undefined)).toBe(false);
      return;
    }

    for (const m of horsSocle) {
      expect(
        SOCLE,
        `« ${m.id} » est éteint par défaut et masquerait « ${m.href} », un écran du socle`,
      ).not.toContain(m.href);
    }
  });
});
