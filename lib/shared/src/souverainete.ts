/**
 * Registre des sous-traitants et garanties de souveraineté — US-A7.4.
 *
 * ── Pourquoi un registre, et pas un PDF rédigé ───────────────────────────
 * L'artisan qui répond à un marché public avec clause de souveraineté doit
 * produire un document qui dit où vont ses données. Un document RÉDIGÉ est
 * périmé le jour où l'infrastructure bouge, et personne ne s'en aperçoit :
 * c'est exactement le « document marketing déconnecté de l'architecture
 * réelle » que la story refuse. Le document est donc GÉNÉRÉ à la demande, à
 * partir d'ici. Même nature que `REGULATORY_ITEMS` et `PROCESSING_TEMPLATES` :
 * la connaissance de conformité vit dans une table déclarative, pas dans une
 * prose que personne ne relit.
 *
 * ── Ce que le produit VÉRIFIE vs ce qu'il DÉCLARE ────────────────────────
 * Deux niveaux de preuve, jamais confondus :
 *
 *   - l'HÔTE d'un service est lisible à l'exécution (`variableEnv`). On peut
 *     donc le CONSTATER, et refuser d'émettre s'il a changé (`hoteAttendu`) ;
 *   - la LOCALISATION physique (pays, région) ne se prouve pas depuis
 *     l'intérieur de l'application. Elle est DÉCLARÉE, et le document le dit.
 *
 * Prétendre tout vérifier ferait de l'attestation le document marketing
 * qu'elle est censée remplacer. Chaque entrée porte donc `source` : d'où vient
 * l'affirmation, pour que le lecteur puisse la contester.
 *
 * ── Aucune certification revendiquée ─────────────────────────────────────
 * Ni HDS, ni SecNumCloud, ni « conforme RGPD ». Rien qui ne soit étayé par un
 * fait d'architecture de ce dépôt.
 */

/** Version du registre, imprimée sur l'attestation. Bouger le registre = bouger la date. */
export const SOUVERAINETE_VERSION = "2026-08-18";

export interface SousTraitant {
  /** Identifiant stable, utilisé par la vérification d'émission. */
  readonly id: string;
  /** Rôle tenu dans le traitement, en français, lisible par un donneur d'ordre. */
  readonly role: string;
  /**
   * Nom du prestataire. `null` = fixé par la configuration de l'exploitant et
   * non écrit en dur ici — inventer un nom serait pire que ne rien dire.
   */
  readonly nom: string | null;
  /** Pays et région DÉCLARÉS. Voir l'en-tête : jamais vérifiables d'ici. */
  readonly pays: string;
  readonly region: string | null;
  /** Catégories de données confiées à ce sous-traitant. */
  readonly donnees: string;
  /**
   * Variable d'environnement qui porte l'URL du service. Sa présence signifie
   * que l'hôte réellement joint est CONSTATABLE à l'émission.
   */
  readonly variableEnv?: string;
  /**
   * Hôte que ce registre déclare. Sa présence arme le refus d'émettre : si
   * l'hôte configuré diverge, l'attestation n'est pas produite.
   *
   * Absent alors que `variableEnv` est présent = l'hôte est un choix
   * d'exploitation légitime (un fournisseur d'envoi se change sans que la
   * souveraineté du traitement IA soit en cause) : il est alors CONSTATÉ et
   * imprimé tel quel, pas comparé.
   */
  readonly hoteAttendu?: string;
  /** D'où vient l'affirmation — pour que le lecteur puisse la vérifier. */
  readonly source: string;
}

