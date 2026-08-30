import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import { perimetreSanteClasseur } from "../middleware/perimetreSante.js";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { withTenant, classeurTable, classeurDocumentBytesTable, archivedPdfsTable } from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { ListClasseurQueryParams, DeleteClasseurDocumentParams } from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Multer (memory storage, 20 MB limit) ────────────────────────────────────
//
// Un classeur d'artisan contient surtout des PDF et des photos de documents
// (factures, contrats, devis papier scannés) — la liste blanche reflète ça,
// pas un usage de stockage de fichiers générique.
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "image/heic", "image/heif", "image/avif", "image/bmp", "image/tiff",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error(
        `Type de fichier non supporté : ${file.mimetype}. PDF et images uniquement.`,
      ) as NodeJS.ErrnoException;
      err.code = "LIMIT_UNEXPECTED_FILE_TYPE";
      cb(err);
    }
  },
});

// multer relaye une erreur de fileFilter/limite via next(err), qui tombe sur
// le gestionnaire d'erreurs générique de l'app (500) — pas un simple 400. Le
// type de fichier refusé est une erreur de VALIDATION, pas un incident
// serveur : elle est traitée explicitement ici plutôt que de remonter.
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

// multipart/form-data : tous les champs non-fichier arrivent en chaînes —
// pas de schéma généré par openapi.yaml pour ce corps, même doctrine que
// /chat/upload (voir chat-media.ts).
const UploadFields = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.enum(["FACTURES", "CONTRATS", "DEVIS", "DIVERS"]).catch("DIVERS"),
  notes: z.string().optional(),
  affaireId: z.string().optional(),
});

// Route de téléchargement volontairement absente d'openapi.yaml — réponse
// binaire, pas JSON, même doctrine que les routes /pdf existantes
// (factures.ts, avoirs.ts, devis.ts) : appel direct via fetch/lien, jamais
// via le client généré.
const DocumentIdParams = z.object({ id: z.string() });

router.get("/classeur", async (req, res): Promise<void> => {
  const parsed = ListClasseurQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { category, search } = parsed.data;
  const tenantId = req.tenantId!;

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(classeurTable).orderBy(desc(classeurTable.createdAt))
  );
  if (category) all = all.filter(d => d.category === category);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(d => d.name.toLowerCase().includes(q));
  }

  // hasContent : quels documents ont réellement des octets à télécharger,
  // sans jamais charger les octets eux-mêmes dans cette réponse de liste
  // (voir 029_classeur_document_bytes.sql).
  const ids = all.map(d => d.id);
  const withBytes = ids.length === 0 ? [] : await withTenant(tenantId, async (tx) =>
    tx.select({ documentId: classeurDocumentBytesTable.documentId })
      .from(classeurDocumentBytesTable)
      .where(inArray(classeurDocumentBytesTable.documentId, ids))
  );
  const idsWithBytes = new Set(withBytes.map(r => r.documentId));

  /*
   * ── LES PIÈCES MÉTIER SONT ARCHIVÉES AILLEURS ────────────────────────────
   *
   * Les PDF de factures et d'avoirs ne passent pas par `classeur_document_bytes`,
   * qui ne reçoit que les dépôts manuels. La règle 5 les écrit dans
   * `archived_pdfs`, dans la transaction même qui passe le document en EMISE.
   *
   * Sans ce second regard, la liste annonçait `hasContent: false` sur des
   * documents parfaitement téléchargeables — et l'écran grisait le bouton.
   */
  const sources = all
    .filter(d => d.sourceType && d.sourceId)
    .map(d => ({ id: d.id, sourceType: d.sourceType as string, sourceId: d.sourceId as string }));
  const idsArchives = new Set<string>();
  if (sources.length > 0) {
    const archives = await withTenant(tenantId, async (tx) =>
      tx.select({
          documentType: archivedPdfsTable.documentType,
          documentId: archivedPdfsTable.documentId,
        })
        .from(archivedPdfsTable)
        .where(inArray(archivedPdfsTable.documentId, sources.map(s => s.sourceId)))
    );
    const cles = new Set(archives.map(a => `${a.documentType}:${a.documentId}`));
    for (const s of sources) {
      if (cles.has(`${s.sourceType}:${s.sourceId}`)) idsArchives.add(s.id);
    }
  }
  const documents = all.map(d => ({ ...d, hasContent: idsWithBytes.has(d.id) || idsArchives.has(d.id) }));

  res.json({ documents, total: documents.length });
});

