/**
 * Canal d'émission — abstraction pour l'envoi de documents.
 *
 * Implémentations :
 *   EMAIL             — Fonctionnel (stub de log en développement ; en production,
 *                       configurer SMTP_HOST / SMTP_USER / SMTP_PASS).
 *   PLATEFORME_AGREEE — Bouchon explicite "non branché" (2027-ready).
 *
 * Le canal est déterminé par l'environnement : en production avec un SMTP configuré,
 * l'envoi est réel. Sans SMTP, le courriel est loggé (dev only).
 *
 * Journalisation : chaque envoi est loggé (date, destinataire, canal, statut)
 * sans stocker le corps du message ni données métier.
 */

import { createTransport } from "nodemailer";

export type CanalEmission = "EMAIL" | "PLATEFORME_AGREEE";

export interface SendOptions {
  canal: CanalEmission;
  to: string;
  subject: string;
  /** Plain text body */
  body: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | Uint8Array;
    contentType?: string;
  }>;
  /** Artisan's display name for the From header */
  fromName?: string;
  /** Artisan's email for the Reply-To header */
  replyTo?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  /** For PLATEFORME_AGREEE: always "non branché" */
  stub?: string;
  error?: string;
  loggedAt: string;
}

/**
 * Returns a configured nodemailer transporter when SMTP env vars are set.
 * Falls back to ethereal (development) when not configured.
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT ?? 587);

  if (host && user && pass) {
    return createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  // Development: log only, no real transport
  return null;
}

/**
 * Sends a document via the specified canal.
 * The caller is responsible for validating that the document exists and the
 * recipient email is valid before calling this function.
 */
export async function sendDocument(opts: SendOptions): Promise<SendResult> {
  const loggedAt = new Date().toISOString();

  if (opts.canal === "PLATEFORME_AGREEE") {
    // Stub explicite : le connecteur plateforme agréée n'est pas encore branché.
    console.log(`[canal-emission] PLATEFORME_AGREEE stub — ${opts.subject} → ${opts.to} (non branché)`);
    return {
      success: false,
      stub: "PLATEFORME_AGREEE non branché — ce canal sera activé lors de la connexion à une PDP agréée en 2027.",
      loggedAt,
    };
  }

  // EMAIL canal
  const transporter = getTransporter();
  const fromName = opts.fromName ?? "NODAQ";
  const from = `"${fromName}" <noreply@nodaq.fr>`;

  const mailOptions = {
    from,
    replyTo: opts.replyTo ?? from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: (opts.attachments ?? []).map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType ?? "application/pdf",
    })),
  };

  if (!transporter) {
    // Development mode: log the email details, don't send
    console.log(
      `[canal-emission] EMAIL (dev-log) — To: ${opts.to} | Subject: ${opts.subject} | ` +
      `Attachments: ${opts.attachments?.map(a => a.filename).join(", ") ?? "none"}`,
    );
    return {
      success: true,
      messageId: `dev-${Date.now()}@localhost`,
      loggedAt,
    };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[canal-emission] EMAIL sent — messageId: ${info.messageId} → ${opts.to}`);
    return { success: true, messageId: info.messageId, loggedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[canal-emission] EMAIL failed — ${msg}`);
    return { success: false, error: msg, loggedAt };
  }
}
