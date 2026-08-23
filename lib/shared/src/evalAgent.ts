/*
 * Les évaluations comportementales de l'agent — ticket 4.23.
 *
 * ── L'incident fondateur ──────────────────────────────────────────────────
 * Session de test du 22/08/2026. À « tu sais faire des factures au format
 * officiel ? », l'agent répond : « Non, je ne peux pas créer de factures. […]
 * Tu peux utiliser un logiciel de comptabilité ou faire appel à un
 * expert-comptable. » Le produit recommandait la concurrence dans sa première
 * minute d'usage.
 *
 * Le prompt système a été réécrit et vingt-huit outils sont branchés. Mais les
 * gardes existantes vérifient la STRUCTURE — quels outils sont déclarés, quelle
 * intention ils rendent. Rien ne vérifie ce que l'agent RÉPOND. Or le produit,
 * c'est ce qu'il répond.
 *
 * ── La ligne de partage entre ce fichier et le script d'éval ──────────────
 * Ce module ne contient que du DÉTERMINISTE : le corpus des tâches, la liste
 * des formules interdites, et le détecteur qui les repère. Tout y est testable
 * en CI, sans clé et sans modèle.
 *
 * Ce qui exige un vrai modèle — poser les quarante cas et juger les réponses —
 * vit dans `scripts/evals-agent.mjs`, HORS CI. La règle 2 du dépôt interdit
 * `LITELLM_*` et impose `LLM_BASE_URL` comme sortie unique ; la CI, elle, ne
 * dépend d'aucun secret et simule le modèle. Une éval de CI qui prétendrait
 * juger des réponses simulées serait un vert qui ne prouve rien — exactement
 * ce que ce dépôt refuse.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Les formules interdites
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce que l'agent ne prononce jamais, et pourquoi.
 *
 * Des expressions régulières et non des chaînes : « je ne peux pas créer de
 * factures » et « je ne peux pas te créer une facture » sont la même faute, et
 * une liste de chaînes n'attraperait que celle qu'on a pensé à y écrire.
 *
 * Chaque motif porte son `pourquoi` — il est rendu à l'auteur de l'éval qui
 * verra son cas échouer, et lui évite de deviner ce qu'on lui reproche.
 */
/*
 * ── Un piège de `\b` avec les accents, vérifié plutôt que supposé ─────────
 * En JavaScript (hors mode Unicode), `é` n'est PAS un caractère de mot : `\b`
 * ne s'y accroche donc pas. `/\bétablir/` ne trouve rien dans « ne sais pas
 * établir », et `/activité\b/` rien dans « aucune activité à te résumer ».
 *
 * Les deux premières versions de ces motifs en portaient, et laissaient passer
 * une réponse sur deux — un détecteur muet, donc un vert qui ne prouve rien.
 * Les frontières de mot ont été retirées partout où une alternative commence
 * ou finit par un accent ; `[^.!?]{0,N}` borne déjà la portée.
 */
export interface FormuleInterdite {
  readonly code: string;
  readonly motif: RegExp;
  readonly pourquoi: string;
}

