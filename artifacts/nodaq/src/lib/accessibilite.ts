/**
 * Registre d'accessibilité — US-A8.2.
 *
 * ── Pourquoi un registre, et pas un audit ───────────────────────────────
 * La story ne demande pas une campagne d'accessibilité. Son point d'attention
 * demande d'intégrer l'audit « comme critère de définition de "terminé" pour
 * tout nouveau module sectoriel, **plutôt que** comme un chantier séparé mené
 * après coup ». Et son contexte dit pourquoi : « un audit mené sur les seuls
 * écrans bâtiment ne garantit rien sur les futurs écrans sectoriels ».
 *
 * Un audit ponctuel est périmé à l'écran suivant. Ce fichier est donc la LISTE
 * DES ÉCRANS, et `accessibilite-parite.test.ts` échoue si un écran de
 * `App.tsx` n'y figure pas. Livrer un écran sectoriel sans l'inscrire fait
 * rougir la CI : l'audit cesse d'être quelque chose qu'on pense à faire pour
 * devenir quelque chose qu'on ne peut pas éviter. C'est la seule forme sous
 * laquelle l'AC2 est tenable.
 *
 * ── Le socle ────────────────────────────────────────────────────────────
 * `SOCLE_CONNU` inscrit NOMMÉMENT les violations qui existaient au moment de
 * poser la garde. Il n'est pas une permission : l'audit compare à l'IDENTIQUE,
 * donc une ligne devenue fausse fait échouer autant qu'une violation nouvelle.
 * Un socle qu'on n'élague jamais redeviendrait la liste d'exceptions que
 * personne ne relit — c'est précisément ce que ce dépôt reproche aux tests qui
 * se sautent en silence.
 *
 * Le socle ne peut donc que DIMINUER. Toute ligne retirée est un défaut réparé.
 */
import type { ComponentType } from 'react';

/**
 * Les règles opposables : WCAG 2.1 niveaux A et AA, ce que cite la story et ce
 * que le RGAA rend obligatoire. Pas les règles « bonnes pratiques » d'axe :
 * elles ne sont pas l'obligation légale, et le bruit qu'elles produisent finit
 * par faire discuter la garde au lieu de la respecter.
 */
export const REGLES_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export interface EcranAudite {
  /** Le chemin, tel qu'il est déclaré dans `App.tsx`. */
  readonly chemin: string;
  /**
   * Import DYNAMIQUE du composant de page. Dynamique délibérément : ce
   * registre est lu par la garde de parité, qui n'a aucune raison de charger
   * quarante écrans pour comparer des chaînes.
   */
  readonly charger?: () => Promise<{ default: ComponentType }>;
  /**
   * Renseigné = l'écran n'est PAS audité automatiquement, et voici pourquoi.
   * Une exemption est un trou dans la garde ; elle doit se lire comme tel et
   * porter une raison, pas un mot. Vérifié par la garde de parité.
   */
  readonly exempt?: string;
}

