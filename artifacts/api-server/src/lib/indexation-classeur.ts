/**
 * L'indexation d'un document métier au Classeur — ticket 4.31 b.
 *
 * ── Le défaut que ce module ferme ─────────────────────────────────────────
 * Verbatim de la session de test du 22/08 : « j'avais ajouté une facture au
 * tout début mais elle n'apparaît pas dans le classeur ». C'était exact :
 * seul l'envoi de photo écrivait au Classeur. Facture, devis, avoir, contrat
 * n'y entraient jamais.
 *
 * ── Un seul point de passage, et pourquoi ─────────────────────────────────
 * Le ticket demandait de passer par « le bus d'événements existant ». Il n'y
 * en a pas dans ce dépôt — l'invalidation se fait par React Query, côté
 * écran ; l'écart est consigné dans `docs/tickets/README.md`.
 *
 * À défaut, ce module est le point d'étranglement : UNE fonction, appelée à
 * chaque création de document. Ce n'est pas équivalent à un bus — un futur
 * producteur peut oublier de l'appeler — c'est pourquoi une garde
 * d'EXHAUSTIVITÉ compte les documents et les entrées de Classeur, et échoue
 * sur le moindre écart. La garde rattrape ce que l'architecture ne peut pas
 * empêcher ici.
 *
 * ── L'idempotence appartient au moteur ────────────────────────────────────
 * `onConflictDoNothing` sur l'index unique `(tenant_id, source_type,
 * source_id)`. Un « existe déjà ? » applicatif se contourne par deux requêtes
 * simultanées, qui lisent « non » toutes les deux — même raisonnement que
 * l'unicité des numéros de facture.
 *
 * L'index est partiel (`WHERE source_id IS NOT NULL`) pour sa taille, et non
 * pour sa correction : NULL étant distinct de NULL dans un index unique
 * PostgreSQL, les documents déposés à la main ne se gêneraient pas de toute
 * façon. Le distinguo compte — croire que la clause protège quelque chose
 * ferait paniquer qui la verrait disparaître.
 *
 * ── Ce que l'entrée porte, et ne porte pas ────────────────────────────────
 * Une RÉFÉRENCE, pas des octets. Le PDF d'une facture émise vit dans
 * `archived_pdfs`, immuable ; celui d'un brouillon n'existe pas encore. Y
 * recopier des octets créerait une seconde vérité du document, et la table
 * `classeur_document_bytes` est réservée à ce qui n'existe nulle part
 * ailleurs — un fichier déposé à la main, une photo.
 */
import { classeurTable } from "@workspace/db";
import type { withTenant } from "@workspace/db";

/** La transaction ouverte par `withTenant` — même type que partout ailleurs. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Les documents métier qui entrent au Classeur.
 *
 * `PHOTO` et `IMPORT` n'y figurent pas : ils n'ont pas d'existence hors du
 * Classeur, donc pas de source à désigner. Leur `source_id` reste nul, et
 * l'index d'unicité les ignore.
 */
export const SOURCES_CLASSEUR = ["FACTURE", "DEVIS", "AVOIR", "CONTRAT"] as const;
export type SourceClasseur = (typeof SOURCES_CLASSEUR)[number];

export interface DocumentAIndexer {
  readonly tenantId: string;
  readonly sourceType: SourceClasseur;
  readonly sourceId: string;
  /** Ce que l'utilisateur lira dans son Classeur : « Facture FACT-2026-0042 ». */
  readonly nom: string;
  /** Le chantier, quand le document en porte un. */
  readonly affaireId?: string | null | undefined;
}

/**
 * Range un document métier au Classeur. Sans effet s'il y est déjà.
 *
 * À appeler DANS la transaction qui crée le document : une entrée de Classeur
 * pour un document dont la création échoue ensuite serait un fantôme, et
 * l'inverse — un document sans entrée — est précisément le défaut qu'on
 * corrige.
 */
export async function indexerAuClasseur(tx: Tx, doc: DocumentAIndexer): Promise<void> {
  await tx
    .insert(classeurTable)
    .values({
      tenantId: doc.tenantId,
      name: doc.nom,
      // La catégorie EST le type de source : un Classeur qui rangerait les
      // factures sous « DIVERS » ne serait pas un classeur.
      category: doc.sourceType,
      mimeType: "application/pdf",
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      ...(doc.affaireId ? { affaireId: doc.affaireId } : {}),
    })
    .onConflictDoNothing();
}

/** Le libellé d'une entrée, au même endroit pour tous les producteurs. */
export function nomAuClasseur(type: SourceClasseur, reference: string | null | undefined, id: string): string {
  const LIBELLE: Readonly<Record<SourceClasseur, string>> = {
    FACTURE: "Facture", DEVIS: "Devis", AVOIR: "Avoir", CONTRAT: "Contrat",
  };
  // Un brouillon n'a pas encore de numéro : on retombe sur l'identifiant
  // plutôt que d'écrire « Facture null », et le nom se corrigera à l'émission.
  return `${LIBELLE[type]} ${reference?.trim() || id}`;
}
