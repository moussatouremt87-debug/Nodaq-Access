/*
 * Rapprochement dictée → catalogue.
 *
 * LA RÈGLE QUE CE MODULE FAIT RESPECTER : le prix ne vient JAMAIS du modèle.
 *
 * Le modèle découpe une dictée en INTENTIONS — « pose de cloisons BA13, trente
 * mètres carrés ». Libellé, quantité et unité sont des faits dictés par
 * l'artisan. Le prix, lui, n'est pas dicté : il est cherché ici, dans le
 * catalogue du tenant, par une fonction déterministe. Sans correspondance, la
 * ligne sort SANS prix et marquée « à compléter ».
 *
 * Zéro appel réseau, zéro accès base, zéro LLM : des objets entrent, des objets
 * sortent. C'est ce qui permet de l'éprouver contre des cas écrits à la main,
 * et c'est la seule façon d'oser afficher un devis au client d'un artisan.
 *
 * Pourquoi pas de correspondance approximative floue (distance de Levenshtein
 * ou similaire) : un rapprochement « presque bon » attribue le prix d'un
 * ouvrage à un autre. Sur un devis, ça ne se voit pas — ça se paie. On
 * n'apparie que sur des signaux nets (libellé exact, mot-clé, alias appris),
 * et on préfère rendre « à compléter » plutôt que de deviner.
 */

/** Une ligne du catalogue du tenant, réduite à ce que le rapprochement lit. */
export interface CatalogueEntree {
  readonly id: string;
  readonly libelle: string;
  readonly unite: string | null;
  readonly prixUnitaireHtCents: number;
  readonly tauxTva: number;
  readonly motsCles: readonly string[];
}

/** Ce que le modèle a le droit de produire : des faits dictés, jamais un prix. */
export interface IntentionDictee {
  readonly libelle: string;
  readonly quantite: number | null;
  readonly unite: string | null;
  /**
   * Prix unitaire HT en centimes, quand l'utilisateur l'a DICTÉ.
   *
   * Il n'arrive jamais du modèle directement : l'appelant l'a d'abord passé
   * par `centimesDepuisDictee`, qui le refuse s'il ne figure pas dans la
   * transcription. Un chiffre halluciné n'atteint pas ce champ — il vaut
   * `null`, et la ligne redevient « à compléter ».
   *
   * Le CATALOGUE reste prioritaire : ce prix ne sert que là où le catalogue
   * n'a rien à dire. Sans cette priorité, un article tarifé prendrait deux
   * valeurs différentes selon qu'on l'a dicté ou non.
   */
  readonly prixUnitaireHtCents?: number | null;
}

/**
 * D'où vient le prix d'une ligne — affiché à l'utilisateur, jamais masqué.
 *
 * `dicte` : l'utilisateur l'a prononcé et le chiffre a été retrouvé dans sa
 * phrase. C'est le seul cas où un prix n'est pas issu du catalogue, et il
 * s'affiche comme tel : l'artisan doit voir que ce montant vient de sa bouche
 * et non de son tarif.
 */
export type ProvenancePrix = "catalogue" | "alias" | "a_completer" | "dicte";

export interface LigneProposee {
  readonly libelle: string;
  readonly quantite: number | null;
  readonly unite: string | null;
  /** `null` = aucun prix. Jamais 0 par défaut : 0 est un prix, pas une absence. */
  readonly prixUnitaireHtCents: number | null;
  readonly tauxTva: number | null;
  readonly provenance: ProvenancePrix;
  /** Ligne de catalogue retenue, pour tracer et pour l'apprentissage. */
  readonly catalogueLigneId: string | null;
}

/**
 * Normalisation pour comparaison : minuscules, accents retirés, ponctuation
 * réduite à des espaces. « Cloison B.A.13 » et « cloison ba13 » doivent se
 * rencontrer ; « cloison » et « cloisonnement » ne le doivent pas.
 */