// US-B9.4 — l'ordre est essentiel : `uploadUnique` (multer) analyse le corps
// multipart, et c'est seulement APRÈS que `affaireId` devient lisible. La
// garde placée avant aurait inspecté un objet vide et tout laissé passer.
router.post("/classeur", uploadUnique, perimetreSanteClasseur, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Aucun fichier reçu (champ 'file' attendu)." });
    return;
  }
  const parsed = UploadFields.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const tenantId = req.tenantId!;

  const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

  const doc = await withTenant(tenantId, async (tx) => {
    const [doc] = await tx.insert(classeurTable).values({
      tenantId,
      name: data.name ?? req.file!.originalname ?? "document",
      category: data.category,
      size: req.file!.size,
      mimeType: req.file!.mimetype,
      notes: data.notes ?? null,
      affaireId: data.affaireId ?? null,
    }).returning();
    await tx.insert(classeurDocumentBytesTable).values({
      tenantId,
      documentId: doc!.id,
      bytes: req.file!.buffer,
      sha256,
      byteSize: req.file!.size,
    });
    return doc!;
  });

  res.status(201).json({ ...doc, hasContent: true });
});

router.get("/classeur/:id/telechargement", async (req, res): Promise<void> => {
  const parsed = DocumentIdParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const result = await withTenant(tenantId, async (tx) => {
    const [doc] = await tx.select().from(classeurTable).where(eq(classeurTable.id, parsed.data.id));
    if (!doc) return null;
    const [content] = await tx.select().from(classeurDocumentBytesTable)
      .where(eq(classeurDocumentBytesTable.documentId, parsed.data.id));
    if (content) return { doc, bytes: content.bytes, mime: doc.mimeType };

    // Repli sur l'archive immuable : c'est là que vivent les PDF de factures
    // et d'avoirs (règle 5). Le Classeur les indexe par `sourceType`/`sourceId`.
    if (doc.sourceType && doc.sourceId) {
      const [archive] = await tx.select().from(archivedPdfsTable).where(
        and(
          eq(archivedPdfsTable.documentType, doc.sourceType),
          eq(archivedPdfsTable.documentId, doc.sourceId),
        ),
      );
      if (archive) return { doc, bytes: archive.bytes, mime: "application/pdf" };
    }
    return { doc, bytes: null, mime: null };
  });

  if (!result) { res.status(404).json({ error: "Document introuvable" }); return; }
  if (!result.bytes) {
    // Le message accusait « un import antérieur à la mise en place du stockage »
    // pour des factures créées le jour même. Il disait la mauvaise cause, ce qui
    // est pire que de n'en dire aucune.
    res.status(404).json({
      error: "Aucun fichier n'est rattaché à ce document — seule sa fiche existe.",
    });
    return;
  }

  // `res.attachment()` DÉDUIT le type MIME de l'extension du nom et écrase
  // l'en-tête posé avant lui : « Facture de test », sans extension, repassait
  // en application/octet-stream. On le pose donc APRÈS.
  res.attachment(result.doc.name);
  res.setHeader("Content-Type", result.mime ?? result.doc.mimeType ?? "application/octet-stream");
  res.send(result.bytes);
});

router.delete("/classeur/:id", async (req, res): Promise<void> => {
  const parsed = DeleteClasseurDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const [existing] = await withTenant(tenantId, async (tx) =>
    tx.select().from(classeurTable).where(eq(classeurTable.id, parsed.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await withTenant(tenantId, async (tx) => {
    await tx.delete(classeurDocumentBytesTable).where(eq(classeurDocumentBytesTable.documentId, parsed.data.id));
    await tx.delete(classeurTable).where(eq(classeurTable.id, parsed.data.id));
  });
  res.status(204).send();
});

export default router;
