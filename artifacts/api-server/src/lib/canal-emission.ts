/**
 * Canal d'émission — envoi des devis, factures et avoirs.
 *
 * ── Le problème que ce module résout ────────────────────────────────────────
 * Un devis de « Toiture Martin » expédié depuis nodaq.fr n'est pas compris par
 * le destinataire et finit en indésirables : le domaine expéditeur ne
 * correspond ni au nom affiché, ni à ce que le client attend.
 *
 * ── Trois modes ─────────────────────────────────────────────────────────────
 *  'domaine_authentifie' — PRINCIPAL. Le tenant a publié SPF et DKIM sur son
 *      domaine ; le courrier part de SON adresse. Aucun secret n'est stocké :
 *      la signature DKIM est faite par le service d'envoi, la clé privée ne
 *      transite jamais par ce produit.
 *
 *  'smtp_artisan'        — Le courrier part du serveur de messagerie de
 *      l'artisan, avec ses propres identifiants. Le mot de passe vit chiffré
 *      dans `tenant_secrets` sous « envoi.smtp_password » ; il est lu au
 *      moment de construire le transporteur et ne quitte JAMAIS la fonction
 *      qui le lit — ni variable de portée large, ni journal, ni réponse HTTP.
 *
 *  'repli_nodaq'         — REPLI. Expédition depuis nodaq.fr avec un
 *      « répondre à » pointant sur l'artisan. La délivrabilité est mauvaise et
 *      l'interface le dit — un repli silencieux ferait croire que tout va bien
 *      pendant que les devis tombent en indésirables.
 *
 * Le mode SMTP était volontairement absent tant qu'aucun chiffrement au repos
 * n'existait : il exigeait de stocker un mot de passe de messagerie. C'est ce
 * que le lot chiffrement a apporté, et ce mode est sa démonstration.
 *
 * ── Journalisation ──────────────────────────────────────────────────────────
 * Destinataire, date, statut, type de document. JAMAIS le corps, JAMAIS le
 * SUJET : le sujet d'un devis porte le nom du client et la référence du
 * chantier, c'est une donnée métier interdite en journal (CLAUDE.md §6).
 */

import { createTransport, type Transporter } from "nodemailer";
import { eq, and } from "drizzle-orm";
import {
  withTenant,
  parametresEnvoiTable,
  envoisJournalTable,
  paTransmissionsTable,
  CLE_SMTP_PASSWORD,
} from "@workspace/db";
import type { ModeEnvoi } from "@workspace/db";
import { lireSecret } from "./tenant-secrets.js";
import { extractFacturXXml } from "@nodaq/facturx";
import {
  getConfig,
  submitInvoice,
  isValidTransition,
  PaConfigError,
  type SubmissionStatus,
} from "@nodaq/plateforme-agreee";

export type CanalEmission = "EMAIL" | "PLATEFORME_AGREEE";

export type TypeDocument = "DEVIS" | "FACTURE" | "AVOIR" | "INVITATION";

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

/**
 * Transporteur bâti sur le SMTP de l'artisan, ou `null`.
 *
 * LE MOT DE PASSE NE SORT PAS D'ICI. Il est lu, passé à `createTransport`, et
 * la référence meurt avec la fonction : aucun appelant ne le reçoit, aucune
 * structure de retour ne le porte. C'est délibérément plus étroit que
 * nécessaire — un secret qui circule finit par être journalisé par quelqu'un
 * qui ne savait pas.
 *
 * Refus en environnement de test, comme le transporteur global : aucun test ne
 * doit pouvoir atteindre un serveur de messagerie réel.
 */
async function transporteurArtisan(
  tenantId: string,
  params: { smtpHote: string | null; smtpPort: number | null; smtpUtilisateur: string | null },
): Promise<Transporter | null> {
  if (process.env["NODE_ENV"] === "test") return null;
  if (!params.smtpHote || !params.smtpUtilisateur) return null;

  const motDePasse = await lireSecret(tenantId, CLE_SMTP_PASSWORD);
  if (motDePasse === null) return null;

  const port = params.smtpPort ?? 587;
  return createTransport({
    host: params.smtpHote,
    port,
    secure: port === 465,
    auth: { user: params.smtpUtilisateur, pass: motDePasse },
  });
}

