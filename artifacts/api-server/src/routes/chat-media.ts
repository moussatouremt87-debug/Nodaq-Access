/**
 * Chat media routes
 *
 *   POST /api/chat/upload     — image → Pixtral analysis → agent → classeur
 *   POST /api/chat/transcribe — audio → Scaleway STT → { text }
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import { withTenant, chatMessagesTable, classeurTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { runAgent } from "../lib/mistralAgent";
import {
  analyzeDocumentImage,
  buildAgentMessageFromDoc,
  docTypeToCategory,
  generateDocumentName,
} from "../lib/pixtralVision";
import { transcribeAudio } from "../lib/scalewaySTT";

const router: IRouter = Router();

// ─── Multer (memory storage, 10 MB limit) ────────────────────────────────────

// Image-only MIME types accepted by /chat/upload.
// Audio types are handled by the separate /chat/transcribe endpoint.
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
]);

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      // Reject non-image MIME types (including audio/*) with a typed error
      const err = new Error(
        `Type de fichier non supporté : ${file.mimetype}. Seules les images sont acceptées (JPEG, PNG, WEBP, …).`,
      ) as NodeJS.ErrnoException;
      err.code = "LIMIT_UNEXPECTED_FILE_TYPE";
      cb(err);
    }
  },
});

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    cb(null, file.mimetype.startsWith("audio/"));
  },
});

// ─── POST /api/chat/upload ───────────────────────────────────────────────────

router.post(
  "/chat/upload",
  uploadImage.single("image"),
  async (req, res): Promise<void> => {
    // Validate request first (400) before checking LLM config (503)
    if (!req.file) {
      res.status(400).json({ error: "Aucun fichier image reçu (champ 'image' attendu)." });
      return;
    }

    if (!process.env.MISTRAL_API_KEY) {
      res.status(503).json({
        error: "Agent non configuré",
        detail: "MISTRAL_API_KEY manquante.",
      });
      return;
    }

    const tenantId = req.tenantId!;
    const convIdRaw: string | undefined =
      typeof req.body["conversationId"] === "string"
        ? req.body["conversationId"]
        : undefined;
    const caption: string | undefined =
      typeof req.body["text"] === "string" ? req.body["text"] : undefined;

    const convId = convIdRaw ?? crypto.randomUUID();

    // 1. Analyse image with Pixtral ──────────────────────────────────────────
    let docInfo: Awaited<ReturnType<typeof analyzeDocumentImage>>;
    try {
      docInfo = await analyzeDocumentImage(req.file.buffer, req.file.mimetype);
    } catch (err) {
      req.log?.error({ err }, "pixtral analysis error");
      res.status(502).json({ error: "Échec de l'analyse d'image.", detail: String(err) });
      return;
    }

    // 2. Archive in classeur (metadata only, not the binary) ─────────────────
    const docName = generateDocumentName(docInfo, req.file.originalname ?? "photo.jpg");
    await withTenant(tenantId, async (tx) => {
      await tx.insert(classeurTable).values({
        tenantId,
        name: docName,
        category: docTypeToCategory(docInfo.documentType),
        size: req.file!.size,
        mimeType: req.file!.mimetype,
        notes: `Archivé automatiquement via capture photo.\n${docInfo.summary}\nTexte extrait : ${docInfo.extractedText.slice(0, 500)}`,
      });
    });

    // 3. Build response — SECURITY: document-derived content NEVER persisted to chat history
    //
    // The document-derived user message (including all OCR-extracted fields) is
    // kept EPHEMERAL and used only within this request.  It is deliberately NOT
    // written to chatMessagesTable, so subsequent /chat/messages calls load a
    // clean history that contains no attacker-controlled document content.
    //
    // Without document data in history, a follow-up chat call cannot be
    // injection-prompted by fields embedded in a photographed document,
    // regardless of model compliance.
    //
    // Two-phase trust model:
    //   a) No caption  → static description generated from Zod-validated fields.
    //      No agent call.  Only the assistant's description is persisted.
    //   b) With caption → only the user's literal caption is persisted (not doc
    //      data).  Agent is called with an ephemeral context (caption + doc
    //      data) and a READ-ONLY server-enforced tool allow-list.
    //      The authorization gate in runAgent() additionally rejects any tool
    //      call not in the allow-list, even if forged by the model.
    //      Only the assistant's response is persisted.
    //
    // The image binary is not stored (metadata-only archival in this version).
    // Binary storage will be implemented in the follow-up classeur task.

    let assistantContent: string;
    let agentActions: import("../lib/mistralAgent").AgentAction[] = [];

    if (!caption?.trim()) {
      // ── Phase A: no user intent → static description, no agent call ──────
      //
      // SECURITY: the assistant message stored in history must contain ZERO
      // attacker-controlled text (Pixtral summary, entity names, OCR output).
      // Only the document type (Zod enum with .catch()) and a count of non-null
      // typed fields are embedded.  Full detail (entities, summary) is returned
      // in the route response body for UI display but is never persisted to
      // chatMessagesTable.  This ensures history loaded by subsequent
      // /chat/messages calls cannot be injection-prompted by document content.
      const { entities: e, documentType } = docInfo;
      const fieldCount = [
        e.name, e.company, e.phone, e.email,
        e.amount != null ? String(e.amount) : null,
        e.date, e.address, e.description,
      ].filter(Boolean).length;

      assistantContent =
        `📄 Document archivé dans le Classeur` +
        ` (type : ${documentType},` +
        ` ${fieldCount} champ${fieldCount !== 1 ? "s" : ""} extrait${fieldCount !== 1 ? "s" : ""}).\n\n` +
        `Que souhaitez-vous faire avec ce document ?`;
    } else {
      // ── Phase B: explicit user caption → restricted ephemeral agent call ──
      //
      // READ-ONLY tool allow-list — verified against TOOLS definitions.
      // list_affaires, list_prospects, get_affaire_detail are the only read
      // tools available.  All mutation tools are excluded.
      const DOCUMENT_TOOL_ALLOW_LIST = [
        "list_affaires",
        "list_prospects",
        "get_affaire_detail",
      ];

      // Persist ONLY the user's explicit caption (not document data).
      // This is the only message that enters the permanent history.
      await withTenant(tenantId, async (tx) => {
        await tx.insert(chatMessagesTable).values({
          tenantId,
          conversationId: convId,
          role: "user",
          content: caption.trim(),
        });
      });

      // Build an ephemeral context for the agent (document data + caption).
      // This context is passed to runAgent but NOT stored in the DB.
      const ephemeralUserContent = buildAgentMessageFromDoc(docInfo, caption);
      const ephemeralHistory = [{ role: "user", content: ephemeralUserContent }];

      let agentResult: Awaited<ReturnType<typeof runAgent>>;
      try {
        agentResult = await runAgent(tenantId, ephemeralHistory, {
          toolAllowList: DOCUMENT_TOOL_ALLOW_LIST,
        });
      } catch (err) {
        req.log?.error({ err }, "agent error after image upload");
        res.status(502).json({ error: "L'agent IA a rencontré une erreur.", detail: String(err) });
        return;
      }
      // Agent answer is returned in the response body for UI display ONLY.
      // It is NOT persisted to chatMessagesTable — the agent may have echoed
      // attacker-controlled document content, and persisting it would re-open
      // the history-injection path that no-caption uploads already close.
      assistantContent = agentResult.content;
      agentActions = agentResult.actions;
    }

    // 4. Persist a GENERIC assistant record — never any document-derived text.
    //
    // For the captioned path, `assistantContent` (the agent's reply) is
    // returned in the response body for display but a generic placeholder is
    // persisted instead.  This keeps chatMessagesTable free of any text that
    // originates from Pixtral output, even text that has been echoed back by
    // the agent.  History loaded by subsequent /chat/messages calls is therefore
    // guaranteed to contain no attacker-controlled document content.
    const genericRecord =
      `📄 Document archivé dans le Classeur` +
      ` (type : ${docInfo.documentType},` +
      ` ${(() => {
          const e = docInfo.entities;
          return [e.name, e.company, e.phone, e.email,
                  e.amount != null ? String(e.amount) : null,
                  e.date, e.address, e.description].filter(Boolean).length;
        })()
      } champ${(() => {
          const e = docInfo.entities;
          const n = [e.name, e.company, e.phone, e.email,
                     e.amount != null ? String(e.amount) : null,
                     e.date, e.address, e.description].filter(Boolean).length;
          return n !== 1 ? "s extraits" : " extrait";
        })()}).`;

    const assistantMessage = await withTenant(tenantId, async (tx) => {
      const [msg] = await tx
        .insert(chatMessagesTable)
        .values({
          tenantId,
          conversationId: convId,
          role: "assistant",
          content: genericRecord,
        })
        .returning();
      return msg;
    });

    res.status(201).json({
      conversationId: convId,
      // Return the ephemeral agent answer or static description for display.
      // The persisted record (genericRecord) is intentionally NOT used here —
      // the UI shows the richer response, history stores only the safe record.
      message: { ...assistantMessage, content: assistantContent },
      actions_performed: agentActions,
      // Image binary is NOT stored in this version (metadata-only archival).
      // Full binary storage with object-storage is tracked in the follow-up
      // classeur task.
      binaryDiscarded: true,
      document: {
        name: docName,
        documentType: docInfo.documentType,
        summary: docInfo.summary,
      },
    });
  },
);

// ─── POST /api/chat/transcribe ───────────────────────────────────────────────

router.post(
  "/chat/transcribe",
  uploadAudio.single("audio"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Aucun fichier audio reçu (champ 'audio' attendu)." });
      return;
    }

    if (!process.env.SCALEWAY_API_KEY) {
      res.status(503).json({
        error: "Transcription non configurée",
        detail: "SCALEWAY_API_KEY manquante.",
      });
      return;
    }

    try {
      const result = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname ?? "audio.webm",
      );
      res.json({ text: result.text });
    } catch (err) {
      req.log?.error({ err }, "scaleway STT error");
      res.status(502).json({
        error: "La transcription audio a échoué.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
