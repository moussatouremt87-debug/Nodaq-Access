/**
 * Facturation électronique (US-A2.6) — paramétrage PA, capture manuelle des
 * documents reçus, et webhook entrant.
 *
 * PAS d'intégration API réelle contre une plateforme agréée ici : aucune
 * n'est choisie/contractée à ce jour (voir lib/plateforme-agreee). Cette
 * route couvre ce qui est livrable sans elle — la capture manuelle satisfait
 * honnêtement « sans ressaisie manuelle » côté DONNÉE (extraction
 * automatique via parseCiiEssentials), même si l'ARRIVÉE du fichier reste
 * manuelle tant qu'aucun flux API n'existe. Le webhook entrant est une
 * ébauche : authentification et résolution de tenant sont couvertes par les
 * tests, mais rien ne peut être éprouvé bout en bout sans PA réelle.
 */
import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { toDateString } from "@nodaq/shared";
import { eq, desc } from "drizzle-orm";
import {
  withTenant,
  paDocumentsRecusTable,
  settingsTable,
  CLE_PA_API_KEY,
  CLE_PA_WEBHOOK_SECRET,
} from "@workspace/db";
import { enregistrerSecret, secretExiste, revoquerSecret, lireSecret } from "../lib/tenant-secrets.js";
import { extractFacturXXml, parseCiiEssentials } from "@nodaq/facturx";

const router: IRouter = Router();

// ── Paramétrage ──────────────────────────────────────────────────────────────

router.get("/facturation-electronique", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const [paConfiguree, webhookConfigure] = await Promise.all([
    secretExiste(tenantId, CLE_PA_API_KEY),
    secretExiste(tenantId, CLE_PA_WEBHOOK_SECRET),
  ]);
  res.json({ paConfiguree, webhookConfigure });
});

/**
 * GET /facturation-electronique/conformite — ce que la bannière doit dire.
 *
 * ── Pourquoi « confirmé » et non « configuré » ────────────────────────────
 * `paConfiguree` dit qu'une clé d'API existe. Ça ne prouve RIEN sur le
 * raccordement : c'est la plateforme qui sait si l'adresse de réception du
 * tenant existe dans l'annuaire. Afficher « vous êtes prêt » sur la foi d'une
 * clé saisie serait la pire des issues — le dirigeant cesserait de s'en
 * occuper en croyant l'affaire réglée.
 *
 * Tant que la confirmation n'est pas remontée par la plateforme (ticket 4.37),
 * ce champ reste faux, et la bannière dit la vérité.
 */
router.get("/facturation-electronique/conformite", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const reglages = await withTenant(tenantId, (tx) =>
    tx.select().from(settingsTable).where(
      inArray(settingsTable.key, [CLE_LISTE_ATTENTE, CLE_BANNIERE_FERMEE]),
    ),
  );
  const valeur = (cle: string): string | null =>
    reglages.find((r) => r.key === cle)?.value ?? null;

  res.json({
    situation: {
      // Le raccordement confirmé viendra du 4.37 : aucune plateforme n'est
      // encore branchée, donc personne n'est « prêt », et le dire est plus
      // honnête que de le laisser croire.
      raccordementConfirme: false,
      inscritListeAttenteLe: valeur(CLE_LISTE_ATTENTE),
    },
    bannièreFermeeLe: valeur(CLE_BANNIERE_FERMEE),
  });
});

/** Clés de réglage — le magasin clé-valeur existant, pas une table de plus. */
const CLE_LISTE_ATTENTE = "conformite.listeAttenteLe";
const CLE_BANNIERE_FERMEE = "conformite.banniereFermeeLe";

/**
 * POST /facturation-electronique/liste-attente — « prévenez-moi ».
 *
 * Le ticket l'exige : tant que le raccordement réel n'existe pas, le bouton
 * inscrit sur une liste datée. « Honnêteté avant tout, pas de bouton qui ne
 * fait rien » — un bouton décoratif se remarque, et il coûte plus cher en
 * confiance qu'une fonctionnalité absente.
 */
router.post("/facturation-electronique/liste-attente", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const aujourdhui = toDateString(new Date());
  await withTenant(tenantId, (tx) =>
    tx.insert(settingsTable)
      .values({ tenantId, key: CLE_LISTE_ATTENTE, value: aujourdhui })
      // Une seconde inscription ne réécrit pas la première : la date d'origine
      // est ce qui donnera l'ordre de passage.
      .onConflictDoNothing(),
  );
  res.status(201).json({ inscritLe: aujourdhui });
});

