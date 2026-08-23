/*
 * Facturer le temps passé — US-A2.4, et le temps facturable — US-B5.4.
 *
 * ── Ce que l'audit du 23/08 a constaté ────────────────────────────────────
 * Le produit sait POINTER des heures et les analyser ; il ne sait pas les
 * FACTURER. C'est le mode de facturation entier des professions libérales, du
 * conseil et des services aux entreprises — trois des neuf modules
 * sectoriels. Le bâtiment facture au forfait ou au métré, et le produit avait
 * été construit sur cette hypothèse.
 *
 * ── Aucune seconde saisie d'heures ────────────────────────────────────────
 * Le point d'attention de la story est explicite : « éviter de construire
 * deux systèmes de saisie d'heures parallèles pour un même besoin ». Ce
 * module part des pointages existants et n'en crée aucun.
 *
 * ── Ce module ne décide d'aucun prix ──────────────────────────────────────
 * Il applique un taux SAISI par l'entreprise à des heures POINTÉES par elle.
 * Rien n'est estimé, rien n'est arrondi au-delà du centime. La règle 3 du
 * dépôt vaut ici comme ailleurs : un chiffre affiché vient d'un calcul
 * déterministe.
 */

/** Un taux, et le jour où il prend effet. */
export interface TauxDate {
  readonly dateEffet: string;      // AAAA-MM-JJ
  readonly montantCents: number;
  /** `null` = le taux de l'entreprise ; sinon celui d'un membre précis. */
  readonly membreId?: string | null | undefined;
}

/** Une heure pointée, telle que la table `pointages` la porte. */
export interface HeurePointee {
  readonly id: string;
  readonly date: string;           // AAAA-MM-JJ
  readonly heures: number;
  readonly membreId?: string | null | undefined;
  readonly facturable: boolean;
  readonly commentaire?: string | null | undefined;
}

/**
 * Le taux en vigueur à une date donnée.
 *
 * ── Le critère le plus exigeant de la story ───────────────────────────────
 * « Un taux modifié en cours d'année : une nouvelle facture applique le taux
 * en vigueur à la DATE DE LA PRESTATION, pas le taux courant. » Facturer en
 * mars un travail de janvier au tarif de mars est indéfendable devant un
 * client — et c'est ce que ferait toute lecture du « dernier taux connu ».
 *
 * On retient donc le taux le plus RÉCENT parmi ceux dont la prise d'effet
 * précède ou égale la date de la prestation.
 *
 * ── La priorité entre taux de membre et taux d'entreprise ─────────────────
 * Un taux nommant le membre l'emporte toujours sur le taux général, même si
 * celui-ci est plus récent : désigner quelqu'un est une intention plus forte
 * qu'une mise à jour globale. Sans cette règle, changer le tarif d'entreprise
 * écraserait silencieusement celui d'un associé.
 */
export function tauxApplicable(
  historique: readonly TauxDate[],
  date: string,
  membreId?: string | null,
): number | null {
  const eligibles = historique.filter((t) => t.dateEffet <= date);
  if (eligibles.length === 0) return null;

  const plusRecent = (l: readonly TauxDate[]): TauxDate | null =>
    l.reduce<TauxDate | null>((a, t) => (a === null || t.dateEffet > a.dateEffet ? t : a), null);

  if (membreId) {
    const duMembre = plusRecent(eligibles.filter((t) => t.membreId === membreId));
    if (duMembre) return duMembre.montantCents;
  }
  const general = plusRecent(eligibles.filter((t) => !t.membreId));
  return general?.montantCents ?? null;
}

/** Une ligne de facture issue d'une journée de travail. */
export interface LigneTemps {
  readonly date: string;
  readonly heures: number;
  readonly tauxCents: number;
  readonly montantCents: number;
  readonly libelle: string;
}

export interface ResultatFacturationTemps {
  readonly lignes: readonly LigneTemps[];
  readonly totalHeures: number;
  readonly totalCents: number;
  /** Ce qui n'a PAS pu être facturé, et pourquoi. Jamais silencieux. */
  readonly ecartes: readonly { readonly pointageId: string; readonly date: string; readonly motif: string }[];
}

