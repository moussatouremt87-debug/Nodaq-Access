/*
 * RGPD assistant (ticket 3.9) — same doctrine as regulatoryWatch (3.7) and
 * frenchTax (2.19): SME processing-activity templates (CNIL simplified
 * register) are a VERSIONED, DATED, SOURCED config, and the register audit
 * is a pure, deterministic engine — every issue justified, no invented law,
 * no LLM. General information, NOT legal advice nor a DPO — the output
 * label says so permanently. RAG over CNIL corpora is a future ticket.
 */

/** Catalog snapshot date — bump on every template/rule change. */
export const RGPD_REGISTER_VERSION = "2026-08-12";

/** Article 6 legal bases. */
export const LEGAL_BASES = [
  "consentement",
  "contrat",
  "obligation_legale",
  "interet_legitime",
  "mission_publique",
  "interets_vitaux",
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const DATA_CATEGORIES = [
  "identite",
  "contact",
  "financier",
  "vie_professionnelle",
  "connexion",
  "localisation",
  "image",
  "sante",
  "autre",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export interface ProcessingTemplate {
  id: string;
  name: string;
  purpose: string;
  legalBasis: LegalBasis;
  dataCategories: readonly string[];
  dataSubjects: readonly string[];
  recipients: string;
  /** Sourced retention duration, ready to display. */
  retention: string;
  sensitiveData: boolean;
  source: { label: string; url: string };
}

/**
 * Typical SME processing activities — CNIL simplified register model,
 * retention durations from the CNIL reference tables and the cited texts.
 * Verified at RGPD_REGISTER_VERSION date.
 */
export const PROCESSING_TEMPLATES: readonly ProcessingTemplate[] = [
  {
    id: "paie",
    name: "Paie et administration du personnel",
    purpose:
      "Établir les bulletins de paie, gérer contrats, absences (y compris arrêts de " +
      "travail — données de santé, art. 9) et déclarations sociales",
    legalBasis: "obligation_legale",
    dataCategories: ["identite", "contact", "financier", "vie_professionnelle", "sante"],
    dataSubjects: ["salaries"],
    recipients: "Service RH, expert-comptable, URSSAF, caisses sociales",
    retention: "5 ans (double des bulletins, art. L3243-4 c. trav.) ; déclarations sociales 3 ans",
    sensitiveData: true,
    source: {
      label: "CNIL — modèle de registre simplifié",
      url: "https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement",
    },
  },
  {
    id: "facturation-clients",
    name: "Facturation et comptabilité clients",
    purpose: "Émettre devis et factures, tenir la comptabilité, recouvrer les impayés",
    legalBasis: "contrat",
    dataCategories: ["identite", "contact", "financier"],
    dataSubjects: ["clients"],
    recipients: "Service comptable, expert-comptable, administration fiscale",
    retention: "10 ans (pièces comptables, art. L123-22 c. com.)",
    sensitiveData: false,
    source: {
      label: "CNIL — durées de conservation",
      url: "https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees",
    },
  },
  {
    id: "journal-envois",
    name: "Journal des envois de documents commerciaux",
    purpose:
      "Tracer l'expédition des devis, factures et avoirs (destinataire, date, " +
      "statut) pour prouver qu'un document est parti et quand — notamment en cas " +
      "de contestation de délai. Ni le corps ni l'objet du message ne sont conservés.",
    legalBasis: "interet_legitime",
    dataCategories: ["contact"],
    dataSubjects: ["clients"],
    recipients: "Le seul tenant émetteur ; aucun destinataire externe",
    retention:
      "12 mois à compter de l'envoi (ENVOIS_JOURNAL_RETENTION_DAYS). Durée " +
      "assumée par le produit et non imposée par un texte : au-delà, la trace " +
      "n'a plus d'usage opérationnel et deviendrait une base de contacts conservée sans motif.",
    sensitiveData: false,
    source: {
      label: "CNIL — les durées de conservation des données",
      url: "https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees",
    },
  },
  {
    id: "prospection-b2b",
    name: "Prospection B2B (courrier, téléphone, e-mail professionnel)",
    purpose:
      "Constituer et exploiter un fichier de prospects PROFESSIONNELS et leur adresser " +
      "des offres en lien avec leur activité (l'e-mailing vers des particuliers relève " +
      "du modèle « Prospection B2C », soumis au consentement)",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "contact"],
    dataSubjects: ["prospects"],
    recipients: "Service commercial",
    retention: "3 ans après le dernier contact du prospect (référentiel CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — prospection commerciale",
      url: "https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique",
    },
  },
  {
    id: "prospection-signaux-publics",
    name: "Constitution de pistes à partir de registres publics d'entreprises",
    purpose:
      "Proposer des axes de prospection et enrichir des fiches PROSPECTS " +
      "PROFESSIONNELS à partir de registres publics d'entreprises. Les personnes " +
      "physiques — entrepreneurs individuels — sont écartées à la source : une " +
      "donnée publiquement accessible n'est pas librement réutilisable, et la " +
      "prospection téléphonique vers un particulier exige un consentement " +
      "préalable depuis le 11 août 2026",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "contact", "vie_professionnelle"],
    dataSubjects: ["prospects"],
    recipients: "Service commercial",
    retention: "3 ans après le dernier contact du prospect (référentiel CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — réutilisation des données publiquement accessibles",
      url: "https://www.cnil.fr/fr/la-reutilisation-des-donnees-publiquement-accessibles-en-ligne-des-fins-de-demarchage-commercial",
    },
  },
  {
    id: "prospection-sous-traitance-decp",
    name: "Signal de sous-traitance depuis les attributions de marchés publics (DECP)",
    purpose:
      "Repérer, par secteur CPV et par zone, les entreprises venant de remporter un " +
      "marché public — piste de sous-traitance. Par défaut, seuls des AGRÉGATS " +
      "anonymisés (sous le seuil, aucune ligne publiée) sont rendus : le jeu de " +
      "données DECP ne porte aucun marqueur fiable personne physique/personne " +
      "morale, et un titulaire peut être un entrepreneur individuel — donc une " +
      "personne physique. Un titulaire nommé n'est exposé que si le déploiement " +
      "active explicitement DECP_AFFICHER_TITULAIRES_PRO",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "vie_professionnelle", "localisation"],
    dataSubjects: ["prospects"],
    recipients: "Service commercial",
    retention: "Aucune donnée conservée : calcul à la demande, à chaque appel",
    sensitiveData: false,
    source: {
      label: "data.gouv.fr — Données essentielles de la commande publique (DECP)",
      url: "https://www.data.gouv.fr/datasets/donnees-essentielles-de-la-commande-publique-5",
    },
  },
  {
    id: "prospection-syndics-rnic",
    name: "Repérage de syndics de copropriété (RNIC)",
    purpose:
      "Identifier les syndics PROFESSIONNELS d'un secteur à partir du registre " +
      "national d'immatriculation des copropriétés, comme cible de démarchage pour " +
      "l'entretien des parties communes. Les syndics BÉNÉVOLES — des résidents, donc " +
      "des personnes physiques — ne sont jamais nommés : ils ne sortent qu'agrégés " +
      "par commune, sous le même seuil d'anonymat que les autres signaux publics. Un " +
      "syndic professionnel nommé n'est exposé que si le déploiement active " +
      "explicitement RNIC_AFFICHER_SYNDICS_PRO",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "vie_professionnelle", "localisation"],
    dataSubjects: ["prospects"],
    recipients: "Service commercial",
    retention: "Aucune donnée conservée : calcul à la demande, à chaque appel",
    sensitiveData: false,
    source: {
      label: "data.gouv.fr — Registre national d'immatriculation des copropriétés (RNIC)",
      url: "https://www.data.gouv.fr/datasets/registre-national-dimmatriculation-des-coproprietes",
    },
  },
  {
    id: "prospection-permis-construire",
    name: "Signal de permis de construire (Sitadel)",
    purpose:
      "Proposer des pistes de prospection à partir des permis de construire, " +
      "déclarations préalables et permis d'aménager déposés dans la zone du tenant. " +
      "Une piste PROFESSIONNELLE (personne morale, raison sociale) n'est exposée que " +
      "si le déploiement active explicitement PERMIS_AFFICHER_PISTES_PRO. Un permis " +
      "porté par un PARTICULIER n'est jamais présenté comme une piste à contacter : " +
      "seuls son nom et son adresse — déjà publics sur le permis lui-même — sont " +
      "affichés à titre d'information, sans numéro de téléphone ni adresse e-mail, " +
      "et sans aucune action de contact automatisée dans l'application",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "localisation"],
    dataSubjects: ["prospects"],
    recipients: "Service commercial",
    retention: "Aucune donnée conservée : calcul à la demande, à chaque appel",
    sensitiveData: false,
    source: {
      label: "data.gouv.fr — Sitadel, permis de construire (SDES)",
      url: "https://www.data.gouv.fr/",
    },
  },
  {
    id: "prospection-b2c",
    name: "Prospection B2C par voie électronique",
    purpose:
      "Adresser des offres par e-mail ou SMS à des PARTICULIERS — opt-in préalable " +
      "obligatoire (art. L34-5 CPCE), sauf clients existants pour des produits analogues",
    legalBasis: "consentement",
    dataCategories: ["identite", "contact"],
    dataSubjects: ["prospects", "clients"],
    recipients: "Service commercial",
    retention: "3 ans après le dernier contact, retrait du consentement immédiat (CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — prospection commerciale par courrier électronique",
      url: "https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique",
    },
  },
  {
    id: "gestion-clients",
    name: "Gestion de la relation clients",
    purpose: "Suivre les commandes, chantiers et interventions, gérer le SAV",
    legalBasis: "contrat",
    dataCategories: ["identite", "contact", "financier"],
    dataSubjects: ["clients"],
    recipients: "Équipes internes",
    retention: "Durée de la relation + prescriptions légales (5 ans, art. 2224 c. civ.)",
    sensitiveData: false,
    source: {
      label: "CNIL — modèle de registre simplifié",
      url: "https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement",
    },
  },
  {
    id: "fournisseurs",
    name: "Gestion des fournisseurs",
    purpose: "Commander, régler et suivre les fournisseurs et sous-traitants",
    legalBasis: "contrat",
    dataCategories: ["identite", "contact", "financier"],
    dataSubjects: ["fournisseurs"],
    recipients: "Service achats, comptabilité",
    retention: "10 ans (pièces comptables, art. L123-22 c. com.)",
    sensitiveData: false,
    source: {
      label: "CNIL — modèle de registre simplifié",
      url: "https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement",
    },
  },
  {
    id: "recrutement",
    name: "Recrutement",
    purpose: "Recevoir et instruire les candidatures, constituer un vivier",
    legalBasis: "interet_legitime",
    dataCategories: ["identite", "contact", "vie_professionnelle"],
    dataSubjects: ["candidats"],
    recipients: "Dirigeant, responsable du recrutement",
    retention: "2 ans après le dernier contact avec le candidat (référentiel CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — recrutement",
      url: "https://www.cnil.fr/fr/le-recrutement-et-la-gestion-du-personnel",
    },
  },
  {
    id: "videosurveillance",
    name: "Vidéosurveillance des locaux",
    purpose: "Sécuriser les locaux, prévenir les vols et intrusions",
    legalBasis: "interet_legitime",
    dataCategories: ["image"],
    dataSubjects: ["salaries", "visiteurs"],
    recipients: "Dirigeant, prestataire de sécurité, forces de l'ordre sur réquisition",
    retention: "1 mois maximum (recommandation CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — vidéosurveillance au travail",
      url: "https://www.cnil.fr/fr/la-videosurveillance-videoprotection-au-travail",
    },
  },
  {
    id: "site-web",
    name: "Site web et statistiques de fréquentation",
    purpose:
      "Déposer des cookies et mesurer l'audience du site vitrine (les formulaires de " +
      "contact relèvent de la prospection ou de la relation clients)",
    legalBasis: "consentement",
    dataCategories: ["connexion", "contact"],
    dataSubjects: ["prospects", "visiteurs"],
    recipients: "Hébergeur, prestataire web",
    retention: "Cookies 13 mois max, mesures d'audience 25 mois (recommandation CNIL)",
    sensitiveData: false,
    source: {
      label: "CNIL — cookies et traceurs",
      url: "https://www.cnil.fr/fr/cookies-et-autres-traceurs",
    },
  },
] as const;

