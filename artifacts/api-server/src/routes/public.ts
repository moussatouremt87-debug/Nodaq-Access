/**
 * Routes publiques — sans authentification.
 *
 * C'est la seule surface du produit que voit le CLIENT DE L'ARTISAN, et celle
 * qui transforme un devis en engagement. Elle n'avait aucun test et rendait 500
 * sur chaque appel (voir `lookupByToken` ci-dessous) : le parcours
 * d'acceptation n'avait jamais fonctionné.
 *
 * La recherche par jeton emploie la policy étroite `devis_public_token_lookup`,
 * qui n'autorise `app_user` à lire une ligne de `devis` que lorsque le réglage
 * de session `app.devis_accept_token_sha256` correspond. Une fois la ligne — et
 * donc son `tenant_id` — identifiée, TOUTE écriture repasse par `withTenant`.
 *
 * ── Le jeton n'est pas en base ──────────────────────────────────────────────
 * Seul son condensat SHA-256 y est rangé. Le jeton lui-même ne vit que dans le
 * lien envoyé au client. Qui lit une sauvegarde ou un réplica ne peut plus
 * accepter un devis à la place du client.
 *
 * ── Ce qu'on ne dit jamais ──────────────────────────────────────────────────
 * Un jeton inconnu et un devis inexistant rendent EXACTEMENT la même réponse.
 * Distinguer les deux confirmerait à un curieux qu'un jeton a existé.
 *
 * GET  /public/devis/:token/accept-page  — métadonnées de la page d'acceptation
 * POST /public/devis/:token/accept       — enregistre le « bon pour accord »
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, devisTable, withTenant, settingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { toDateString } from "@nodaq/shared";
import { genererPdfDevis, chargerEmetteur, nomFichierDevis } from "../lib/pdf-devis.js";

const router: IRouter = Router();

const AcceptBody = z.object({
  signataire: z.string().min(1, "Le nom du signataire est obligatoire"),
});

/** LA réponse d'échec. Une seule, pour ne rien révéler par la différence. */
const INTROUVABLE = { error: "Lien invalide ou expiré." } as const;

// ── Limitation de débit ──────────────────────────────────────────────────────

/**
 * Fenêtre glissante par adresse IP, en mémoire.
 *
 * Ces deux routes sont ouvertes sans authentification et révèlent, sur
 * présentation d'un jeton, la référence, le nom du client et le montant. Un
 * jeton de 128 bits rend l'énumération peu réaliste — mais une route publique
 * sans limite reste une route publique sans limite.
 *
 * EN MÉMOIRE, donc PAR PROCESSUS : derrière plusieurs instances, la limite
 * effective est multipliée par leur nombre. C'est assumé pour une TPE et pour
 * ce volume ; le jour où l'on passe à plusieurs répliques, cette table doit
 * migrer vers un magasin partagé. Écrit ici pour que ce ne soit pas une
 * surprise.
 */
const FENETRE_MS = 60_000;
const MAX_PAR_FENETRE = 20;
const compteurs = new Map<string, { debut: number; n: number }>();

/**
 * L'adresse du client, telle qu'Express la résout.
 *
 * `req.ip` et NON `req.headers["x-forwarded-for"]` : l'en-tête est fourni par
 * le CLIENT. Le lire directement laissait n'importe qui contourner la limite de
 * débit en le faisant varier, et — plus grave — inscrire l'adresse de son choix
 * dans `devis.accepted_ip`, qui est une preuve d'engagement.
 *
 * `req.ip` respecte le réglage `trust proxy` de l'application : adresse de la
 * socket par défaut, adresse réelle du client quand le déploiement a déclaré
 * son mandataire. La décision revient ainsi à l'exploitant, pas à l'attaquant.
 */