/** Le jour, tel qu'on l'écrit sur une facture française. */
function jourFr(iso: string): string {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

/** Les heures, avec leur virgule. « 7,5 h » et non « 7.5 h ». */
function heuresFr(h: number): string {
  return `${h.toFixed(2).replace(/[.,]?0+$/, "").replace(".", ",")} h`;
}

/**
 * Construit les lignes d'une facture à partir d'heures pointées.
 *
 * ── Une ligne PAR JOUR, et c'est l'annexe ─────────────────────────────────
 * Le deuxième critère demande que « le détail des dates et durées soit
 * disponible en annexe, pas seulement le total ». Une ligne par journée le
 * satisfait par construction : le PDF rend déjà date, quantité, prix unitaire
 * et total pour chaque ligne. Pas d'annexe séparée à fabriquer, donc pas de
 * second document qui pourrait diverger du premier.
 *
 * ── Ce qui est ÉCARTÉ est nommé ───────────────────────────────────────────
 * Un pointage sans taux applicable — parce qu'il précède le premier taux
 * saisi — n'est pas facturé à zéro et n'est pas ignoré : il ressort dans
 * `ecartes`, avec son motif. Facturer à zéro ferait disparaître du travail
 * réel ; l'ignorer en silence ferait la même chose sans le dire.
 */
export function lignesDepuisHeures(
  heures: readonly HeurePointee[],
  historique: readonly TauxDate[],
): ResultatFacturationTemps {
  const parJour = new Map<string, { heures: number; taux: number }>();
  const ecartes: { pointageId: string; date: string; motif: string }[] = [];

  for (const p of heures) {
    if (!p.facturable) {
      ecartes.push({ pointageId: p.id, date: p.date, motif: "marqué non facturable" });
      continue;
    }
    const taux = tauxApplicable(historique, p.date, p.membreId);
    if (taux === null) {
      ecartes.push({
        pointageId: p.id, date: p.date,
        motif: "aucun taux horaire en vigueur à cette date",
      });
      continue;
    }
    // Regroupées par jour ET par taux : deux membres au même tarif tiennent
    // sur une ligne, deux tarifs différents en font deux. Mélanger les taux
    // sur une ligne rendrait le prix unitaire faux.
    const cle = `${p.date}#${taux}`;
    const courant = parJour.get(cle) ?? { heures: 0, taux };
    courant.heures += p.heures;
    parJour.set(cle, courant);
  }

  const lignes: LigneTemps[] = [...parJour.entries()]
    .map(([cle, v]) => {
      const date = cle.split("#")[0]!;
      return {
        date, heures: v.heures, tauxCents: v.taux,
        // `Math.round` sur le produit, jamais sur chaque facteur : arrondir
        // les heures d'abord perdrait les quarts d'heure.
        montantCents: Math.round(v.heures * v.taux),
        libelle: `Intervention du ${jourFr(date)} — ${heuresFr(v.heures)}`,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    lignes,
    totalHeures: lignes.reduce((s, l) => s + l.heures, 0),
    totalCents: lignes.reduce((s, l) => s + l.montantCents, 0),
    ecartes,
  };
}

/**
 * Le taux d'occupation : part du temps facturable dans le temps pointé.
 *
 * US-B5.4 : « étant donné un indicateur de taux d'occupation, alors il se
 * calcule sur la base de cette distinction plutôt que sur le temps total
 * enregistré ».
 *
 * `null` sans aucune heure : afficher « 0 % » à quelqu'un qui n'a rien pointé
 * lui reprocherait une inactivité qu'il n'a pas.
 */
export function tauxOccupation(heures: readonly HeurePointee[]): number | null {
  const total = heures.reduce((s, p) => s + p.heures, 0);
  if (total === 0) return null;
  const facturable = heures.filter((p) => p.facturable).reduce((s, p) => s + p.heures, 0);
  // Points entiers : afficher 66,67 % sur trois journées donnerait une
  // précision que la donnée n'a pas.
  return Math.round((facturable / total) * 100);
}