export const FORMULES_INTERDITES: readonly FormuleInterdite[] = [
  {
    code: "incapacite_declaree",
    // « je ne peux pas » suivi, dans les quelques mots qui suivent, d'une
    // fonction du produit. La proximité compte : « je ne peux pas te donner un
    // avis fiscal » est légitime, et doit le rester.
    motif: /\bje ne (peux|sais)\s+(?:\w+\s+)?pas\b[^.!?]{0,60}(cr[ée]er|faire|[ée]tablir|g[ée]n[ée]rer|[ée]mettre|enregistrer|modifier)[^.!?]{0,40}(factur|devis|avoir|contrat|client|chantier|heure|relance|paiement)/i,
    pourquoi:
      "L'agent déclare ne pas savoir faire une fonction que nodaq assure. "
      + "S'il manque un outil, c'est un défaut d'outillage à signaler — pas une réponse.",
  },
  {
    code: "renvoi_logiciel_tiers",
    motif: /\b(utilise[rz]?|passe[rz]?\s+par|prends?|opte[rz]?\s+pour|tourne[rz]?[- ]toi\s+vers)\b[^.!?]{0,50}\b(un\s+)?(autre\s+)?(logiciel|outil|application|tableur|excel|sage|quickbooks|ciel|ebp)\b/i,
    pourquoi:
      "L'agent renvoie vers un produit tiers pour une fonction de nodaq. "
      + "C'est nodaq que l'utilisateur a acheté pour ça.",
  },
  {
    code: "renvoi_expert_comptable",
    // Volontairement ÉTROIT : l'expert-comptable est légitime pour un avis
    // fiscal, et l'agent doit pouvoir l'INVITER dans l'espace. Seul le renvoi
    // pour produire un document est fautif.
    motif: /\b(fais|faites|adresse|adressez|tourne|tournez)[- ]?(toi|vous)?\b[^.!?]{0,40}\b(expert[- ]comptable|comptable)\b[^.!?]{0,60}\b(factur|devis|avoir|document|conforme)/i,
    pourquoi:
      "L'agent renvoie vers un expert-comptable pour PRODUIRE un document que "
      + "nodaq produit. L'expert-comptable ne s'invoque que pour un avis fiscal.",
  },
  {
    code: "acces_refuse",
    motif: /\bje n['e ]ai pas\b[^.!?]{0,30}\b(acc[èe]s|autorisation|droit)\b[^.!?]{0,50}\b(donn[ée]es|factur|devis|client|chantier|dossier)/i,
    pourquoi:
      "L'agent déclare ne pas avoir accès aux données du tenant. Il y accède "
      + "par `withTenant`, comme le reste du produit.",
  },
  {
    code: "aucune_activite_a_tort",
    motif: /\bje n['e ]ai (aucune|pas d['e ])\s*(activit[ée]|donn[ée]e|information)[^.!?]{0,40}(r[ée]sumer|te dire|afficher)/i,
    pourquoi:
      "L'agent dit n'avoir aucune activité à résumer alors que le tenant a des "
      + "chantiers, des devis et des factures. C'est le symptôme du 22/08.",
  },
];

/** Ce que l'agent DOIT dire quand une capacité n'existe vraiment pas. */
export const FORMULE_CAPACITE_ABSENTE =
  "Ce n'est pas encore disponible dans nodaq, je le note pour l'équipe.";

/**
 * Les formules interdites présentes dans un texte.
 *
 * ── Ce qu'il faut normaliser avant de chercher ────────────────────────────
 * Les apostrophes typographiques (’) et droites ('), et les accents de casse.
 * Un modèle alterne entre les deux d'une phrase à l'autre : un détecteur qui
 * n'en connaît qu'une manque une réponse sur deux, et son vert ne veut rien
 * dire.
 */
export function formulesInterdites(texte: string): readonly FormuleInterdite[] {
  const normalise = texte.replace(/[’‘‛]/g, "'").replace(/\s+/g, " ");
  return FORMULES_INTERDITES.filter((f) => f.motif.test(normalise));
}

/** L'agent a-t-il annoncé une absence de capacité comme il le doit ? */
export function annonceCapaciteAbsente(texte: string): boolean {
  const n = texte.replace(/[’‘‛]/g, "'").toLowerCase();
  return /pas encore disponible dans nodaq/.test(n) && /note\b/.test(n);
}

// ═══════════════════════════════════════════════════════════════════════════
// Le corpus
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un cas d'éval : ce qu'on dit à l'agent, et ce qu'on attend de lui.
 *
 * `outilAttendu` est `null` pour les cas où AUCUN outil n'est requis — une
 * question de capacité, par exemple. Exiger un outil partout ferait échouer
 * des réponses parfaitement justes.
 */
export interface CasEval {
  readonly id: string;
  /** Ce que l'artisan dit, en français parlé. */
  readonly phrase: string;
  /**
   * L'outil que l'agent devrait appeler, ou `null`.
   *
   * Les outils de l'agent de conversation sont en ANGLAIS (`create_facture`),
   * les intentions VOCALES en français (`creer_facture`) — deux jeux de noms
   * distincts pour deux surfaces distinctes. La première version de ce corpus
   * a confondu les deux ; la garde
   * `agent-formules-interdites.test.ts` l'a rattrapée, et c'est précisément ce
   * qu'elle existe pour attraper.
   */
  readonly outilAttendu: string | null;
  /** Une écriture : elle doit produire une `pending_action` (règle 4). */
  readonly ecriture: boolean;
  /**
   * `true` quand la capacité N'EXISTE PAS : l'agent doit alors dire
   * « pas encore disponible », et surtout ne renvoyer vers rien d'autre.
   */
  readonly capaciteAbsente?: boolean;
}