/** POST …/banniere-fermee — « pas maintenant », jamais « plus jamais ». */
router.post("/facturation-electronique/banniere-fermee", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const aujourdhui = toDateString(new Date());
  await withTenant(tenantId, async (tx) => {
    await tx.insert(settingsTable)
      .values({ tenantId, key: CLE_BANNIERE_FERMEE, value: aujourdhui })
      .onConflictDoUpdate({
        target: [settingsTable.tenantId, settingsTable.key],
        set: { value: aujourdhui },
      });
  });
  res.status(204).end();
});

const ParametresBody = z.object({
  // undefined = ne pas toucher, null = révoquer, string = remplacer — même
  // doctrine que smtpMotDePasse dans parametres-envoi.ts. La clé ne revient
  // jamais dans une lecture : voir GET ci-dessus, qui ne rend qu'un booléen.
  cleApi: z.string().min(1).max(2000).nullable().optional(),
});

router.put("/facturation-electronique", async (req, res): Promise<void> => {
  const parsed = ParametresBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const { cleApi } = parsed.data;

  if (cleApi === null) {
    await revoquerSecret(tenantId, CLE_PA_API_KEY);
  } else if (typeof cleApi === "string") {
    await enregistrerSecret(tenantId, CLE_PA_API_KEY, cleApi);
  }

  res.json({ paConfiguree: await secretExiste(tenantId, CLE_PA_API_KEY) });
});

/**
 * Génère (ou remplace) le secret de webhook du tenant. Rendu UNE SEULE fois,
 * à la génération — jamais relu ensuite, même doctrine que tout secret de ce
 * magasin. Un tenant qui le perd doit en générer un nouveau.
 */
router.post("/facturation-electronique/webhook-secret", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const secret = crypto.randomBytes(32).toString("hex");
  await enregistrerSecret(tenantId, CLE_PA_WEBHOOK_SECRET, secret);
  res.json({ secret, webhookPath: `/api/webhooks/plateforme-agreee/${tenantId}` });
});

// ── Documents reçus — liste et lecture ────────────────────────────────────────

router.get("/facturation-electronique/documents", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const documents = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: paDocumentsRecusTable.id,
        source: paDocumentsRecusTable.source,
        fournisseurSiren: paDocumentsRecusTable.fournisseurSiren,
        montantTtcCents: paDocumentsRecusTable.montantTtcCents,
        dateFacture: paDocumentsRecusTable.dateFacture,
        byteSize: paDocumentsRecusTable.byteSize,
        receivedAt: paDocumentsRecusTable.receivedAt,
      })
      .from(paDocumentsRecusTable)
      .orderBy(desc(paDocumentsRecusTable.receivedAt))
      .limit(200),
  );
  res.json({ documents, total: documents.length });
});

// Route de téléchargement volontairement absente d'openapi.yaml — réponse
// binaire, même doctrine que /factures/:id/pdf.
router.get("/facturation-electronique/documents/:id/pdf", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [doc] = await withTenant(tenantId, (tx) =>
    tx.select().from(paDocumentsRecusTable).where(eq(paDocumentsRecusTable.id, id!)),
  );
  if (!doc) { res.status(404).json({ error: "Document introuvable" }); return; }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${doc.id}.pdf"`);
  res.setHeader("X-Pdf-Sha256", doc.sha256);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(doc.bytes);
});

// ── Capture manuelle ───────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      const err = new Error(
        `Type de fichier non supporté : ${file.mimetype}. Un Factur-X est un PDF.`,
      ) as NodeJS.ErrnoException;
      err.code = "LIMIT_UNEXPECTED_FILE_TYPE";
      cb(err);
    }
  },
});

const uploadUnique: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Fichier invalide.";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
};

/**
 * Dépose manuellement un Factur-X reçu (par exemple exporté depuis le
 * portail d'une plateforme agréée, ou transmis par un fournisseur avant
 * qu'un flux automatisé n'existe). Extraction automatique du SIREN
 * émetteur, du montant et de la date — c'est ce qui satisfait « sans
 * ressaisie manuelle » côté donnée, même en capture manuelle.
 */
