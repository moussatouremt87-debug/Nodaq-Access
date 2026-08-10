/**
 * Canal d'émission — envoi des devis, factures et avoirs.
 *
 * ── Le problème que ce module résout ────────────────────────────────────────
 * Un devis de « Toiture Martin » expédié depuis nodaq.fr n'est pas compris par
 * le destinataire et finit en indésirables : le domaine expéditeur ne
 * correspond ni au nom affiché, ni à ce que le client attend.
 *
 * ── Deux modes ──────────────────────────────────────────────────────────────
 *  'domaine_authentifie' — PRINCIPAL. Le tenant a publié SPF et DKIM sur son
 *      domaine ; le courrier part de SON adresse. Aucun secret n'est stocké :
 *      la signature DKIM est faite par le service d'envoi, la clé privée ne
 *      transite jamais par ce produit.
 *
 *  'repli_nodaq'         — REPLI. Expédition depuis nodaq.fr avec un
 *      « répondre à » pointant sur l'artisan. La délivrabilité est mauvaise et
 *      l'interface le dit — un repli silencieux ferait croire que tout va bien
 *      pendant que les devis tombent en indésirables.
 *
 * Le mode « SMTP de l'artisan » est VOLONTAIREMENT ABSENT : il exigerait de
 * stocker son mot de passe de messagerie et aucun chiffrement au repos n'existe
 * encore. Il fera l'objet d'un lot dédié.
 *
 * ── Journalisation ──────────────────────────────────────────────────────────
 * Destinataire, date, statut, type de document. JAMAIS le corps, JAMAIS le
 * SUJET : le sujet d'un devis porte le nom du client et la référence du
 * chantier, c'est une donnée métier interdite en journal (CLAUDE.md §6).
 */

import { createTransport, type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { withTenant, parametresEnvoiTable, envoisJournalTable } from "@workspace/db";
import type { ModeEnvoi } from "@workspace/db";

export type CanalEmission = "EMAIL" | "PLATEFORME_AGREEE";

export type TypeDocument = "DEVIS" | "FACTURE" | "AVOIR";

export interface SendOptions {
  canal: CanalEmission;
  /** Tenant émetteur — détermine le mode d'envoi et porte le journal. */
  tenantId: string;
  to: string;
  subject: string;
  /** Corps en texte brut. Jamais journalisé. */
  body: string;
  documentType: TypeDocument;
  documentId?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | Uint8Array;
    contentType?: string;
  }>;
  /** Nom affiché, si le paramétrage du tenant n'en fournit pas. */
  fromName?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  stub?: string;
  error?: string;
  loggedAt: string;
  /** Mode réellement employé — l'appelant peut en informer l'utilisateur. */
  mode?: ModeEnvoi;
  /**
   * Vrai quand l'envoi est parti en repli : la délivrabilité sera mauvaise.
   * L'interface DOIT le montrer.
   */
  avertissementDelivrabilite?: boolean;
}

/** Adresse d'expédition du repli — commune, donc en configuration. */
function adresseRepli(): string {
  return process.env["EMAIL_REPLI_FROM"] ?? "noreply@nodaq.fr";
}

/**
 * Transporteur SMTP, ou `null` quand aucun n'est configuré (l'envoi est alors
 * journalisé sans partir).
 *
 * Refus explicite en environnement de test : aucun test ne doit pouvoir
 * atteindre un serveur de messagerie réel, même si la machine porte par
 * accident un SMTP_HOST. Ce n'est pas un test désactivé — c'est une sortie
 * réseau interdite.
 */
function getTransporter(): Transporter | null {
  if (process.env["NODE_ENV"] === "test") return null;

  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const port = Number(process.env["SMTP_PORT"] ?? 587);

  if (host && user && pass) {
    return createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  }
  return null;
}

interface ExpediteurResolu {
  mode: ModeEnvoi;
  from: string;
  replyTo: string | undefined;
  avertissement: boolean;
}

/**
 * Choisit l'expéditeur selon le paramétrage du tenant.
 *
 * Un domaine déclaré mais NON VÉRIFIÉ retombe en repli. Expédier depuis un
 * domaine dont SPF et DKIM ne sont pas publiés est pire que le repli : le
 * message est rejeté ou classé en indésirable, et l'artisan croit avoir envoyé.
 */