interface ExpediteurResolu {
  mode: ModeEnvoi;
  from: string;
  replyTo: string | undefined;
  avertissement: boolean;
  /** Bâti à partir du paramétrage du tenant. `null` = employer le global. */
  transporteur: Transporter | null;
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
      transporteur: null,
    };
  }

  // SMTP de l'artisan — le courrier part de chez lui, donc l'alignement est
  // acquis et aucun avertissement de délivrabilité n'est justifié.
  if (params?.mode === "smtp_artisan" && params.emailExpediteur) {
    const transporteur = await transporteurArtisan(tenantId, params);
    if (transporteur !== null) {
      return {
        mode: "smtp_artisan",
        from: `"${nom}" <${params.emailExpediteur}>`,
        replyTo: params.emailExpediteur,
        avertissement: false,
        transporteur,
      };
    }
    // Configuré mais inutilisable — mot de passe absent ou serveur incomplet.
    // On retombe en repli AVEC l'avertissement : le contraire ferait croire à
    // l'artisan que ses devis partent de chez lui alors qu'ils partent de
    // nodaq.fr, ce qui est exactement le mensonge que ce module refuse.
  }

  return {
    mode: "repli_nodaq",
    from: `"${nom}" <${adresseRepli()}>`,
    // Le « répondre à » pointe sur l'artisan quand on le connaît : c'est ce qui
    // rend le repli utilisable malgré tout.
    replyTo: params?.emailExpediteur ?? undefined,
    avertissement: true,
    transporteur: null,
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

/**
 * Écrit (ou met à jour) le statut de transmission d'une facture, en
 * respectant le vocabulaire normatif : un statut hors ordre (webhook rejoué,
 * réponse en double) est IGNORÉ plutôt qu'appliqué — voir isValidTransition
 * dans @nodaq/facturx.
 */
async function ecrireTransmission(
  tenantId: string,
  documentId: string,
  nouveauStatut: SubmissionStatus,
  submissionId?: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [existant] = await tx
      .select()
      .from(paTransmissionsTable)
      .where(
        and(
          eq(paTransmissionsTable.tenantId, tenantId),
          eq(paTransmissionsTable.documentType, "FACTURE"),
          eq(paTransmissionsTable.documentId, documentId),
        ),
      );

    if (existant) {
      if (!isValidTransition(existant.statut as SubmissionStatus, nouveauStatut)) return;
      await tx
        .update(paTransmissionsTable)
        .set({
          statut: nouveauStatut,
          updatedAt: new Date(),
          ...(submissionId ? { submissionId } : {}),
        })
        .where(eq(paTransmissionsTable.id, existant.id));
      return;
    }

    await tx.insert(paTransmissionsTable).values({
      tenantId,
      documentType: "FACTURE",
      documentId,
      statut: nouveauStatut,
      ...(submissionId ? { submissionId } : {}),
    });
  });
}

/**
 * Transmission via une plateforme agréée (US-A2.6) — distinct de l'envoi
 * EMAIL au client : la PA n'a pas d'adresse « to », `opts.to`/`subject`/
 * `body` ne s'appliquent pas ici. Le document à transmettre est le PREMIER
 * fichier joint (le Factur-X déjà archivé par factures.ts) ; son XML est
 * relu via extractFacturXXml plutôt que reconstruit, pour transmettre
 * EXACTEMENT ce qui a été archivé.
 */
async function sendViaPlateformeAgreee(opts: SendOptions, loggedAt: string): Promise<SendResult> {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof PaConfigError) {
      console.log(`[canal-emission] PLATEFORME_AGREEE — non configurée (${err.missingVar})`);
      return {
        success: false,
        stub: "Aucune plateforme agréée n'est configurée sur ce déploiement.",
        loggedAt,
      };
    }
    throw err;
  }

  const piece = opts.attachments?.[0];
  if (!piece) {
    return { success: false, error: "Aucun document à transmettre.", loggedAt };
  }
  const pdfBytes = Buffer.from(piece.content);

  let xml: string | null;
  try {
    xml = await extractFacturXXml(pdfBytes);
  } catch {
    xml = null;
  }
  if (!xml) {
    return { success: false, error: "Le document joint n'est pas un Factur-X exploitable.", loggedAt };
  }

  const documentId = opts.documentId ?? piece.filename;

  let resultat;
  try {
    resultat = await submitInvoice(config, {
      documentType: "FACTURE",
      documentId,
      payload: xml,
      pdfBytes,
    });
  } catch (err) {
    await ecrireTransmission(opts.tenantId, documentId, "erreur");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[canal-emission] PLATEFORME_AGREEE échec — ${msg}`);
    return { success: false, error: msg, loggedAt };
  }

  await ecrireTransmission(opts.tenantId, documentId, resultat.status, resultat.submissionId);
  console.log(`[canal-emission] PLATEFORME_AGREEE transmis — statut: ${resultat.status}`);
  return { success: true, messageId: resultat.submissionId, loggedAt };
}

export async function sendDocument(opts: SendOptions): Promise<SendResult> {
  const loggedAt = new Date().toISOString();

  if (opts.canal === "PLATEFORME_AGREEE") {
    return sendViaPlateformeAgreee(opts, loggedAt);
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

  // Le transporteur du tenant l'emporte sur le global : quand l'artisan a
  // configuré son propre SMTP, c'est de chez lui que part le courrier.
  const transporter = expediteur.transporteur ?? getTransporter();

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