router.post("/facturation-electronique/documents", uploadUnique, async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "Aucun fichier fourni." }); return; }
  const tenantId = req.tenantId!;
  const bytes = req.file.buffer;

  // extractFacturXXml lève si les octets ne sont même pas un PDF lisible
  // (pdf-lib) — un fichier corrompu ou mal formé est une erreur de
  // VALIDATION du dépôt, pas un incident serveur : traitée ici, pas
  // remontée en 500.
  let xml: string | null;
  try {
    xml = await extractFacturXXml(bytes);
  } catch {
    xml = null;
  }
  if (!xml) {
    res.status(422).json({
      error: "Ce PDF ne contient pas de pièce jointe Factur-X — ce n'est pas une facture électronique.",
    });
    return;
  }

  const essentials = parseCiiEssentials(xml);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  const [doc] = await withTenant(tenantId, (tx) =>
    tx
      .insert(paDocumentsRecusTable)
      .values({
        tenantId,
        bytes,
        sha256,
        byteSize: bytes.length,
        source: "manuel",
        fournisseurSiren: essentials.sellerSiren,
        montantTtcCents: essentials.grandTotalCents,
        dateFacture: essentials.issueDate,
      })
      .returning({
        id: paDocumentsRecusTable.id,
        fournisseurSiren: paDocumentsRecusTable.fournisseurSiren,
        montantTtcCents: paDocumentsRecusTable.montantTtcCents,
        dateFacture: paDocumentsRecusTable.dateFacture,
        receivedAt: paDocumentsRecusTable.receivedAt,
      }),
  );

  res.status(201).json(doc);
});

export default router;

// ── Webhook entrant (public — pas de session) ─────────────────────────────────

/**
 * POST /webhooks/plateforme-agreee/:tenantId
 *
 * Ébauche : le tenant vient du segment d'URL, l'authentification vient d'une
 * signature HMAC-SHA256 du corps brut, calculée avec le secret de CE tenant
 * (`CLE_PA_WEBHOOK_SECRET`, généré via POST /facturation-electronique/webhook-secret).
 * Connaître un tenantId (UUID non devinable en pratique) ne suffit pas : sans
 * la signature correcte, la requête est rejetée avant toute écriture.
 *
 * NON TESTABLE BOUT EN BOUT sans plateforme agréée réelle — voir le plan
 * US-A2.6. L'authentification et la résolution de tenant sont couvertes par
 * les tests unitaires de ce fichier.
 */
export const facturationElectroniqueWebhookRouter: IRouter = Router();

const WebhookParams = z.object({ tenantId: z.string().uuid() });

facturationElectroniqueWebhookRouter.post(
  "/webhooks/plateforme-agreee/:tenantId",
  async (req, res): Promise<void> => {
    const parsedParams = WebhookParams.safeParse(req.params);
    if (!parsedParams.success) { res.status(404).json({ error: "Introuvable." }); return; }
    const { tenantId } = parsedParams.data;

    const secret = await lireSecret(tenantId, CLE_PA_WEBHOOK_SECRET);
    // Réponse IDENTIQUE, tenant absent ou secret non configuré — aucun oracle
    // ne doit permettre de distinguer « ce tenant n'existe pas » de « ce
    // tenant n'a pas activé la réception automatisée ».
    if (!secret) { res.status(401).json({ error: "Non autorisé." }); return; }

    const signatureHeader = req.header("X-Pa-Signature");
    if (!signatureHeader || !req.rawBody) { res.status(401).json({ error: "Non autorisé." }); return; }

    const attendu = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const recu = signatureHeader.replace(/^sha256=/, "");
    const signatureValide =
      recu.length === attendu.length &&
      crypto.timingSafeEqual(Buffer.from(recu, "hex"), Buffer.from(attendu, "hex"));
    if (!signatureValide) { res.status(401).json({ error: "Non autorisé." }); return; }

    // Corps attendu, une fois un contrat PA réel connu : au minimum les
    // octets du PDF Factur-X. Forme PROVISOIRE — voir lib/plateforme-agreee.
    const Body = z.object({ pdfBase64: z.string().min(1) });
    const parsedBody = Body.safeParse(req.body);
    if (!parsedBody.success) { res.status(400).json({ error: "Corps invalide." }); return; }

    const bytes = Buffer.from(parsedBody.data.pdfBase64, "base64");
    let xml: string | null;
    try {
      xml = await extractFacturXXml(bytes);
    } catch {
      xml = null;
    }
    const essentials = xml ? parseCiiEssentials(xml) : { sellerSiren: null, grandTotalCents: null, issueDate: null };
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    await withTenant(tenantId, (tx) =>
      tx.insert(paDocumentsRecusTable).values({
        tenantId,
        bytes,
        sha256,
        byteSize: bytes.length,
        source: "api",
        fournisseurSiren: essentials.sellerSiren,
        montantTtcCents: essentials.grandTotalCents,
        dateFacture: essentials.issueDate,
      }),
    );

    res.status(201).json({ received: true });
  },
);