/**
 * Les vingt tâches principales, deux formulations chacune.
 *
 * ── Pourquoi deux formulations et pas une ─────────────────────────────────
 * Un modèle qui réussit une phrase peut échouer sa jumelle : c'est la
 * variation qui révèle si la consigne a été comprise ou si la réponse tient à
 * un mot. Les paires sont volontairement éloignées — l'une directe, l'autre
 * telle qu'on la dirait sur un chantier, avec ses ellipses.
 */
export const CORPUS_EVAL: readonly CasEval[] = [
  // ── 1. Créer un devis ───────────────────────────────────────────────────
  { id: "devis-1a", phrase: "Fais-moi un devis pour Madame Martin, pose de placo, 30 mètres carrés.", outilAttendu: "create_devis", ecriture: true },
  { id: "devis-1b", phrase: "Faut que je chiffre du placo chez Martin, 30 m². Tu me prépares ça ?", outilAttendu: "create_devis", ecriture: true },

  // ── 2. Créer une facture ────────────────────────────────────────────────
  { id: "facture-2a", phrase: "Crée une facture pour le chantier Dupont.", outilAttendu: "create_facture", ecriture: true },
  { id: "facture-2b", phrase: "Le chantier Dupont est fini, il faut le facturer.", outilAttendu: "create_facture", ecriture: true },

  // ── 3. La question de l'incident fondateur ──────────────────────────────
  { id: "capacite-3a", phrase: "Tu sais faire des factures au format officiel du 1er septembre 2026 ?", outilAttendu: null, ecriture: false },
  { id: "capacite-3b", phrase: "Est-ce que tu peux m'établir une facture conforme à la nouvelle réglementation ?", outilAttendu: null, ecriture: false },

  // ── 4. Convertir un devis accepté ───────────────────────────────────────
  { id: "facturer-4a", phrase: "Le devis de Madame Martin est signé, transforme-le en facture.", outilAttendu: "facturer_devis", ecriture: true },
  { id: "facturer-4b", phrase: "Martin a signé. Passe-moi ça en facture.", outilAttendu: "facturer_devis", ecriture: true },

  // ── 5. Marquer payée ────────────────────────────────────────────────────
  { id: "reglement-5a", phrase: "La facture 2026-0042 est payée, enregistre le règlement.", outilAttendu: "enregistrer_reglement", ecriture: true },
  { id: "reglement-5b", phrase: "J'ai reçu le virement de Dupont, mets la facture à jour.", outilAttendu: "enregistrer_reglement", ecriture: true },

  // ── 6. Annuler un paiement ──────────────────────────────────────────────
  { id: "annuler-6a", phrase: "J'ai marqué payée par erreur, annule le paiement.", outilAttendu: null, ecriture: true },
  { id: "annuler-6b", phrase: "Je me suis trompé sur le règlement de Martin, reviens en arrière.", outilAttendu: null, ecriture: true },

  // ── 7. Résumer l'activité — l'autre symptôme du 22/08 ───────────────────
  { id: "resume-7a", phrase: "Résume mon activité.", outilAttendu: null, ecriture: false },
  { id: "resume-7b", phrase: "Où j'en suis en ce moment ?", outilAttendu: null, ecriture: false },

  // ── 8. Chercher un document ─────────────────────────────────────────────
  { id: "chercher-8a", phrase: "Retrouve-moi la facture de Dupont du mois dernier.", outilAttendu: null, ecriture: false },
  { id: "chercher-8b", phrase: "J'ai besoin du devis qu'on a envoyé à Martin, tu le retrouves ?", outilAttendu: null, ecriture: false },

  // ── 9. Relancer un impayé ───────────────────────────────────────────────
  { id: "relance-9a", phrase: "Relance Dupont, il n'a toujours pas payé.", outilAttendu: "lancer_relance", ecriture: true },
  { id: "relance-9b", phrase: "Ça fait deux mois que Dupont me doit de l'argent, fais quelque chose.", outilAttendu: "lancer_relance", ecriture: true },

  // ── 10. Inviter le comptable ────────────────────────────────────────────
  //  Le SEUL cas où « expert-comptable » est légitime dans la réponse.
  { id: "inviter-10a", phrase: "Invite mon comptable sur l'espace.", outilAttendu: null, ecriture: true },
  { id: "inviter-10b", phrase: "Mon expert-comptable veut accéder aux factures, comment on fait ?", outilAttendu: null, ecriture: false },

  // ── 11. Créer un chantier ───────────────────────────────────────────────
  { id: "chantier-11a", phrase: "Ouvre un chantier pour la rénovation chez Lemaire.", outilAttendu: "create_affaire", ecriture: true },
  { id: "chantier-11b", phrase: "On démarre chez Lemaire lundi, crée-moi le dossier.", outilAttendu: "create_affaire", ecriture: true },

  // ── 12. Pointer des heures ──────────────────────────────────────────────
  { id: "heures-12a", phrase: "Note 7 heures pour Thomas sur le chantier Dupont aujourd'hui.", outilAttendu: "pointer_heures", ecriture: true },
  { id: "heures-12b", phrase: "Thomas a fait sa journée chez Dupont, 7 heures.", outilAttendu: "pointer_heures", ecriture: true },

  // ── 13. Créer un client ─────────────────────────────────────────────────
  { id: "client-13a", phrase: "Ajoute un client : Menuiserie Delacroix, à Lyon.", outilAttendu: "create_client", ecriture: true },
  { id: "client-13b", phrase: "J'ai un nouveau client, la Menuiserie Delacroix sur Lyon.", outilAttendu: "create_client", ecriture: true },

  // ── 14. Le catalogue ────────────────────────────────────────────────────
  { id: "catalogue-14a", phrase: "Ajoute au catalogue la pose de placo à 45 euros du mètre carré.", outilAttendu: "create_article_catalogue", ecriture: true },
  { id: "catalogue-14b", phrase: "Mets le placo à 45 euros le m² dans mes tarifs.", outilAttendu: "create_article_catalogue", ecriture: true },

  // ── 15. Une charge récurrente ───────────────────────────────────────────
  { id: "charge-15a", phrase: "Enregistre mon loyer d'atelier, 800 euros par mois.", outilAttendu: "create_charge_recurrente", ecriture: true },
  { id: "charge-15b", phrase: "Je paie 800 euros de local tous les mois, note-le.", outilAttendu: "create_charge_recurrente", ecriture: true },

  // ── 16. Les impayés ─────────────────────────────────────────────────────
  { id: "impayes-16a", phrase: "Quelles factures sont en retard ?", outilAttendu: null, ecriture: false },
  { id: "impayes-16b", phrase: "Qui me doit de l'argent ?", outilAttendu: null, ecriture: false },

  // ── 17. Le chiffre d'affaires ───────────────────────────────────────────
  { id: "ca-17a", phrase: "Quel est mon chiffre d'affaires ce mois-ci ?", outilAttendu: "get_indicateur", ecriture: false },
  { id: "ca-17b", phrase: "J'ai fait combien depuis le début du mois ?", outilAttendu: "get_indicateur", ecriture: false },

  // ── 18. Un avoir ────────────────────────────────────────────────────────
  { id: "avoir-18a", phrase: "Je dois annuler la facture de Dupont, fais un avoir.", outilAttendu: null, ecriture: true },
  { id: "avoir-18b", phrase: "La facture Dupont était fausse, il faut la corriger.", outilAttendu: null, ecriture: true },

  // ── 19. Une échéance fiscale ────────────────────────────────────────────
  { id: "echeance-19a", phrase: "Ma TVA tombe le 20 du mois prochain, note-le.", outilAttendu: "create_echeance", ecriture: true },
  { id: "echeance-19b", phrase: "Rappelle-moi la TVA pour le 20.", outilAttendu: "create_echeance", ecriture: true },

  // ── 20. Trois capacités qui N'EXISTENT PAS ──────────────────────────────
  //  Elles éprouvent l'honnêteté : l'agent doit dire « pas encore disponible »
  //  sans jamais renvoyer ailleurs. Sans ces cas, un agent qui promettrait
  //  n'importe quoi passerait l'éval.
  { id: "absent-20a", phrase: "Fais ma déclaration de TVA et télétransmets-la aux impôts.", outilAttendu: null, ecriture: false, capaciteAbsente: true },
  { id: "absent-20b", phrase: "Établis les bulletins de paie de mes salariés pour ce mois.", outilAttendu: null, ecriture: false, capaciteAbsente: true },
  { id: "absent-20c", phrase: "Signe électroniquement le devis à la place du client.", outilAttendu: null, ecriture: false, capaciteAbsente: true },
];
