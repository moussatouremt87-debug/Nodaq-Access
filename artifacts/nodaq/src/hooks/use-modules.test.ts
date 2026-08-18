/**
 * Le filtrage de navigation par module.
 *
 * L'état vient du serveur ; ce qui se vérifie ICI, c'est la traduction de cet
 * état en chemins masqués, et le fait que la coquille s'en serve réellement.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cheminsDeModulesEteints, type ModuleResolu } from './use-modules';

function m(over: Partial<ModuleResolu>): ModuleResolu {
  return {
    id: 'x',
    title: 'X',
    description: '',
    tools: [],
    active: true,
    source: 'defaut_vertical',
    ...over,
  };
}

describe('a — un module éteint retire sa page', () => {
  test('seuls les modules éteints ET dotés d’une page sont masqués', () => {
    const masques = cheminsDeModulesEteints([
      m({ id: 'a', href: '/a', active: false }),
      m({ id: 'b', href: '/b', active: true }),
      // Sans page : rien à masquer, et surtout pas `undefined` dans
      // l'ensemble, qui masquerait toute entrée sans href.
      m({ id: 'c', active: false }),
    ]);
    expect([...masques]).toEqual(['/a']);
  });

  test('avant chargement, rien n’est masqué', () => {
    // Le défaut doit être PERMISSIF : masquer pendant le chargement ferait
    // clignoter le menu à chaque navigation, et pire, ferait disparaître des
    // entrées si la requête échouait.
    expect(cheminsDeModulesEteints(undefined).size).toBe(0);
    expect(cheminsDeModulesEteints([]).size).toBe(0);
  });
});

describe('b — la coquille utilise réellement ce filtre', () => {
  test('`peutVoir` consulte les modules éteints', () => {
    // Sans cette garde, retirer la clause laisserait tous les tests
    // ci-dessus au vert : ils vérifient une fonction que plus personne
    // n'appellerait.
    const src = readFileSync(join(__dirname, '..', 'components', 'app-shell.tsx'), 'utf8');
    const clause = src.slice(src.indexOf('const peutVoir'), src.indexOf('return ('));
    expect(
      clause,
      'la clause de visibilité ne consulte plus les modules éteints',
    ).toContain('masquesParModule');
    expect(src).toContain('cheminsDeModulesEteints');
  });
});
