/**
 * Mode d'interface — US-A8.4.
 *
 * Une part importante des artisans et commerçants indépendants n'a pas grandi
 * avec le numérique. Le menu compte trente et une entrées ; celui qui veut
 * faire un devis et envoyer une facture n'en utilisera jamais la plupart.
 *
 * ── Un habillage, pas une seconde application ────────────────────────────
 * Le point d'attention de la story l'exige : « ce mode doit être un habillage
 * de l'interface existante, pas une version de l'application à maintenir
 * séparément ». Ce fichier ne connaît donc AUCUN écran. Il ne porte qu'un
 * état ; ce qui est essentiel est déclaré là où les entrées sont déjà
 * décrites, sur `NavItem.essentiel` (`lib/nav.ts`), à côté de `requiredRoles`
 * et `visibleForVertical`. Une liste de chemins ici serait le premier pas
 * vers les deux interfaces que la story refuse — et
 * `mode-interface.test.tsx` l'interdit explicitement.
 *
 * ── Pourquoi `localStorage` ──────────────────────────────────────────────
 * C'est une préférence de PERSONNE, pas d'entreprise. `settings` est clé
 * `(tenant_id, key)` : un réglage stocké là s'imposerait au comptable comme à
 * l'apprenti. Pire, l'écran Paramètres est réservé à l'OWNER — le salarié qui
 * a justement besoin du mode simplifié ne pourrait pas l'activer lui-même.
 *
 * Limite assumée, et c'est le prix du choix : le réglage est par appareil. Le
 * jour où le produit se dotera d'une vraie table de préférences par
 * utilisateur, c'est ici, et seulement ici, que la lecture changera.
 */
import { createContext, useContext, useState, useCallback } from 'react';

export type ModeInterface = 'simplifie' | 'complet';

const STORAGE_KEY = 'nodaq-mode-interface';

/**
 * Le mode enregistré, `complet` par défaut.
 *
 * Le défaut n'est pas neutre : personne ne doit se retrouver en interface
 * réduite sans l'avoir demandé. Une valeur illisible retombe donc sur
 * `complet`, jamais sur `simplifie`.
 */
export function lireMode(): ModeInterface {
  if (typeof window === 'undefined') return 'complet';
  return localStorage.getItem(STORAGE_KEY) === 'simplifie' ? 'simplifie' : 'complet';
}

interface ValeurContexte {
  readonly mode: ModeInterface;
  /** Bascule le mode ET le persiste. */
  basculerMode: () => void;
  /**
   * Vrai quand l'utilisateur a demandé à voir toutes les fonctions.
   *
   * NON PERSISTÉ, délibérément : l'AC2 parle d'une fonction avancée
   * « nécessaire PONCTUELLEMENT », accessible « sans être supprimée
   * définitivement ». Persister ce drapeau reviendrait à sortir du mode
   * simplifié sans le dire — au prochain lancement, l'utilisateur
   * retrouverait le menu complet en croyant être resté en mode réduit.
   */
  readonly afficherTout: boolean;
  toutAfficher: () => void;
  reduire: () => void;
}

const Contexte = createContext<ValeurContexte | null>(null);

export function ModeInterfaceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ModeInterface>(lireMode);
  const [afficherTout, setAfficherTout] = useState(false);

  const basculerMode = useCallback(() => {
    setMode((precedent) => {
      const suivant: ModeInterface = precedent === 'simplifie' ? 'complet' : 'simplifie';
      localStorage.setItem(STORAGE_KEY, suivant);
      // Repasser en mode simplifié repart d'un menu réduit : sinon on
      // basculerait vers un mode qui n'a l'air d'avoir rien changé.
      setAfficherTout(false);
      return suivant;
    });
  }, []);

  const toutAfficher = useCallback(() => setAfficherTout(true), []);
  const reduire = useCallback(() => setAfficherTout(false), []);

  return (
    <Contexte.Provider value={{ mode, basculerMode, afficherTout, toutAfficher, reduire }}>
      {children}
    </Contexte.Provider>
  );
}

/**
 * Hors fournisseur, on rend le comportement d'aujourd'hui — menu complet —
 * plutôt que de lever. Un écran monté isolément (un test, une capture) n'a
 * aucune raison de casser à cause d'un mode d'affichage.
 */
export function useModeInterface(): ValeurContexte {
  return (
    useContext(Contexte) ?? {
      mode: 'complet',
      basculerMode: () => {},
      afficherTout: false,
      toutAfficher: () => {},
      reduire: () => {},
    }
  );
}

/**
 * L'entrée doit-elle être affichée dans le mode courant ?
 *
 * Prend un `NavItem` allégé — c'est l'entrée qui porte l'information, la
 * fonction ne fait que la lire.
 */
export function visibleDansMode(
  item: { essentiel?: boolean },
  mode: ModeInterface,
  afficherTout: boolean,
): boolean {
  return mode === 'complet' || afficherTout || item.essentiel === true;
}
