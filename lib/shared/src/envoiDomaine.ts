/*
 * Authentification du domaine d'envoi — SPF, DKIM, DMARC.
 *
 * POURQUOI CE MODULE NE CONTIENT AUCUNE VALEUR DE FOURNISSEUR.
 *
 * La valeur `include:` du SPF et le format des enregistrements dépendent du
 * service d'envoi, et changent sans préavis. Les écrire en dur produirait du
 * code qui PARAÎT juste et échoue en production — le pire mode de défaillance
 * ici, parce que les tests, qui simulent le DNS, passeraient au vert quand
 * même. Elles arrivent donc par la configuration, exactement comme
 * `LLM_BASE_URL` pour les modèles (CLAUDE.md §2).
 *
 * Ce qui est COMMUN à tous les tenants : la valeur `include:` du SPF — elle
 * désigne le service d'envoi. Elle vient de la configuration.
 *
 * Ce qui est PROPRE À CHAQUE DOMAINE : le sélecteur DKIM et sa valeur — ils
 * sont émis par le service à l'enrôlement du domaine. Ils sont stockés par
 * tenant.
 *
 * Zéro accès réseau : la résolution DNS est INJECTÉE. Ce module reçoit les
 * enregistrements déjà résolus et rend un diagnostic. C'est ce qui permet de
 * l'éprouver sans DNS, et de dire précisément à l'artisan ce qui manque.
 */

export type TypeEnregistrement = "SPF" | "DKIM" | "DMARC";

/** Un enregistrement que l'artisan doit publier. */
export interface EnregistrementAttendu {
  readonly type: TypeEnregistrement;
  /** Nom DNS complet à créer, prêt à copier. */
  readonly nom: string;
  /**
   * Fragment que la valeur publiée doit contenir.
   * `null` = la seule présence d'un enregistrement valide suffit (DMARC).
   */
  readonly doitContenir: string | null;
  /** Phrase affichée à l'artisan, en français, prête à lire. */
  readonly commentFaire: string;
}

export interface EtatEnregistrement extends EnregistrementAttendu {
  readonly present: boolean;
  readonly conforme: boolean;
  /** Valeur trouvée dans le DNS, pour que l'écran montre l'écart. */
  readonly valeurTrouvee: string | null;
  readonly message: string;
}

export interface DiagnosticDomaine {
  readonly domaine: string;
  readonly conforme: boolean;
  readonly enregistrements: readonly EtatEnregistrement[];
  /** Ce qui bloque, nommé — vide si tout est conforme. */
  readonly manquants: readonly string[];
}

/** Ce que la configuration doit fournir, et ce que le tenant a enregistré. */
export interface ConfigurationDomaine {
  readonly domaine: string;
  /** COMMUN — valeur `include:` du SPF, depuis la configuration du service. */
  readonly spfInclude: string;
  /** PAR DOMAINE — émis à l'enrôlement. `null` = pas encore renseigné. */
  readonly dkimSelecteur: string | null;
  /** PAR DOMAINE — valeur TXT attendue. `null` = pas encore renseignée. */
  readonly dkimValeur: string | null;
}

/**
 * Construit la liste des enregistrements attendus.
 *
 * Le DKIM n'est listé que si le sélecteur ET la valeur sont connus : demander à
 * l'artisan de publier un enregistrement dont on ignore le contenu ne l'avance
 * à rien, et afficher un attendu vide laisserait croire que l'étape est faite.
 */
export function enregistrementsAttendus(
  config: ConfigurationDomaine,
): EnregistrementAttendu[] {
  const d = config.domaine.trim().toLowerCase();
  const attendus: EnregistrementAttendu[] = [
    {
      type: "SPF",
      nom: d,
      doitContenir: config.spfInclude,
      commentFaire:
        `Créez un enregistrement TXT sur « ${d} » contenant « v=spf1 ${config.spfInclude} ~all ». ` +
        `Si un SPF existe déjà, AJOUTEZ-Y « ${config.spfInclude} » : un domaine ne doit porter ` +
        `qu'un seul enregistrement SPF, un second annulerait le premier.`,
    },
  ];

  if (config.dkimSelecteur && config.dkimValeur) {
    attendus.push({
      type: "DKIM",
      nom: `${config.dkimSelecteur}._domainkey.${d}`,
      doitContenir: config.dkimValeur,
      commentFaire:
        `Créez un enregistrement TXT sur « ${config.dkimSelecteur}._domainkey.${d} » ` +
        `avec la valeur fournie par votre service d'envoi.`,
    });
  }

  attendus.push({
    type: "DMARC",
    nom: `_dmarc.${d}`,
    doitContenir: null,
    commentFaire:
      `Créez un enregistrement TXT sur « _dmarc.${d} » commençant par « v=DMARC1 ». ` +
      `« v=DMARC1; p=none; rua=mailto:… » suffit pour commencer : il vous fait ` +
      `remonter les rapports sans rien bloquer.`,
  });

  return attendus;
}

