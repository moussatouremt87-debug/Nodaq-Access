/**
 * Le déclencheur du brief du matin — appelé de l'EXTÉRIEUR, sans session.
 *
 * ── POURQUOI CETTE ROUTE EXISTE ─────────────────────────────────────────────
 *
 * Ce dépôt n'a aucun ordonnanceur, et c'est un parti pris : un `setInterval`
 * dans le serveur tomberait en double dès qu'il y a deux instances et mourrait
 * au redéploiement. Le temps qui passe est donc géré dehors — un cron de
 * conteneur appelle cette route chaque matin.
 *
 * ── SON AUTHENTIFICATION ────────────────────────────────────────────────────
 *
 * Un secret partagé, comparé en temps constant. Pas de signature HMAC comme
 * les webhooks bancaires : il n'y a pas de corps à signer, et une signature
 * sur rien n'ajoute rien. Le secret vient de `BRIEF_CRON_SECRET`.
 *
 * SANS SECRET CONFIGURÉ, LA ROUTE REFUSE — elle ne s'ouvre pas « par défaut ».
 * Une porte qui s'ouvre quand la serrure manque n'est pas une porte : c'est
 * exactement la règle des variables de modèle (§2), où une variable absente
 * lève plutôt que de retomber sur une valeur.
 *
 * ── CE QU'ELLE N'ACCEPTE PAS ────────────────────────────────────────────────
 *
 * Aucun destinataire, aucun tenant en paramètre. Une route déclenchable de
 * l'extérieur qui accepterait l'un ou l'autre serait un moyen de faire envoyer
 * les données d'une entreprise à n'importe qui. Le destinataire est lu en
 * base — même garde que la transmission du support.
 */
import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { envoyerBriefsDuJour } from "../lib/brief-quotidien.js";

const router: IRouter = Router();

function memeSecret(recu: string, attendu: string): boolean {
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post("/interne/brief-quotidien", async (req, res): Promise<void> => {
  const attendu = process.env["BRIEF_CRON_SECRET"]?.trim();
  if (!attendu) {
    // 503 et non 500 : la configuration manque, ce n'est pas une panne de
    // code. Même traitement que la sortie modèle absente.
    res.status(503).json({ error: "Déclencheur non configuré." });
    return;
  }
  const recu = req.header("x-nodaq-cron") ?? "";
  if (!memeSecret(recu, attendu)) {
    res.status(403).json({ error: "Refusé." });
    return;
  }

  const resultats = await envoyerBriefsDuJour();
  /*
   * On rend un DÉCOMPTE par état, jamais la liste des tenants ni des
   * adresses : cette réponse finit dans les journaux d'un cron, et la règle 6
   * interdit d'y laisser des données d'entreprise.
   */
  const parEtat: Record<string, number> = {};
  for (const r of resultats) parEtat[r.etat] = (parEtat[r.etat] ?? 0) + 1;
  res.json({ traites: resultats.length, parEtat });
});

export default router;