export function normaliser(texte: string): string {
  return (
    texte
      .toLowerCase()
      // NFD sépare « é » en « e » + accent combinant ; la plage U+0300–U+036F
      // retire ces accents. Écrite en échappements et non en caractères
      // littéraux : des marques combinantes dans le source sont invisibles à la
      // relecture et un éditeur peut les manger sans que rien ne le signale.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/** Dictionnaire d'alias appris PAR TENANT : libellé normalisé → id de ligne. */
export type AliasCatalogue = ReadonlyMap<string, string>;

/**
 * Rapproche une intention d'une ligne de catalogue.
 *
 * Ordre de préférence, du plus sûr au moins sûr — on s'arrête au premier :
 *   1. alias appris par CE tenant (une correction humaine antérieure) ;
 *   2. libellé identique une fois normalisé ;
 *   3. mot-clé du catalogue présent comme MOT ENTIER dans l'intention.
 *
 * Le point 3 exige un mot entier : chercher « placo » en sous-chaîne
 * apparierait « emplacement ».
 *
 * Une ambiguïté au point 3 — deux lignes de catalogue également plausibles —
 * ne se tranche PAS : on rend « à compléter ». Choisir au hasard entre deux
 * prix est pire que ne pas choisir.
 */
export function rapprocher(
  intention: IntentionDictee,
  catalogue: readonly CatalogueEntree[],
  alias: AliasCatalogue = new Map(),
): LigneProposee {
  const cible = normaliser(intention.libelle);

  /**
   * Aucun prix venu du catalogue.
   *
   * On se rabat alors sur le prix DICTÉ s'il y en a un — « la réfection du
   * mur pour 1200 euros » n'est dans aucun catalogue, et c'est précisément le
   * cas où l'humain est la seule source recevable du chiffre. À défaut, la
   * ligne reste à compléter : on ne devine pas un prix.
   */
  const sansPrix = (): LigneProposee => {
    const dicte = intention.prixUnitaireHtCents;
    const aUnPrixDicte = typeof dicte === "number" && Number.isFinite(dicte) && dicte > 0;
    return {
      libelle: intention.libelle,
      quantite: intention.quantite,
      unite: intention.unite,
      prixUnitaireHtCents: aUnPrixDicte ? dicte : null,
      // Aucun taux de TVA n'est deviné : il n'a pas été dicté et le catalogue
      // n'a rien dit. `executerPlan` applique le taux par défaut, comme pour
      // toute ligne sans tarif connu.
      tauxTva: null,
      provenance: aUnPrixDicte ? "dicte" : "a_completer",
      catalogueLigneId: null,
    };
  };

  if (cible.length === 0) return sansPrix();

  const depuis = (entree: CatalogueEntree, provenance: ProvenancePrix): LigneProposee => ({
    libelle: entree.libelle,
    quantite: intention.quantite,
    // L'unité du catalogue fait foi quand elle existe : c'est elle qui
    // correspond au prix. Une dictée « en mètres » face à un tarif au m² doit
    // afficher le m², sinon la quantité et le prix ne parlent pas de la même
    // chose.
    unite: entree.unite ?? intention.unite,
    prixUnitaireHtCents: entree.prixUnitaireHtCents,
    tauxTva: entree.tauxTva,
    provenance,
    catalogueLigneId: entree.id,
  });

  // 1. Alias appris par ce tenant.
  const idAlias = alias.get(cible);
  if (idAlias !== undefined) {
    const entree = catalogue.find((c) => c.id === idAlias);
    if (entree) return depuis(entree, "alias");
    // Alias orphelin (ligne supprimée depuis) : on ne s'en sert pas, et on ne
    // le remplace pas par une approximation.
  }

  // 2. Libellé identique après normalisation.
  const exact = catalogue.filter((c) => normaliser(c.libelle) === cible);
  if (exact.length === 1) return depuis(exact[0]!, "catalogue");
  if (exact.length > 1) return sansPrix(); // ambiguïté : on ne tranche pas

  // 3. Mot-clé du catalogue présent comme mot entier dans l'intention.
  const motsIntention = new Set(cible.split(" ").filter(Boolean));
  const parMotCle = catalogue.filter((c) =>
    c.motsCles.some((mot) => {
      const m = normaliser(mot);
      return m.length > 0 && m.split(" ").every((partie) => motsIntention.has(partie));
    }),
  );
  if (parMotCle.length === 1) return depuis(parMotCle[0]!, "catalogue");

  // Aucune correspondance, ou plusieurs également plausibles.
  return sansPrix();
}

/** Rapproche une dictée entière. */
export function rapprocherDictee(
  intentions: readonly IntentionDictee[],
  catalogue: readonly CatalogueEntree[],
  alias: AliasCatalogue = new Map(),
): LigneProposee[] {
  return intentions.map((i) => rapprocher(i, catalogue, alias));
}

/**
 * Total HT des lignes CHIFFRABLES, en centimes.
 *
 * Les lignes « à compléter » sont exclues et comptées à part : les additionner
 * à zéro annoncerait un devis moins cher que la réalité, ce qui est exactement
 * l'erreur qu'on ne peut pas se permettre sur un prix envoyé à un client.
 */
export function totalProposition(lignes: readonly LigneProposee[]): {
  totalHtCents: number;
  lignesChiffrees: number;
  lignesACompleter: number;
} {
  let totalHtCents = 0;
  let lignesChiffrees = 0;
  let lignesACompleter = 0;

  for (const ligne of lignes) {
    if (ligne.prixUnitaireHtCents === null || ligne.quantite === null) {
      lignesACompleter += 1;
      continue;
    }
    totalHtCents += Math.round(ligne.prixUnitaireHtCents * ligne.quantite);
    lignesChiffrees += 1;
  }

  return { totalHtCents, lignesChiffrees, lignesACompleter };
}
