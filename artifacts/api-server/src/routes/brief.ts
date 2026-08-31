/**
 * L'écran Brief.
 *
 * Le CALCUL vit dans `lib/brief.ts` : le brief part aussi par courriel le
 * matin, et deux façons de décider « ce qui compte aujourd'hui » finiraient
 * par se contredire — l'artisan lirait une urgence dans sa boîte sans la
 * retrouver à l'écran. Cette route ne fait plus que servir le résultat.
 */
import { Router, type IRouter } from "express";
import { composerBrief } from "../lib/brief.js";

const router: IRouter = Router();

router.get("/brief", async (req, res): Promise<void> => {
  res.json(await composerBrief(req.tenantId!));
});

export default router;
