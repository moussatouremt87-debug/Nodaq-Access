/*
 * L'attestation fiscale annuelle des services à la personne — US-B4.1.
 *
 * ── Ce que c'est, et pourquoi c'est un « Must » ───────────────────────────
 * Un particulier qui emploie une entreprise de services à la personne bénéficie
 * d'un crédit d'impôt de 50 % (art. 199 sexdecies du CGI). Pour le réclamer, il
 * lui faut une attestation annuelle, que le prestataire doit lui adresser avant
 * le 31 mars de l'année suivante. Sans elle, le client perd la moitié de ce
 * qu'il a payé — et il choisit souvent son prestataire là-dessus.
 *
 * ── Le point où la story et la loi divergent, et pourquoi la loi gagne ────
 * La story dit « l'ensemble des prestations FACTURÉES à chaque client sur une
 * année civile ». Fiscalement, c'est faux : l'attestation porte sur les sommes
 * EFFECTIVEMENT PAYÉES pendant l'année civile, pas sur ce qui a été facturé.
 *
 * L'écart n'est pas théorique. Une facture de décembre réglée en janvier
 * appartient à l'année suivante ; une facture jamais payée n'ouvre aucun droit.
 * Attester du facturé ferait réclamer au client un crédit d'impôt auquel il n'a
 * pas droit — et c'est LUI que l'administration redresserait, pas nous.
 *
 * Ce module calcule donc sur les ENCAISSEMENTS. Le champ porte ce nom pour
 * qu'aucune lecture rapide ne s'y trompe.
 *
 * ── Les aides perçues sont DÉDUITES ───────────────────────────────────────
 * APA, PCH, CESU préfinancé par un employeur : ces sommes ne sortent pas de la
 * poche du client, elles n'ouvrent donc pas droit au crédit d'impôt. Les
 * inclure gonflerait l'avantage fiscal déclaré. Le module les soustrait, et le
 * document les affiche séparément — un total sans ventilation serait invérifiable.
 */

/** Un encaissement, tel que la table `paiements` le porte. */
export interface EncaissementClient {
  readonly clientId: string;
  /** AAAA-MM-JJ — la date de l'encaissement, jamais celle de la facture. */
  readonly date: string;
  readonly montantCents: number;
  /**
   * Une aide versée par un tiers (APA, PCH, CESU préfinancé). Ces sommes sont
   * encaissées par l'entreprise mais ne sont pas payées par le client.
   */
  readonly estAideTiers?: boolean;
}

export interface ClientAttestable {
  readonly id: string;
  readonly nom: string;
  readonly adresse?: string | null;
}

/** Ce que l'entreprise doit déclarer sur le document. */
export interface PrestataireSap {
  readonly nom: string;
  readonly adresse?: string | null;
  readonly siret?: string | null;
  /**
   * Le numéro de déclaration SAP, délivré par la DREETS. SANS LUI
   * L'ATTESTATION NE VAUT RIEN : c'est ce numéro qui prouve que l'activité
   * ouvre droit au crédit d'impôt.
   */
  readonly numeroDeclarationSap?: string | null;
}

export interface AttestationClient {
  readonly clientId: string;
  readonly clientNom: string;
  readonly clientAdresse: string | null;
  readonly annee: number;
  /** Ce que le client a réellement payé, aides déduites. Base du crédit. */
  readonly montantEligibleCents: number;
  /** Les aides encaissées pour ce client — affichées, jamais additionnées. */
  readonly aidesCents: number;
  /** Total encaissé, toutes origines. `eligible + aides`. */
  readonly totalEncaisseCents: number;
  readonly nombreEncaissements: number;
}

export interface PlanAttestations {
  readonly attestations: readonly AttestationClient[];
  /** Ce qui n'a PAS produit d'attestation, et pourquoi. Jamais silencieux. */
  readonly ecartes: readonly { readonly clientId: string; readonly motif: string }[];
  /**
   * Ce qui empêche d'ÉMETTRE, quel que soit le client. Non vide = rien ne doit
   * partir : un document sans numéro de déclaration n'ouvre aucun droit et
   * devra être renvoyé, ce qui est pire que de ne rien envoyer.
   */
  readonly bloquants: readonly string[];
}

const dansAnnee = (iso: string, annee: number): boolean =>
  iso.startsWith(`${annee}-`);