export const ECRANS_AUDITES: readonly EcranAudite[] = [
  // ── Écrans publics ────────────────────────────────────────────────────
  // Ceux-là comptent doublement : ils sont vus par les clients de l'artisan,
  // qui n'ont pas choisi ce logiciel et ne peuvent pas le contourner.
  { chemin: '/login', charger: () => import('@/pages/login') },
  { chemin: '/register', charger: () => import('@/pages/register') },
  { chemin: '/mfa', charger: () => import('@/pages/mfa') },
  {
    chemin: '/devis/accepter/:token',
    exempt:
      "L'écran se construit entièrement à partir du devis désigné par le jeton d'URL ; sans route montée il rend un état d'erreur, et auditer cet état ne dirait rien de l'écran réel.",
  },
  {
    chemin: '/membres/accepter/:token',
    exempt:
      "Même raison que l'acceptation de devis : tout le contenu dépend du jeton, et l'écran rendu hors contexte n'est pas celui que l'utilisateur voit.",
  },

  // ── Application interne ───────────────────────────────────────────────
  { chemin: '/', charger: () => import('@/pages/cockpit') },
  { chemin: '/affaires', charger: () => import('@/pages/affaires') },
  {
    chemin: '/affaires/:id',
    exempt:
      "Le détail d'une affaire dépend de l'identifiant d'URL ; rendu sans route monté, il n'affiche aucun des contrôles qui feraient l'objet de l'audit.",
  },
  { chemin: '/contrats', charger: () => import('@/pages/contrats') },
  { chemin: '/factures', charger: () => import('@/pages/factures') },
  { chemin: '/avoirs', charger: () => import('@/pages/avoirs') },
  { chemin: '/prospects', charger: () => import('@/pages/prospects') },
  { chemin: '/prospection', charger: () => import('@/pages/prospection') },
  { chemin: '/brief', charger: () => import('@/pages/brief') },
  { chemin: '/chat', charger: () => import('@/pages/chat') },
  { chemin: '/aide', charger: () => import('@/pages/aide') },
  { chemin: '/devis', charger: () => import('@/pages/devis') },
  { chemin: '/classeur', charger: () => import('@/pages/classeur') },
  { chemin: '/analytique', charger: () => import('@/pages/analytique') },
  { chemin: '/marge', charger: () => import('@/pages/marge') },
  { chemin: '/pointages', charger: () => import('@/pages/pointages') },
  { chemin: '/parametres/envoi', charger: () => import('@/pages/parametres-envoi') },
  { chemin: '/rapports', charger: () => import('@/pages/rapports') },
  { chemin: '/compte-resultat', charger: () => import('@/pages/compte-resultat') },
  { chemin: '/cabinet', charger: () => import('@/pages/cabinet') },
  { chemin: '/echeancier', charger: () => import('@/pages/echeancier') },
  { chemin: '/charges-recurrentes', charger: () => import('@/pages/charges-recurrentes') },
  {
    chemin: '/previsionnel-tresorerie',
    charger: () => import('@/pages/previsionnel-tresorerie'),
  },
  { chemin: '/equipe', charger: () => import('@/pages/equipe') },
  { chemin: '/votre-metier', charger: () => import('@/pages/votre-metier') },
  { chemin: '/connecteurs', charger: () => import('@/pages/connecteurs') },
  { chemin: '/parametres', charger: () => import('@/pages/parametres') },
  { chemin: '/onboarding', charger: () => import('@/pages/onboarding') },
  { chemin: '/reprise', charger: () => import('@/pages/reprise') },
  {
    chemin: '/facturation-electronique',
    charger: () => import('@/pages/facturation-electronique'),
  },
  { chemin: '/journal-decisions', charger: () => import('@/pages/journal-decisions') },
];

/**
 * Violations constatées à la pose de la garde, par chemin puis par règle axe.
 *
 * Ce n'est pas une liste d'exceptions permanentes : c'est une DETTE, datée,
 * et l'audit vérifie qu'elle correspond exactement à la réalité. Réparer un
 * écran impose de retirer sa ligne ici — sinon la garde échoue pour socle
 * périmé, ce qui est voulu.
 */
export const SOCLE_CONNU: Readonly<Record<string, readonly string[]>> = {
  /**
   * `/echeancier` utilise `Tabs` / `TabsList` / `TabsTrigger` **sans aucun
   * `TabsContent`** : les onglets servent de filtre, et la liste filtrée est
   * rendue plus bas dans la page, hors du `Tabs`.
   *
   * Conséquence : chaque déclencheur annonce `aria-controls` vers un panneau
   * qui n'existe pas. Un lecteur d'écran dit « onglet, contrôle le panneau X »
   * et il n'y a pas de panneau X. Le défaut est le NÔTRE, pas celui de la
   * bibliothèque — nous avons emprunté la sémantique d'onglets pour un
   * contrôle qui n'en est pas un.
   *
   * Pas corrigé ici parce que le correctif juste n'est pas un attribut à
   * ajouter : c'est remplacer les onglets par un groupe de boutons de filtre
   * (`ToggleGroup` ou un groupe de cases radio), donc un changement de
   * composant et d'apparence qui dépasse le périmètre de cette story. Inscrit
   * pour que la dette soit lisible plutôt que découverte par un utilisateur.
   */
  '/echeancier': ['aria-valid-attr-value'],
};
