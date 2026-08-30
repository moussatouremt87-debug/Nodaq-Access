/**
 * Dictée → proposition de devis.
 *
 * LA SÉPARATION QUI TIENT TOUT LE RESTE :
 *
 *   le modèle DÉCOUPE          → libellé, quantité, unité (des faits dictés)
 *   le catalogue CHIFFRE       → prix, taux de TVA (des données du tenant)
 *
 * Le prompt ne contient AUCUN prix, et le schéma Zod de sortie n'a aucun champ
 * de prix : même si le modèle en produisait un, il serait rejeté à la
 * frontière. C'est une garantie structurelle, pas une consigne de rédaction —
 * un modèle qui « oublie » une instruction est un incident quotidien, un champ
 * qui n'existe pas dans le schéma ne peut pas traverser (CLAUDE.md §3).
 *
 * Cette route ne WRITE rien : elle rend une proposition. La création du devis
 * passe par le chemin existant de devis.ts, sur clic de l'utilisateur.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant, catalogueLignesTable } from "@workspace/db";
import { chargerAlias } from "../lib/alias-catalogue.js";
import { getConfig, chatCompletion, LlmConfigError } from "@nodaq/llm";
import {
  rapprocherDictee,
  totalProposition,
  affaireWords,
  verticalPack,
  type CatalogueEntree,
  type IntentionDictee,
  type Vertical,
} from "@nodaq/shared";
import { verticalDuTenant } from "../lib/vertical-tenant.js";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const ProposerBody = z.object({
  /** Texte transcrit — vient de /api/chat/transcribe ou saisi à la main. */
  texte: z.string().min(1).max(10_000),
});

/**
 * Sortie ATTENDUE du modèle. Aucun champ de prix, volontairement : c'est la
 * frontière qui rend « le modèle ne fixe jamais un prix » structurel.
 */
const IntentionSchema = z.object({
  libelle: z.string().min(1).max(300),
  quantite: z.number().positive().nullable(),
  unite: z.string().max(20).nullable(),
});
const SortieModeleSchema = z.object({
  intentions: z.array(IntentionSchema).max(50),
});

/**
 * La consigne donnée au modèle, dans le vocabulaire du secteur (US-A6.1).
 *
 * Elle était écrite en dur pour le bâtiment — « un artisan du bâtiment »,
 * « ouvriers sur le chantier », et un exemple de toiture et de gouttière. Un
 * consultant qui dictait une proposition se faisait donc découper sa phrase
 * par un modèle amorcé sur du gros œuvre.
 *
 * L'EXEMPLE, lui, est délibérément neutre : il enseigne la FORME de la sortie
 * (ce qui devient une ligne, ce qui n'en devient pas), pas un métier. Un
 * exemple par secteur ferait dix-sept textes à inventer puis à maintenir, pour
 * une leçon identique.
 *
 * Restait un biais que la première correction avait laissé passer, et c'est
 * celui que le point d'attention d'US-A2.2 nomme : la liste d'unités données
 * en exemple commençait par « m2, ml » — deux unités de chantier, sur chaque
 * appel, quel que soit le métier. Elle vient désormais du pack sectoriel :
 * « couvert » pour un restaurant, « séance » pour un kiné, « km » pour un
 * transporteur. Une garde interdit son retour en dur.
 */