/**
 * Ce que chaque client peut recevoir pour une année civile. PURE.
 *
 * Un client sans encaissement de l'année n'est pas attesté à zéro : il est
 * écarté. Une attestation à 0 € n'ouvre aucun droit, encombre l'envoi, et fait
 * douter le client de ce qu'il a payé.
 */
export function planAttestations(
  clients: readonly ClientAttestable[],
  encaissements: readonly EncaissementClient[],
  prestataire: PrestataireSap,
  annee: number,
): PlanAttestations {
  const bloquants: string[] = [];
  if (!prestataire.numeroDeclarationSap) {
    bloquants.push(
      "Votre numéro de déclaration SAP est absent. C'est lui qui prouve que votre " +
      "activité ouvre droit au crédit d'impôt : sans lui, l'attestation ne vaut rien " +
      "et vos clients devraient vous la redemander. Renseignez-le dans Paramètres.",
    );
  }
  if (!prestataire.siret) {
    bloquants.push("Le SIRET de votre entreprise est absent des paramètres.");
  }

  const parClient = new Map<string, EncaissementClient[]>();
  for (const e of encaissements) {
    if (!dansAnnee(e.date, annee)) continue;
    const acc = parClient.get(e.clientId) ?? [];
    acc.push(e);
    parClient.set(e.clientId, acc);
  }

  const attestations: AttestationClient[] = [];
  const ecartes: { clientId: string; motif: string }[] = [];

  for (const c of clients) {
    const lignes = parClient.get(c.id) ?? [];
    if (lignes.length === 0) {
      ecartes.push({ clientId: c.id, motif: `aucun encaissement en ${annee}` });
      continue;
    }
    const aidesCents = lignes.filter((l) => l.estAideTiers)
      .reduce((s, l) => s + l.montantCents, 0);
    const totalEncaisseCents = lignes.reduce((s, l) => s + l.montantCents, 0);
    const montantEligibleCents = totalEncaisseCents - aidesCents;

    if (montantEligibleCents <= 0) {
      // Tout a été réglé par un tiers : le client n'a rien déboursé, il n'a
      // donc droit à rien. Le dire vaut mieux qu'une attestation à zéro.
      ecartes.push({
        clientId: c.id,
        motif: `${annee} entièrement réglée par des aides — aucun montant éligible`,
      });
      continue;
    }

    attestations.push({
      clientId: c.id, clientNom: c.nom, clientAdresse: c.adresse ?? null,
      annee, montantEligibleCents, aidesCents, totalEncaisseCents,
      nombreEncaissements: lignes.length,
    });
  }

  return { attestations, ecartes, bloquants };
}

/**
 * L'échéance légale d'envoi : le 31 mars de l'année suivante.
 *
 * ── Le rappel proactif, deuxième critère ──────────────────────────────────
 * « Étant donné l'approche de cette échéance, alors un rappel proactif est
 * adressé au tenant s'il n'a pas encore lancé la génération. »
 *
 * Rendu en JOURS restants plutôt qu'en booléen : « il vous reste 12 jours » est
 * une information sur laquelle on agit ; « échéance proche » ne l'est pas.
 * Négatif = l'échéance est dépassée, et le dire reste utile — mieux vaut une
 * attestation en retard qu'aucune.
 */
export function joursAvantEcheance(aujourdhui: string, anneeAttestee: number): number {
  const limite = Date.UTC(anneeAttestee + 1, 2, 31);   // 31 mars, mois 2 = mars
  const [a, m, j] = aujourdhui.split("-").map(Number);
  return Math.round((limite - Date.UTC(a!, m! - 1, j!)) / 86_400_000);
}

/** L'année à attester aujourd'hui, et s'il faut alerter. */
export function rappelAttestation(
  aujourdhui: string,
  dejaGenereePourAnnee: readonly number[],
): { readonly annee: number; readonly joursRestants: number; readonly alerter: boolean } | null {
  const annee = Number(aujourdhui.slice(0, 4)) - 1;
  if (dejaGenereePourAnnee.includes(annee)) return null;

  const joursRestants = joursAvantEcheance(aujourdhui, annee);
  // On n'alerte pas toute l'année : avant le 1er janvier l'exercice n'est pas
  // clos, et rien ne peut être attesté. La fenêtre commence donc au 1er janvier
  // — `joursRestants <= 90` — et ne se referme pas au 31 mars : un retard se
  // rattrape, et le silence à cet instant serait le pire moment pour se taire.
  return { annee, joursRestants, alerter: joursRestants <= 90 };
}
