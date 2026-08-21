/**
 * Un brouillon qui survit à la fermeture de l'écran — ticket 4.20, lot D.
 *
 * ── Le scénario qu'on refuse ──────────────────────────────────────────────
 * L'artisan dicte deux minutes d'ouvrages debout sur un chantier. Le réseau
 * tombe, un appel arrive, le navigateur récupère de la mémoire, ou il touche
 * « Affaires » par erreur dans la barre du bas. Au retour, la zone de texte
 * est vide, et il ne redictera pas : il rangera son téléphone.
 *
 * Le travail dicté est le SEUL contenu du produit que l'utilisateur ne peut
 * pas reconstituer — une facture se retrouve, une parole non enregistrée
 * n'existe plus.
 *
 * ── Pourquoi `localStorage` et pas le serveur ─────────────────────────────
 * Un brouillon n'est pas une donnée métier : rien ne doit s'écrire en base
 * avant que l'utilisateur ait validé, et une transcription partie au serveur
 * « pour ne pas la perdre » serait une écriture sans consentement. Le
 * navigateur suffit, et le brouillon meurt avec l'appareil.
 *
 * ── Ce qui est volontairement absent ──────────────────────────────────────
 * Aucune synchronisation entre appareils, aucune reprise après plusieurs
 * jours : la clé porte l'écran, pas l'utilisateur, et un brouillon vieux de
 * plus d'un jour est effacé à la lecture. Restaurer une dictée de la semaine
 * dernière dans un nouveau devis serait pire que de l'avoir perdue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Un jour. Au-delà, le brouillon n'a plus de rapport avec ce qu'on fait. */
const PEREMPTION_MS = 24 * 60 * 60 * 1000;

const cle = (nom: string) => `nodaq-brouillon:${nom}`;

interface Enregistre {
  valeur: string;
  ecritLe: number;
}

/** Lit un brouillon non périmé. Toute anomalie rend `null` — jamais d'erreur. */
export function lireBrouillon(nom: string): string | null {
  try {
    const brut = localStorage.getItem(cle(nom));
    if (!brut) return null;
    const { valeur, ecritLe } = JSON.parse(brut) as Enregistre;
    if (typeof valeur !== 'string' || typeof ecritLe !== 'number') return null;
    if (Date.now() - ecritLe > PEREMPTION_MS) {
      localStorage.removeItem(cle(nom));
      return null;
    }
    return valeur || null;
  } catch {
    // Stockage indisponible (navigation privée, quota, JSON corrompu) : on
    // continue sans brouillon. Perdre la reprise est acceptable ; empêcher
    // l'écran de s'afficher ne l'est pas.
    return null;
  }
}

/**
 * Un état de texte dont la valeur est sauvegardée au fil de la frappe.
 *
 * Rend le même triplet qu'un `useState`, plus `oublier()` — à appeler quand le
 * contenu a été TRANSFORMÉ en quelque chose de durable (un devis créé).
 * Garder le brouillon après coup ressusciterait un texte déjà exploité au
 * prochain passage sur l'écran.
 */
export function useBrouillon(
  nom: string,
  initial = '',
): [string, (v: string | ((prec: string) => string)) => void, () => void] {
  const [valeur, poser] = useState<string>(() => lireBrouillon(nom) ?? initial);
  const oublie = useRef(false);

  useEffect(() => {
    if (oublie.current) return;
    try {
      if (valeur) {
        localStorage.setItem(cle(nom), JSON.stringify({ valeur, ecritLe: Date.now() }));
      } else {
        localStorage.removeItem(cle(nom));
      }
    } catch {
      // Voir `lireBrouillon` : l'écriture qui échoue ne casse pas la saisie.
    }
  }, [nom, valeur]);

  const oublier = useCallback(() => {
    oublie.current = true;
    try {
      localStorage.removeItem(cle(nom));
    } catch {
      /* idem */
    }
  }, [nom]);

  return [valeur, poser, oublier];
}