/** Résolution DNS injectée : nom → enregistrements TXT trouvés. */
export type EnregistrementsResolus = ReadonlyMap<string, readonly string[]>;

/** Normalise un TXT : le DNS peut le renvoyer découpé en morceaux de 255. */
function joindre(valeurs: readonly string[]): string {
  return valeurs.join("").replace(/\s+/g, " ").trim();
}

/**
 * Confronte les enregistrements attendus à ceux réellement publiés.
 *
 * Aucun appel réseau : `resolus` vient d'un résolveur injecté. Un nom absent de
 * la Map signifie « rien de publié », pas « erreur de résolution » : l'appelant
 * doit distinguer les deux avant d'appeler.
 */
export function verifierDomaine(
  config: ConfigurationDomaine,
  resolus: EnregistrementsResolus,
): DiagnosticDomaine {
  const attendus = enregistrementsAttendus(config);

  const enregistrements: EtatEnregistrement[] = attendus.map((attendu) => {
    const trouves = resolus.get(attendu.nom) ?? [];
    const valeurTrouvee = trouves.length > 0 ? joindre(trouves) : null;

    if (valeurTrouvee === null) {
      return {
        ...attendu,
        present: false,
        conforme: false,
        valeurTrouvee: null,
        message: `Aucun enregistrement TXT trouvé sur « ${attendu.nom} ».`,
      };
    }

    // DMARC : la présence d'un enregistrement valide suffit.
    if (attendu.doitContenir === null) {
      const conforme = valeurTrouvee.toLowerCase().startsWith("v=dmarc1");
      return {
        ...attendu,
        present: true,
        conforme,
        valeurTrouvee,
        message: conforme
          ? "Enregistrement DMARC présent."
          : "Un enregistrement existe mais ne commence pas par « v=DMARC1 ».",
      };
    }

    const conforme = valeurTrouvee.toLowerCase().includes(attendu.doitContenir.toLowerCase());
    return {
      ...attendu,
      present: true,
      conforme,
      valeurTrouvee,
      message: conforme
        ? `Enregistrement ${attendu.type} conforme.`
        : `L'enregistrement existe mais ne contient pas « ${attendu.doitContenir} ».`,
    };
  });

  const manquants = enregistrements.filter((e) => !e.conforme).map((e) => `${e.type} (${e.nom})`);

  return {
    domaine: config.domaine,
    // Le domaine n'est utilisable que si TOUT est conforme. Un SPF sans DKIM
    // passe certains filtres et pas d'autres : annoncer « prêt » sur cette base
    // enverrait l'artisan en indésirables sans qu'il comprenne pourquoi.
    conforme: enregistrements.every((e) => e.conforme),
    enregistrements,
    manquants,
  };
}

/**
 * Durée de conservation du journal d'envois, en jours.
 *
 * `envois_journal.destinataire` est l'adresse du client de l'artisan : une
 * donnée personnelle. Douze mois couvrent le besoin opérationnel — retrouver
 * si et quand un devis est parti, y compris lors d'une contestation de délai —
 * sans transformer une trace technique en base de prospection conservée
 * indéfiniment. Au-delà, la trace n'a plus d'usage et ne se justifie plus.
 *
 * Décision produit, à revoir avec le conseil RGPD du client : ce n'est pas une
 * durée imposée par un texte, c'est une durée qu'on assume et qu'on documente.
 */
export const ENVOIS_JOURNAL_RETENTION_DAYS = 365;

/** Date avant laquelle une ligne de journal doit être purgée. */
export function envoisJournalCutoff(maintenant: Date = new Date()): Date {
  const limite = new Date(maintenant);
  limite.setDate(limite.getDate() - ENVOIS_JOURNAL_RETENTION_DAYS);
  return limite;
}
