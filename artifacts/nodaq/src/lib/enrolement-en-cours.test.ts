/**
 * L'enrôlement MFA qui survit à un rechargement — ticket 4.20.
 *
 * Le défaut, constaté sur un iPhone : configurer son authentificateur oblige à
 * quitter la page, et Safari la recharge au retour. Chaque affichage demandait
 * un nouveau secret, donc le code tout juste configuré était refusé — « Code
 * incorrect », sans rien qui explique pourquoi, et la même chose à chaque
 * tentative.
 */
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  lireEnrolement,
  memoriserEnrolement,
  oublierEnrolement,
} from './enrolement-en-cours';

const ENROLEMENT = {
  secret: 'Z4H76Y3DYVCPFIH6LIHGIPBFCXDL3B3P',
  qrDataUri: 'data:image/png;base64,AAAA',
  otpauthUri: 'otpauth://totp/NODAQ:a@b.fr?secret=Z4H76Y3DYVCPFIH6LIHGIPBFCXDL3B3P',
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('a — le secret survit à un rechargement', () => {
  test('mémorisé puis relu à l’identique', () => {
    memoriserEnrolement(ENROLEMENT);
    // C'est LE point : la clé relue doit être celle déjà configurée dans
    // l'authentificateur. Une autre, et tous les codes seront refusés.
    expect(lireEnrolement()).toEqual(ENROLEMENT);
  });

  test('sans enrôlement en cours, rien n’est rendu', () => {
    expect(lireEnrolement()).toBeNull();
  });
});

describe('b — un enrôlement abouti ne revient pas', () => {
  test('`oublier` efface : le secret est désormais persisté côté serveur', () => {
    memoriserEnrolement(ENROLEMENT);
    oublierEnrolement();
    expect(lireEnrolement()).toBeNull();
  });
});

describe('c — un enregistrement douteux est traité comme absent', () => {
  test('JSON illisible', () => {
    sessionStorage.setItem('nodaq-mfa-enrolement', 'pas du JSON');
    expect(lireEnrolement()).toBeNull();
  });

  test.each([
    ['secret manquant', { qrDataUri: 'data:x', otpauthUri: 'otpauth://x' }],
    ['secret vide', { secret: '', qrDataUri: 'data:x', otpauthUri: 'otpauth://x' }],
    ['QR manquant', { secret: 'ABC', otpauthUri: 'otpauth://x' }],
    ['URI manquante', { secret: 'ABC', qrDataUri: 'data:x' }],
  ])('%s → redemander un secret vaut mieux qu’un affichage incohérent', (_, partiel) => {
    sessionStorage.setItem('nodaq-mfa-enrolement', JSON.stringify(partiel));
    expect(lireEnrolement()).toBeNull();
  });
});

describe('d — un stockage indisponible ne bloque jamais l’enrôlement', () => {
  test('écriture refusée → aucune exception, comportement d’avant', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    // Dégradé (chaque affichage redemandera un secret), jamais bloquant :
    // l'utilisateur doit pouvoir s'enrôler, mémoire ou pas.
    expect(() => memoriserEnrolement(ENROLEMENT)).not.toThrow();
  });
});
