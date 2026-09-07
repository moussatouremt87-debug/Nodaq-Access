/**
 * Ce que l'artisan lit quand une requête échoue.
 *
 * ── CE QUI EST ARRIVÉ ───────────────────────────────────────────────────────
 *
 * L'écran de dictée affichait « Transcription échouée — HTTP 403 ».
 *
 * Deux fautes dans une seule phrase. « HTTP 403 » est du jargon montré à un
 * artisan (règle 3 bis b). Et le serveur envoyait au même moment la phrase qui
 * disait quoi faire — « Votre abonnement n'est pas encore activé […] Activez-le
 * dans Réglages → Abonnement » — que l'écran jetait.
 *
 * Le pire des deux mondes : refuser sans expliquer, alors que l'explication
 * était déjà écrite et déjà transmise.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { messageErreur } from './message-erreur';

function reponse(status: number, corps?: unknown): Response {
  return new Response(corps === undefined ? null : JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('la phrase du serveur passe avant tout', () => {
  test("le message d'abonnement arrive intact jusqu'à l'écran", async () => {
    // Le cas réel du 01/09/2026 : abonnement pas encore activé, dictée refusée.
    const dit = "Votre abonnement n'est pas encore activé : votre espace est en "
      + 'lecture seule. Activez-le dans Réglages → Abonnement pour commencer.';
    expect(await messageErreur(reponse(403, { error: dit }))).toBe(dit);
  });

  test('un corps vide ne produit jamais un code brut', async () => {
    for (const code of [401, 403, 404, 413, 429, 500, 502, 503]) {
      const m = await messageErreur(reponse(code));
      expect(m, `${code} rend un code`).not.toMatch(/HTTP|\b40\d\b|\b50\d\b/);
      expect(m.length, `${code} rend une phrase vide`).toBeGreaterThan(10);
    }
  });

  test('une réponse illisible retombe sur une phrase, pas sur une erreur', async () => {
    // Une passerelle qui rend du HTML est un cas réel, pas une hypothèse.
    const html = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    const m = await messageErreur(html);
    expect(m).toMatch(/réessayez/i);
    expect(m).not.toContain('502');
  });

  test('aucun repli ne contient de jargon', async () => {
    for (const code of [401, 403, 500, 503]) {
      const m = (await messageErreur(reponse(code))).toLowerCase();
      for (const mot of ['http', 'error', 'status', 'gateway', 'timeout', 'forbidden']) {
        expect(m, `« ${mot} » dans le message de ${code}`).not.toContain(mot);
      }
    }
  });
});

describe('le code brut ne peut pas revenir', () => {
  test("aucun écran ne jette un « HTTP <code> » à la figure de l'artisan", () => {
    /*
     * Garde structurelle : c'est UNE ligne qui ramène le défaut, et rien
     * n'échoue quand elle revient — l'écran affiche simplement un nombre que
     * personne ne comprend, au moment précis où la personne est bloquée.
     */
    const racine = join(__dirname, '..');
    const fichiers: string[] = [];
    (function parcourir(d: string) {
      for (const nom of readFileSync ? require('node:fs').readdirSync(d) : []) {
        const chemin = join(d, nom);
        if (require('node:fs').statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.(ts|tsx)$/.test(nom) && !/\.test\./.test(nom)) fichiers.push(chemin);
      }
    })(racine);

    const fautifs = fichiers.filter((f) =>
      /new Error\(`HTTP \$\{[^}]*status\}`\)/.test(readFileSync(f, 'utf8')),
    );
    expect(
      fautifs.map((f) => f.replace(racine, '')),
      'ces écrans montrent un code HTTP au lieu du message du serveur',
    ).toEqual([]);
  });
});
