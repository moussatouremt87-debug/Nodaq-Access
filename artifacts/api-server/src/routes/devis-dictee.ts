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
  type CatalogueEntree,
  type IntentionDictee,
} from "@nodaq/shared";

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

const SYSTEM_PROMPT = `Tu découpes la dictée d'un artisan du bâtiment en lignes de devis.

Pour chaque OUVRAGE OU PRESTATION FACTURABLE mentionné — un matériau posé, un
travail réalisé, un service rendu — rends :
- "libelle" : l'ouvrage, en quelques mots, tel que l'artisan le nomme
- "quantite" : le nombre dicté POUR CET OUVRAGE (surface, longueur, nombre
  d'unités posées), ou null s'il n'en donne pas
- "unite" : l'unité dictée (m2, ml, u, h, forfait…), ou null

CE QUI N'EST JAMAIS UNE LIGNE DE DEVIS, même accompagné d'un nombre — ignore
ces éléments, ne les rends PAS comme intentions :
- le nombre d'OUVRIERS ou de personnes sur le chantier ("trois ouvriers",
  "on sera deux") : une information d'organisation, pas un ouvrage facturé ;
- une DURÉE de chantier ("dix jours", "sur deux semaines") : sauf si
  l'artisan facture explicitement du temps de main d'œuvre ("dix heures de
  pose"), auquel cas c'est l'ouvrage facturé, pas une durée de planning ;
- le nom du client, son adresse, la ville du chantier, une date de début :
  des informations du dossier, pas des lignes de devis.

RÈGLE ABSOLUE : tu ne donnes JAMAIS de prix, de tarif, de montant, ni de total.
Les prix viennent du catalogue de l'entreprise, pas de toi. Si l'artisan cite un
montant, ignore-le : il sera repris depuis le catalogue.

Exemple :
Dicté : « Madame Martin veut refaire sa toiture, la couverture et la
gouttière à Lyon. On sera trois sur le chantier pendant une semaine. »
Réponse : {"intentions":[
  {"libelle":"réfection toiture","quantite":null,"unite":null},
  {"libelle":"couverture","quantite":null,"unite":null},
  {"libelle":"gouttière","quantite":null,"unite":null}
]}
(« Madame Martin », « à Lyon », « trois », « une semaine » : absents de la
réponse — ce sont des informations de dossier, pas des ouvrages.)

Réponds UNIQUEMENT par un objet JSON de la forme :
{"intentions":[{"libelle":"...","quantite":12,"unite":"m2"}]}`;

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
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
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

  // 1. Découpage par le modèle — aucun prix ne circule dans ce prompt.
  const reponse = await chatCompletion(config, [
    { role: "system", content: SYSTEM_PROMPT },
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