async function resoudreExpediteur(
  tenantId: string,
  fromNameParDefaut: string,
): Promise<ExpediteurResolu> {
  const [params] = await withTenant(tenantId, (tx) =>
    tx.select().from(parametresEnvoiTable).where(eq(parametresEnvoiTable.tenantId, tenantId)),
  );

  const nom = params?.nomExpediteur ?? fromNameParDefaut;
  const domaineUtilisable =
    params?.mode === "domaine_authentifie" &&
    params.verifieLe !== null &&
    typeof params.emailExpediteur === "string" &&
    params.emailExpediteur.length > 0;

  if (domaineUtilisable) {
    return {
      mode: "domaine_authentifie",
      from: `"${nom}" <${params.emailExpediteur}>`,
      replyTo: params.emailExpediteur ?? undefined,
      avertissement: false,
    };
  }

  return {
    mode: "repli_nodaq",
    from: `"${nom}" <${adresseRepli()}>`,
    // Le « répondre à » pointe sur l'artisan quand on le connaît : c'est ce qui
    // rend le repli utilisable malgré tout.
    replyTo: params?.emailExpediteur ?? undefined,
    avertissement: true,
  };
}

/** Écrit la trace d'envoi. Sans sujet, sans corps. */
async function journaliser(
  tenantId: string,
  opts: SendOptions,
  mode: ModeEnvoi,
  statut: "envoye" | "echec",
  erreur?: string,
): Promise<void> {
  try {
    await withTenant(tenantId, (tx) =>
      tx.insert(envoisJournalTable).values({
        tenantId,
        destinataire: opts.to,
        documentType: opts.documentType,
        ...(opts.documentId ? { documentId: opts.documentId } : {}),
        mode,
        statut,
        ...(erreur ? { erreur } : {}),
      }),
    );
  } catch (err) {
    // Un journal qui échoue ne doit pas faire échouer un envoi déjà parti.
    console.error("[canal-emission] journalisation impossible:", err instanceof Error ? err.message : err);
  }
}

export async function sendDocument(opts: SendOptions): Promise<SendResult> {
  const loggedAt = new Date().toISOString();

  if (opts.canal === "PLATEFORME_AGREEE") {
    console.log("[canal-emission] PLATEFORME_AGREEE — non branché");
    return {
      success: false,
      stub: "PLATEFORME_AGREEE non branché — ce canal sera activé lors de la connexion à une PDP agréée en 2027.",
      loggedAt,
    };
  }

  const expediteur = await resoudreExpediteur(opts.tenantId, opts.fromName ?? "NODAQ");

  const mailOptions = {
    from: expediteur.from,
    ...(expediteur.replyTo ? { replyTo: expediteur.replyTo } : {}),
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: (opts.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType ?? "application/pdf",
    })),
  };

  const transporter = getTransporter();

  if (!transporter) {
    // Aucun SMTP configuré : on journalise sans envoyer. Le sujet n'apparaît
    // NI dans le journal applicatif NI en base.
    console.log(
      `[canal-emission] EMAIL non expédié (aucun SMTP configuré) — mode: ${expediteur.mode} | ` +
        `document: ${opts.documentType} | pièces jointes: ${opts.attachments?.length ?? 0}`,
    );
    await journaliser(opts.tenantId, opts, expediteur.mode, "echec", "aucun SMTP configuré");
    return {
      success: false,
      error: "aucun SMTP configuré",
      loggedAt,
      mode: expediteur.mode,
      avertissementDelivrabilite: expediteur.avertissement,
    };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[canal-emission] EMAIL envoyé — mode: ${expediteur.mode} | messageId: ${info.messageId}`);
    await journaliser(opts.tenantId, opts, expediteur.mode, "envoye");
    return {
      success: true,
      messageId: info.messageId,
      loggedAt,
      mode: expediteur.mode,
      avertissementDelivrabilite: expediteur.avertissement,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[canal-emission] EMAIL échec — mode: ${expediteur.mode} | ${msg}`);
    await journaliser(opts.tenantId, opts, expediteur.mode, "echec", msg);
    return {
      success: false,
      error: msg,
      loggedAt,
      mode: expediteur.mode,
      avertissementDelivrabilite: expediteur.avertissement,
    };
  }
}