function adresse(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function limiterDebit(req: Request, res: Response, next: NextFunction): void {
  const ip = adresse(req);
  const maintenant = Date.now();
  const courant = compteurs.get(ip);

  if (!courant || maintenant - courant.debut > FENETRE_MS) {
    compteurs.set(ip, { debut: maintenant, n: 1 });
    // Purge opportuniste : sans elle la table croît indéfiniment sur une route
    // publique, ce qui est une fuite de mémoire offerte à qui la sollicite.
    if (compteurs.size > 10_000) {
      for (const [k, v] of compteurs) {
        if (maintenant - v.debut > FENETRE_MS) compteurs.delete(k);
      }
    }
    next();
    return;
  }

  if (courant.n >= MAX_PAR_FENETRE) {
    res.status(429).json({ error: "Trop de tentatives. Réessayez dans une minute." });
    return;
  }
  courant.n++;
  next();
}

// ── Recherche par jeton ──────────────────────────────────────────────────────

/** Le condensat rangé en base. Le jeton, lui, ne quitte pas cette fonction. */
function condensat(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Retrouve un devis à partir de son jeton public, via la policy étroite.
 *
 * `set_config(..., true)` et NON `SET LOCAL "..." = ${token}` : Drizzle envoie
 * l'interpolation comme un paramètre lié, et PostgreSQL n'accepte pas de
 * paramètre dans un `SET` — l'ancienne version échouait sur
 * « syntax error at or near "$1" » et les deux routes rendaient 500.
 *
 * Le troisième argument à `true` est OBLIGATOIRE : la portée doit être la
 * transaction. Même règle que `withTenant` — un réglage hors transaction fuit
 * d'une requête à l'autre à cause du pooling, et ici cela laisserait la ligne
 * d'un client visible pendant la requête d'un autre.
 */
async function lookupByToken(token: string) {
  const sha = condensat(token);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.devis_accept_token_sha256', ${sha}, true)`);
    const [row] = await tx
      .select()
      .from(devisTable)
      .where(eq(devisTable.acceptTokenSha256, sha));
    return row ?? null;
  });
}

/**
 * Le devis est-il périmé ?
 *
 * `validUntil` est une DATE MÉTIER (`YYYY-MM-DD`). L'ancienne comparaison,
 * `new Date(devis.validUntil) < new Date()`, opposait minuit UTC à un instant :
 * un devis valable jusqu'au 10 août expirait à 2 h du matin heure de Paris ce
 * jour-là. « Valable jusqu'au 10 août » veut dire jusqu'à la FIN du 10 août.
 *
 * On compare donc deux chaînes de date métier, ce qui couvre le jour entier et
 * ne dépend d'aucun fuseau.
 */
function estPerime(validUntil: string | null): boolean {
  if (!validUntil) return false;
  return validUntil < toDateString(new Date());
}

/**
 * Qui parle au client — nom de l'entreprise et SIRET.
 *
 * La page disait « transmis à votre prestataire » et ne nommait PERSONNE. Le
 * client reçoit un e-mail, clique, et arrive sur une page qui ne dit pas qui
 * s'adresse à lui : c'est la première chose qu'il cherche avant de s'engager,
 * et c'est ce qui distingue cette page d'une tentative d'hameçonnage.
 *
 * Lu par `withTenant` une fois la ligne — donc le tenant — identifiée par le
 * jeton. La route publique ne voit jamais un autre tenant.
 */
async function emetteur(tenantId: string): Promise<{ nom: string | null; siret: string | null }> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select({ key: settingsTable.key, value: settingsTable.value }).from(settingsTable),
  );
  const parCle = new Map(rows.map((r) => [r.key, r.value]));
  const lire = (cle: string): string | null => {
    const v = parCle.get(cle);
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  };
  return { nom: lire("company.nom"), siret: lire("company.siret") };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Public : métadonnées de la page d'acceptation (sans authentification). */
router.get("/public/devis/:token/accept-page", limiterDebit, async (req, res): Promise<void> => {
  const { token } = req.params;
  // Le typage d'Express admet `string[]` ; on refuse tout ce qui n'est pas une
  // chaîne, avec la MÊME réponse que pour un jeton inconnu.
  if (typeof token !== "string" || token.length === 0) {
    res.status(404).json(INTROUVABLE);
    return;
  }

  const devis = await lookupByToken(token);

  if (!devis) {
    res.status(404).json(INTROUVABLE);
    return;
  }

  const entreprise = await emetteur(devis.tenantId);

  if (devis.acceptedAt) {
    res.json({
      alreadyAccepted: true,
      acceptedAt: devis.acceptedAt,
      acceptedBy: devis.acceptedBy,
      reference: devis.reference,
      clientName: devis.clientName,
      entreprise,
      // Le document reste téléchargeable APRÈS acceptation : c'est là que le
      // client veut le garder.
      pdfUrl: `/api/public/devis/${token}/pdf`,
    });
    return;
  }

  if (estPerime(devis.validUntil)) {
    res.json({
      expired: true,
      validUntil: devis.validUntil,
      reference: devis.reference,
      entreprise,
      pdfUrl: `/api/public/devis/${token}/pdf`,
    });
    return;
  }

  // ── Ce que le client accepte, en entier ──────────────────────────────────
  //
  // La page n'affichait que la référence, le montant TTC et le nom du client.
  // PAS UNE SEULE LIGNE du devis. On demandait un « bon pour accord » sur un
  // nombre dont on ne montrait pas la composition : faible commercialement —
  // un client qui ne peut pas relire ne signe pas — et faible juridiquement,
  // l'accord portant sur un contenu que le signataire n'a pas eu sous les yeux.
  //
  // On ne renvoie QUE ce qui concerne ce devis. Aucune autre donnée du tenant
  // ne traverse cette route publique.
  res.json({
    reference: devis.reference,
    clientName: devis.clientName,
    entreprise,
    lignes: (devis.lines ?? []).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit ?? null,
      unitPriceCents: l.unitPriceCents,
      vatRate: l.vatRate,
      // Calculé ici : le front n'a pas à refaire une arithmétique de prix,
      // et deux calculs du même montant finissent par diverger.
      montantHTCents: Math.round(l.quantity * l.unitPriceCents),
    })),
    totalHTCents: devis.totalHTCents,
    totalTVACents: devis.totalTTCCents - devis.totalHTCents,
    totalTTCCents: devis.totalTTCCents,
    remise: devis.remise,
    autoliquidation: devis.autoliquidation,
    validUntil: devis.validUntil,
    alreadyAccepted: false,
    expired: false,
    /** Chemin du PDF, servi par le même jeton. Jamais l'identifiant du devis. */
    pdfUrl: `/api/public/devis/${token}/pdf`,
  });
});

