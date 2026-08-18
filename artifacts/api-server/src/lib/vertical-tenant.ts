/**
 * Le secteur d'activité d'un tenant, et le vocabulaire que l'assistant doit
 * employer pour lui — US-A1.1 (le secteur) et US-A6.1 (le vocabulaire).
 *
 * ── Pourquoi ce fichier existe ───────────────────────────────────────────
 * NEUF fichiers déclaraient chacun leur `VERTICAL_SETTING_KEY` et leur propre
 * `DEFAULT_VERTICAL`. Rien n'aurait signalé que deux d'entre eux divergent :
 * un écran serait simplement passé au vocabulaire neutre pendant qu'un autre
 * restait en BTP, sur le même tenant. La clé et le défaut se déclarent ici,
 * une fois.
 *
 * ── Le défaut est BTP, délibérément ──────────────────────────────────────
 * Le produit est né bâtiment. Un tenant qui n'a jamais répondu à la question
 * du secteur (créé avant US-A1.1, ou onboarding pas encore arrivé à cet
 * écran) garde le vocabulaire BTP historique. Le basculer en vocabulaire
 * neutre serait une régression visible pour toute la base existante, pas une
 * prudence. Raisonnement d'origine dans `routes/votre-metier.ts`.
 */
import { withTenant, type DrizzleTx } from "@workspace/db";
import { sql } from "drizzle-orm";
import { verticalPack, type Vertical } from "@nodaq/shared";

export const VERTICAL_SETTING_KEY = "votre-metier.metier";
export const DEFAULT_VERTICAL: Vertical = "industrie_btp";

/**
 * Le secteur, lu DANS une transaction déjà ouverte — le cas majoritaire :
 * la plupart des appelants lisent d'autres tables au même endroit et n'ont
 * aucune raison d'ouvrir une seconde transaction pour un seul réglage.
 */
export async function verticalDepuisTx(tx: DrizzleTx): Promise<Vertical> {
  const result = await tx.execute(
    sql`SELECT value FROM settings WHERE key = ${VERTICAL_SETTING_KEY}`,
  );
  const valeur = (result.rows[0] as { value?: string } | undefined)?.value;
  return (valeur as Vertical | undefined) ?? DEFAULT_VERTICAL;
}

/** Le secteur, quand l'appelant n'a pas de transaction sous la main. */
export async function verticalDuTenant(tenantId: string): Promise<Vertical> {
  return withTenant(tenantId, (tx) => verticalDepuisTx(tx));
}

/**
 * Le bloc de vocabulaire injecté dans les prompts de l'assistant (US-A6.1).
 *
 * C'est LA « couche de configuration séparée du modèle » que demande la
 * story : ajouter un secteur reste une entrée dans `VERTICAL_PACKS`
 * (`lib/shared/src/verticalPacks.ts`), jamais un réentraînement ni une
 * retouche de prompt. Rien n'est inventé ici — on ne fait que rendre au
 * modèle les mots que les packs déclarent déjà pour l'interface, afin que
 * l'assistant et les écrans parlent enfin la même langue.
 *
 * Volontairement prescriptif sur le point qui compte (« emploie ces mots »)
 * et muet sur le reste : le modèle n'a pas besoin qu'on lui explique le
 * métier, seulement qu'on lui donne le lexique.
 */
export function vocabulaireAssistant(vertical: Vertical): string {
  const pack = verticalPack(vertical);
  const { words } = pack;
  return [
    "═══ VOCABULAIRE DE CETTE ENTREPRISE ═══",
    `Secteur déclaré : ${pack.label}.`,
    "",
    "Emploie EXACTEMENT ces mots quand tu t'adresses à l'utilisateur —",
    "ce sont ceux que son interface affiche, et il ne connaît pas les autres :",
    `  • une affaire se dit « ${words.singular} » (au pluriel « ${words.plural} », ${words.definite}, ${words.indefinite})`,
    `  • un devis se dit « ${pack.proposalWord} »`,
    `  • un prestataire externe se dit « ${pack.externalWorkerWords.singular} »`,
    "",
    // Formulé SANS nommer le mot d'un autre secteur : écrire ici « ne dis
    // jamais chantier » serait absurde pour un maçon, à qui ce même bloc
    // vient de demander de dire « chantier ». La consigne porte sur la
    // règle, pas sur un contre-exemple qui se retournerait contre la moitié
    // des tenants.
    "N'emploie jamais le mot d'un autre secteur, même s'il te semble",
    "équivalent : l'utilisateur y lit un outil conçu pour quelqu'un d'autre.",
  ].join("\n");
}