function systemPrompt(vertical: Vertical): string {
  const words = affaireWords(vertical);
  return `Tu découpes une dictée professionnelle en lignes de ${verticalPack(vertical).proposalWord.toLowerCase()}.

Pour chaque OUVRAGE OU PRESTATION FACTURABLE mentionné — un matériau posé, un
travail réalisé, un service rendu — rends :
- "libelle" : la prestation, en quelques mots, telle qu'elle est nommée
- "quantite" : le nombre dicté POUR CETTE PRESTATION (surface, longueur, nombre
  d'unités, durée facturée), ou null s'il n'en donne pas
- "unite" : l'unité dictée (${verticalPack(vertical).unitesExemples.join(", ")}…), ou null

CE QUI N'EST JAMAIS UNE LIGNE FACTURABLE, même accompagné d'un nombre — ignore
ces éléments, ne les rends PAS comme intentions :
- le nombre de PERSONNES mobilisées ("trois ouvriers", "on sera deux") : une
  information d'organisation, pas une prestation facturée ;
- une DURÉE ${words.definite} ("dix jours", "sur deux semaines") : sauf si le
  temps de travail est explicitement facturé ("dix heures de pose"), auquel cas
  c'est la prestation facturée, pas une durée de planning ;
- le nom du client, son adresse, le lieu, une date de début : des informations
  du dossier, pas des lignes facturables.

RÈGLE ABSOLUE : tu ne donnes JAMAIS de prix, de tarif, de montant, ni de total.
Les prix viennent du catalogue de l'entreprise, pas de toi. Si un montant est
cité, ignore-le : il sera repris depuis le catalogue.

Exemple :
Dicté : « Madame Martin veut trois heures de diagnostic et la remise en état
du poste principal, à Lyon. On sera deux sur place pendant une semaine. »
Réponse : {"intentions":[
  {"libelle":"diagnostic","quantite":3,"unite":"h"},
  {"libelle":"remise en état du poste principal","quantite":null,"unite":null}
]}
(« Madame Martin », « à Lyon », « deux », « une semaine » : absents de la
réponse — ce sont des informations de dossier, pas des prestations.)

Réponds UNIQUEMENT par un objet JSON de la forme :
{"intentions":[{"libelle":"...","quantite":12,"unite":"${verticalPack(vertical).unitesExemples[0]}"}]}`;
}

/** Extrait le premier objet JSON d'une réponse, tolérant aux blocs ```json. */
function extraireJson(contenu: string): unknown {
  const sansBloc = contenu.replace(/```(?:json)?/gi, "").trim();
  const debut = sansBloc.indexOf("{");
  const fin = sansBloc.lastIndexOf("}");
  if (debut === -1 || fin === -1 || fin <= debut) return null;
  try {
    return JSON.parse(sansBloc.slice(debut, fin + 1));
  } catch {
    return null;
  }
}

/**
 * POST /devis/dictee/proposer
 *
 * Rend une proposition relisible : chaque ligne porte sa provenance de prix
 * (catalogue, alias, à compléter) et le total n'additionne que le chiffrable.
 */
router.post("/devis/dictee/proposer", async (req, res): Promise<void> => {
  const parsed = ProposerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof LlmConfigError) {
      res.status(503).json({ error: `Configuration LLM absente : ${err.message}` });
      return;
    }
    throw err;
  }

  // US-A6.1 — relu à chaque dictée : changement de secteur appliqué dès la
  // dictée suivante, sans redémarrage (AC3).
  const vertical = await verticalDuTenant(tenantId);

  // 1. Découpage par le modèle — aucun prix ne circule dans ce prompt.
  const reponse = await chatCompletion(config, [
    { role: "system", content: systemPrompt(vertical) },
    { role: "user", content: parsed.data.texte },
  ]);

  const contenu = reponse.choices?.[0]?.message?.content ?? "";
  const brut = extraireJson(typeof contenu === "string" ? contenu : "");
  const valide = SortieModeleSchema.safeParse(brut);

  // Une sortie de modèle illisible n'est pas une erreur serveur : c'est une
  // proposition vide, que l'utilisateur complète à la main.
  const intentions: IntentionDictee[] = valide.success ? valide.data.intentions : [];

  // 2. Chiffrage déterministe depuis le catalogue du tenant.
  const catalogue = await withTenant(tenantId, (tx) =>
    tx.select().from(catalogueLignesTable).where(eq(catalogueLignesTable.actif, true)),
  );
  const entrees: CatalogueEntree[] = catalogue.map((c) => ({
    id: c.id,
    libelle: c.libelle,
    unite: c.unite,
    prixUnitaireHtCents: c.prixUnitaireHtCents,
    tauxTva: c.tauxTva,
    motsCles: c.motsCles,
  }));

  // Les alias appris par CE tenant — des corrections humaines antérieures.
  // Ils passent AVANT le libellé dans l'ordre de rapprochement : c'est tout
  // l'intérêt, et c'est pourquoi on refuse d'en apprendre un qui recouvrirait
  // le libellé exact d'une autre ligne.
  const alias = await chargerAlias(tenantId);
  const lignes = rapprocherDictee(intentions, entrees, alias);
  const total = totalProposition(lignes);

  res.json({
    lignes,
    ...total,
    /** Le modèle n'a rien rendu d'exploitable — l'écran le dit à l'utilisateur. */
    decoupageIllisible: !valide.success,
    catalogueVide: entrees.length === 0,
  });
});

export default router;