export interface RegisterActivityInput {
  name: string;
  legalBasis: string;
  dataCategories: readonly string[];
  retention: string;
  sensitiveData: boolean;
}

export interface RgpdIssue {
  code:
    | "registre_vide"
    | "duree_manquante"
    | "base_invalide"
    | "base_inadaptee"
    | "donnees_sensibles"
    | "incoherence_sensible";
  severity: "alerte" | "attention";
  /** Absent for register-level issues. */
  activityName?: string;
  /** French, self-contained justification. */
  reason: string;
}

export interface RgpdAudit {
  version: string;
  activityCount: number;
  issues: RgpdIssue[];
  label: "information générale à date du catalogue — ne remplace pas un conseil juridique ni un DPO";
}

/**
 * Pure register audit — deterministic, explainable. It flags what is missing
 * or inconsistent; it never invents an obligation beyond the cited basics.
 */
export function auditRgpdRegister(activities: RegisterActivityInput[]): RgpdAudit {
  const issues: RgpdIssue[] = [];

  if (activities.length === 0) {
    issues.push({
      code: "registre_vide",
      severity: "alerte",
      reason:
        "aucun traitement enregistré — le registre des activités de traitement est exigible " +
        "lors de tout contrôle CNIL (RGPD art. 30) ; partez des modèles proposés",
    });
  }

  for (const activity of activities) {
    if (activity.retention.trim() === "") {
      issues.push({
        code: "duree_manquante",
        severity: "alerte",
        activityName: activity.name,
        reason: "aucune durée de conservation déclarée — champ obligatoire du registre (art. 30)",
      });
    }
    if (!(LEGAL_BASES as readonly string[]).includes(activity.legalBasis)) {
      issues.push({
        code: "base_invalide",
        severity: "alerte",
        activityName: activity.name,
        reason: `base légale « ${activity.legalBasis.slice(0, 40)} » inconnue — choisir une des six bases de l'art. 6`,
      });
    }
    if (activity.sensitiveData) {
      // Le consentement explicite PEUT lever l'interdiction (art. 9 §2 a) ;
      // l'intérêt légitime seul, jamais — d'où l'alerte ciblée.
      if (activity.legalBasis === "interet_legitime") {
        issues.push({
          code: "base_inadaptee",
          severity: "alerte",
          activityName: activity.name,
          reason:
            "données sensibles (art. 9) sur base « intérêt légitime » : l'interdiction de " +
            "principe exige une exception de l'art. 9 §2 — à revoir avec un conseil",
        });
      } else {
        issues.push({
          code: "donnees_sensibles",
          severity: "attention",
          activityName: activity.name,
          reason:
            "traitement de données sensibles (art. 9) : conditions renforcées (exception " +
            "art. 9 §2, sécurité, minimisation) — vigilance particulière",
        });
      }
    }
    if (
      !activity.sensitiveData &&
      activity.dataCategories.some((category) => category === "sante")
    ) {
      issues.push({
        code: "incoherence_sensible",
        severity: "attention",
        activityName: activity.name,
        reason:
          "la catégorie « santé » est déclarée sans le drapeau données sensibles — les " +
          "données de santé relèvent de l'art. 9",
      });
    }
  }

  return {
    version: RGPD_REGISTER_VERSION,
    activityCount: activities.length,
    issues,
    label:
      "information générale à date du catalogue — ne remplace pas un conseil juridique ni un DPO",
  };
}