/** Public : enregistre le « bon pour accord » (sans authentification). */
router.post("/public/devis/:token/accept", limiterDebit, async (req, res): Promise<void> => {
  const { token } = req.params;
  // Le typage d'Express admet `string[]` ; on refuse tout ce qui n'est pas une
  // chaîne, avec la MÊME réponse que pour un jeton inconnu.
  if (typeof token !== "string" || token.length === 0) {
    res.status(404).json(INTROUVABLE);
    return;
  }

  const parsed = AcceptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Étape 1 — recherche par jeton via la policy étroite : aucun contexte de
  // tenant n'est encore connu, et c'est justement ce que la policy permet.
  const devis = await lookupByToken(token);

  if (!devis) {
    res.status(404).json(INTROUVABLE);
    return;
  }
  if (devis.acceptedAt) {
    res.status(409).json({ error: "Ce devis a déjà été accepté.", acceptedAt: devis.acceptedAt });
    return;
  }
  if (estPerime(devis.validUntil)) {
    res.status(410).json({ error: "Ce devis est expiré.", validUntil: devis.validUntil });
    return;
  }

  const ip = adresse(req);

  // Étape 2 — l'écriture repasse par `withTenant`, donc sous isolation
  // complète.
  //
  // La condition `acceptedAt IS NULL` empêche une requête concurrente
  // d'écraser l'horodatage du premier signataire : les deux passent le
  // pré-contrôle ci-dessus, mais une seule trouve une ligne non acceptée dans
  // l'UPDATE. C'est une preuve d'engagement — le nom et l'heure du premier ne
  // se réécrivent pas.
  const [updated] = await withTenant(devis.tenantId, (tx) =>
    tx
      .update(devisTable)
      .set({
        status: "ACCEPTE",
        acceptedAt: new Date(),
        acceptedBy: parsed.data.signataire,
        acceptedIp: ip,
      })
      .where(and(eq(devisTable.acceptTokenSha256, condensat(token)), isNull(devisTable.acceptedAt)))
      .returning(),
  );

  if (!updated) {
    res.status(409).json({
      error: "Ce devis vient d'être accepté par une autre session simultanée.",
      reference: devis.reference,
    });
    return;
  }

  res.json({
    accepted: true,
    acceptedAt: updated.acceptedAt,
    acceptedBy: updated.acceptedBy,
    reference: devis.reference,
  });
});

/**
 * GET /public/devis/:token/pdf — le PDF, servi par le JETON.
 *
 * Pas par une session : le client de l'artisan n'en a aucune. Mêmes règles que
 * le reste de cette page — la policy étroite ne laisse voir que CE devis, et
 * un jeton inconnu rend la même réponse qu'un devis inexistant.
 *
 * SERVI MÊME APRÈS ACCEPTATION, et c'est délibéré : c'est précisément à ce
 * moment-là que le client veut garder son document. Le lui retirer une fois
 * qu'il a signé serait le priver de la seule trace de ce qu'il a accepté.
 *
 * Un devis PÉRIMÉ reste téléchargeable lui aussi : il ne peut plus être
 * accepté, mais le client a le droit de relire ce qu'on lui avait proposé.
 */
router.get("/public/devis/:token/pdf", limiterDebit, async (req, res): Promise<void> => {
  const { token } = req.params;
  if (typeof token !== "string" || token.length === 0) {
    res.status(404).json(INTROUVABLE);
    return;
  }

  const devis = await lookupByToken(token);
  if (!devis) { res.status(404).json(INTROUVABLE); return; }

  const emetteur = await chargerEmetteur(devis.tenantId);
  const pdf = await genererPdfDevis(devis, emetteur);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nomFichierDevis(devis.reference)}"`,
  );
  res.send(pdf);
});

export default router;