export const SOUS_TRAITANTS: readonly SousTraitant[] = [
  {
    id: "hebergement",
    role: "Hébergement de l'application et de la base de données",
    nom: "Scaleway",
    pays: "France",
    region: "fr-par",
    donnees:
      "Ensemble des données du compte : devis, factures, avoirs, clients, chantiers, pièces comptables.",
    source: "Région de déploiement de production du dépôt (CLAUDE.md).",
  },
  {
    id: "modele-ia",
    role: "Traitement par modèle de langage (assistant, lecture de documents)",
    nom: "Scaleway Generative APIs",
    pays: "France",
    region: "fr-par",
    donnees:
      "Uniquement le contenu des échanges soumis à l'assistant et les documents que l'utilisateur lui transmet. Aucune donnée n'est envoyée hors de ces échanges.",
    variableEnv: "LLM_BASE_URL",
    hoteAttendu: "api.scaleway.ai",
    source:
      "Sortie modèle unique : toute destination vient de LLM_BASE_URL, résolue dans lib/llm. Hôte constaté à l'émission de la présente attestation.",
  },
  {
    id: "synthese-vocale",
    role: "Synthèse vocale de l'agent de relance téléphonique",
    nom: "ElevenLabs",
    // ÉTATS-UNIS, et il faut le lire tel quel : c'est le seul sous-traitant du
    // produit hors du périmètre souverain. L'arbitrage est documenté dans
    // docs/adr/002-tts-elevenlabs.md — aucune solution auto-hébergée ne tenait
    // à la fois le naturel et le temps réel en août 2026, et un agent à la voix
    // robotique fait raccrocher.
    pays: "États-Unis",
    region: null,
    donnees:
      "Le texte des répliques prononcées par l'agent. Contient des données personnelles des débiteurs : montants dus, dates de règlement, et selon les cas leur nom.",
    variableEnv: "VOICE_TTS_BASE_URL",
    // PAS de `hoteAttendu`, délibérément. La synthèse n'est pas configurée chez
    // tous les tenants ; armer la comparaison ferait REFUSER l'attestation
    // partout où elle est absente, alors que son absence n'est pas une
    // divergence — c'est un service non utilisé. L'hôte est donc constaté et
    // imprimé, comme pour l'envoi d'e-mails.
    source:
      "Décision d'août 2026 (ADR 002). Réversible : le protocole TextToSpeech ne connaît aucun fournisseur, et la migration vers un moteur souverain est un changement d'adaptateur.",
  },
  {
    id: "envoi-email",
    role: "Envoi des e-mails transactionnels (devis, factures, relances)",
    // Délibérément non nommé : ce dépôt n'écrit aucune URL de fournisseur en
    // dur, y compris ici. Le nom serait une affirmation que le code ne porte
    // pas. L'hôte réellement configuré est imprimé à sa place.
    nom: null,
    pays: "Déclaré par l'exploitant",
    region: null,
    donnees:
      "Adresse du destinataire, objet et corps du message, documents joints au message.",
    variableEnv: "TEM_BASE_URL",
    source:
      "Hôte lu dans la configuration au moment de l'émission. Ce service peut être changé par l'exploitant sans modification du logiciel.",
  },
];

/** L'hôte que le registre déclare pour un sous-traitant, s'il en déclare un. */
export function hoteAttendu(id: string): string | undefined {
  return SOUS_TRAITANTS.find((s) => s.id === id)?.hoteAttendu;
}

/**
 * Hôte d'une URL — nom d'hôte et port s'il est explicite, comme `URL.host` —,
 * ou `undefined` si la chaîne n'est pas une URL exploitable.
 *
 * Extraction manuelle, et non `new URL` : `lib/shared` est compilé sans les
 * types d'environnement (ni DOM, ni Node). Élargir sa configuration pour un
 * seul appel exposerait tout le paquet à des globales qui n'ont rien à faire
 * dans du code métier partagé.
 */
export function hoteDeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/?#:]+)(?::(\d+))?/i.exec(url.trim());
  if (!m) return undefined;
  const hote = m[1]!.toLowerCase();
  return m[2] ? `${hote}:${m[2]}` : hote;
}

export interface Divergence {
  readonly id: string;
  readonly role: string;
  readonly variableEnv: string;
  readonly attendu: string;
  /** Hôte réellement configuré, ou `null` si la variable est absente/illisible. */
  readonly observe: string | null;
}

/**
 * Compare les hôtes déclarés aux hôtes réellement configurés.
 *
 * C'est le cœur de l'AC3 : plutôt que de « mettre à jour automatiquement » un
 * document — ce qui reviendrait à imprimer sans broncher n'importe quelle
 * nouvelle destination —, on constate la divergence et on REFUSE d'émettre.
 * Un document qui ne peut pas être faux vaut mieux qu'un document qui se
 * corrige tout seul dans le dos de celui qui le signe.
 *
 * `urls` : l'URL configurée pour chaque variable d'environnement déclarée.
 * Aucune lecture de `process.env` ici — la comparaison reste pure, donc
 * testable sans manipuler l'environnement du processus.
 */
export function divergencesSouverainete(urls: Record<string, string | undefined>): Divergence[] {
  const trouvees: Divergence[] = [];
  for (const st of SOUS_TRAITANTS) {
    if (!st.hoteAttendu || !st.variableEnv) continue;
    const observe = hoteDeUrl(urls[st.variableEnv]) ?? null;
    if (observe !== st.hoteAttendu) {
      trouvees.push({
        id: st.id,
        role: st.role,
        variableEnv: st.variableEnv,
        attendu: st.hoteAttendu,
        observe,
      });
    }
  }
  return trouvees;
}

/** Message rendu à l'utilisateur quand l'attestation est refusée (409). */
export function messageRefusAttestation(divergences: readonly Divergence[]): string {
  const details = divergences
    .map(
      (d) =>
        `${d.role} : ce registre déclare « ${d.attendu} », la configuration actuelle pointe vers ${
          d.observe ? `« ${d.observe} »` : "aucune destination lisible"
        }`,
    )
    .join(" ; ");
  return (
    "L'attestation n'a pas été produite : la configuration actuelle ne correspond plus à ce " +
    `que le registre de souveraineté déclare. ${details}. Un document qui affirmerait le ` +
    "contraire de la réalité serait sans valeur devant un donneur d'ordre. Contactez " +
    "l'éditeur pour faire mettre le registre à jour avant d'émettre l'attestation."
  );
}
