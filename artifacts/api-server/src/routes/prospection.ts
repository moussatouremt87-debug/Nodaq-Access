/**
 * Prospection — contacts, bases légales, envois, signaux de zone.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CE N'EST PAS L'INTERFACE QUI DÉCIDE, C'EST CETTE ROUTE.                 ║
 * ║  Un appel direct à `/prospection/envoyer` sur une combinaison interdite   ║
 * ║  répond 403 et n'envoie ni ne journalise rien.                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * AUCUN SUIVI D'OUVERTURE. Les pixels de suivi sont soumis à consentement, y
 * compris en B2B. Rien dans ce module n'insère d'image dans un message, et une
 * garde le vérifie sur le CORPS produit.
 */
import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import { z } from "zod";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  withTenant,
  contactsProspectionTable,
  contactBasesTable,
  clientsTable,
  facturesTable,
  settingsTable,
} from "@workspace/db";
import {
  TYPES_CONTACT,
  BASES_LEGALES,
  CANAUX,
  SEUIL_ANONYMAT,
  agregatPubliable,
  RETENTION_PROSPECTION_JOURS,
  canauxAutorises,
  axesPourMetier,
  raisonSilence,
  MESSAGES_SILENCE,
  secteurMarchesPublicsPour,
  toDateString,
  type TypeContact,
  type BaseLegale,
  type SourcePublique,
} from "@nodaq/shared";
import {
  verifierEnvoi,
  baseCourante,
  estOppose,
  exposer,
  poserJetonOpposition,
  chargerContact,
} from "../lib/prospection.js";
import { sendDocument } from "../lib/canal-emission.js";
import {
  chercherEntreprises,
  configAnnuaire,
  AnnuaireConfigError,
  AnnuaireError,
  type TransportAnnuaire,
} from "../lib/annuaire-entreprises.js";
import {
  chercherMarches,
  configBoamp,
  BoampConfigError,
  BoampError,
  type TransportBoamp,
} from "../lib/boamp.js";
import {
  chercherAttributions,
  agregerParSecteurEtZone,
  configDecp,
  DecpConfigError,
  DecpError,
  type TransportDecp,
} from "../lib/decp.js";
import {
  chercherSyndics,
  agregerSyndicsBenevoles,
  configRnic,
  RnicConfigError,
  RnicError,
  type TransportRnic,
} from "../lib/rnic-syndics.js";
import {
  chercherPermis,
  configPermis,
  PermisConfigError,
  PermisError,
  type TransportPermis,
} from "../lib/permis-construire.js";
import { VERTICAL_SETTING_KEY } from "../lib/vertical-tenant.js";

const router: IRouter = Router();

const DATE_METIER = /^\d{4}-\d{2}-\d{2}$/;

const ContactBody = z.object({
  nom: z.string().min(1).max(200),
  type: z.enum(TYPES_CONTACT),
  email: z.string().email().nullable().optional(),
  telephone: z.string().max(40).nullable().optional(),
  adresse: z.string().max(300).nullable().optional(),
  codePostal: z.string().max(10).nullable().optional(),
  ville: z.string().max(120).nullable().optional(),
  siret: z.string().max(20).nullable().optional(),
  origine: z.string().max(300).nullable().optional(),
});

const BaseBody = z.object({
  base: z.enum(BASES_LEGALES),
  /** D'où vient la donnée, en clair. Obligatoire : l'article 14 l'impose. */
  source: z.string().min(1, "La source de la donnée est obligatoire").max(500),
  texteExact: z.string().max(2000).nullable().optional(),
  obtenueLe: z.string().regex(DATE_METIER).optional(),
});

// ── Contacts ─────────────────────────────────────────────────────────────────

/**
 * Liste des contacts, avec leurs canaux ouverts et l'EMBARGO appliqué.
 *
 * Les coordonnées d'un particulier non informé ne sont pas dans le corps de la
 * réponse — pas masquées à l'écran : absentes.
 */
router.get("/prospection/contacts", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const contacts = await withTenant(tenantId, (tx) =>
    tx.select().from(contactsProspectionTable).orderBy(desc(contactsProspectionTable.createdAt)),
  );

  const exposes = [];
  for (const c of contacts) {
    const base = await baseCourante(tenantId, c.id);
    const oppose = await estOppose(tenantId, c);
    const canaux = base
      ? canauxAutorises(c.type as TypeContact, base.base, base.informeeLe, oppose)
      : { email: false, telephone: false, courrier: false };
    exposes.push({ ...exposer(c, base, canaux), oppose });
  }

  res.json({ contacts: exposes, total: exposes.length });
});

router.post("/prospection/contacts", async (req, res): Promise<void> => {
  const parsed = ContactBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const [cree] = await withTenant(tenantId, (tx) =>
    tx.insert(contactsProspectionTable).values({ tenantId, ...parsed.data }).returning(),
  );
  // Aucune base légale n'est posée d'office : un contact sans base n'est pas
  // prospectable, et c'est le bon défaut.
  res.status(201).json(cree);
});

/**
 * Import d'un fichier de contacts.
 *
 * La base légale est posée POUR CHAQUE ligne, avec la source du fichier :
 * importer sans dire d'où vient la donnée rendrait l'information de
 * l'article 14 impossible à rédiger.
 */
router.post("/prospection/importer", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      source: z.string().min(1, "La source du fichier est obligatoire").max(500),
      base: z.enum(BASES_LEGALES),
      contacts: z.array(ContactBody).min(1).max(2000),
    })
    .safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;
  const aujourdhui = toDateString(new Date());

  const crees = await withTenant(tenantId, async (tx) => {
    const ids: string[] = [];
    for (const c of d.contacts) {
      const [ligne] = await tx
        .insert(contactsProspectionTable)
        .values({ tenantId, ...c, origine: d.source })
        .returning({ id: contactsProspectionTable.id });
      await tx.insert(contactBasesTable).values({
        tenantId,
        contactId: ligne!.id,
        contactType: c.type,
        base: d.base,
        source: d.source,
        obtenueLe: aujourdhui,
      });
      ids.push(ligne!.id);
    }
    return ids;
  });

  res.status(201).json({ importes: crees.length });
});

/**
 * Alimente la liste depuis les PROPRES CLIENTS de l'artisan.
 *
 * C'est le premier niveau, et la meilleure liste du produit. La base
 * `CLIENT_EXISTANT` est posée automatiquement, avec la facture d'origine en
 * source — l'exception « client existant » ne vaut que si l'on peut montrer
 * qu'il a acheté.
 */
router.post("/prospection/depuis-clients", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const aujourdhui = toDateString(new Date());

  const resultat = await withTenant(tenantId, async (tx) => {
    const clients = await tx.select().from(clientsTable).where(eq(clientsTable.archive, false));
    const dejaLa = await tx
      .select({ clientId: contactsProspectionTable.clientId })
      .from(contactsProspectionTable);
    const connus = new Set(dejaLa.map((d) => d.clientId).filter(Boolean));

    let ajoutes = 0;
    let ignores = 0;
    for (const client of clients) {
      if (connus.has(client.id)) { ignores++; continue; }

      // La facture d'origine : sans achat, pas d'exception « client existant ».
      const [facture] = await tx
        .select({ number: facturesTable.number, issuedDate: facturesTable.issuedDate })
        .from(facturesTable)
        .where(and(eq(facturesTable.clientId, client.id), eq(facturesTable.statut, "PAYEE")))
        .orderBy(desc(facturesTable.issuedDate))
        .limit(1);
      if (!facture) { ignores++; continue; }

      const [contact] = await tx
        .insert(contactsProspectionTable)
        .values({
          tenantId,
          clientId: client.id,
          nom: client.nom,
          type: client.type,
          email: client.email,
          telephone: client.telephone,
          adresse: client.adresse,
          codePostal: client.codePostal,
          ville: client.ville,
          siret: client.siret,
          origine: "fichier client",
          derniereInteractionLe: facture.issuedDate,
        })
        .returning({ id: contactsProspectionTable.id });

      await tx.insert(contactBasesTable).values({
        tenantId,
        contactId: contact!.id,
        contactType: client.type,
        base: "CLIENT_EXISTANT",
        source: `client depuis la facture ${facture.number}`,
        obtenueLe: facture.issuedDate,
      });
      ajoutes++;
    }
    return { ajoutes, ignores };
  });

  res.status(201).json(resultat);
});

// ── Bases légales ────────────────────────────────────────────────────────────

router.post("/prospection/contacts/:id/base", async (req, res): Promise<void> => {
  const parsed = BaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const contact = await chargerContact(tenantId, id!);
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

  // APPEND-ONLY : une base légale ne se réécrit pas, elle se remplace par une
  // nouvelle ligne. La base courante est la dernière posée.
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .insert(contactBasesTable)
      .values({
        tenantId,
        contactId: contact.id,
        contactType: contact.type,
        base: parsed.data.base,
        source: parsed.data.source,
        texteExact: parsed.data.texteExact ?? null,
        obtenueLe: parsed.data.obtenueLe ?? toDateString(new Date()),
      })
      .returning(),
  );
  res.status(201).json(ligne);
});

/**
 * Envoie l'information de l'article 14 et lève l'embargo.
 *
 * Le message dit QUI détient la donnée, D'OÙ elle vient, POURQUOI, et COMMENT
 * s'y opposer. La date d'information est enregistrée par une NOUVELLE ligne de
 * base légale — la table est append-only, et c'est ce qui donne sa valeur au
 * journal le jour d'un contrôle.
 */
router.post("/prospection/contacts/:id/informer", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const contact = await chargerContact(tenantId, id!);
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

  const base = await baseCourante(tenantId, contact.id);
  if (!base) { res.status(409).json({ error: "Aucune base légale à documenter." }); return; }
  if (base.informeeLe) {
    res.status(409).json({ error: "Cette personne a déjà été informée.", informeeLe: base.informeeLe });
    return;
  }

  const jeton = await poserJetonOpposition(tenantId, contact.id);
  const lienOpposition = `${process.env["APP_URL"] ?? "https://nodaq.fr"}/opposition/${jeton}`;
  const aujourdhui = toDateString(new Date());

  const corps = [
    `Bonjour,`,
    ``,
    `Nous détenons vos coordonnées dans le cadre de notre activité.`,
    `Origine de cette donnée : ${base.source}.`,
    `Finalité : vous proposer nos services de travaux.`,
    ``,
    `Vous pouvez vous y opposer à tout moment, sans avoir à vous justifier :`,
    lienOpposition,
  ].join("\n");

  let envoye = false;
  if (contact.email) {
    const envoi = await sendDocument({
      canal: "EMAIL",
      tenantId,
      to: contact.email,
      subject: "Information sur vos données",
      body: corps,
      documentType: "DEVIS",
    });
    envoye = envoi.success;
  }

  await withTenant(tenantId, (tx) =>
    tx.insert(contactBasesTable).values({
      tenantId,
      contactId: contact.id,
      contactType: contact.type,
      base: base.base,
      source: base.source,
      obtenueLe: aujourdhui,
      informeeLe: aujourdhui,
    }),
  );

  res.json({
    informeeLe: aujourdhui,
    envoyeParEmail: envoye,
    // Sans e-mail, l'information part par courrier : on rend la lettre à
    // imprimer, qui est la fonction utile pour un particulier repéré ailleurs.
    lettre: contact.email ? null : corps,
    lienOpposition,
  });
});

// ── Envoi ────────────────────────────────────────────────────────────────────

/**
 * L'envoi. REFUSE ce que l'interface n'aurait pas dû proposer.
 *
 * Le 403 est rendu AVANT toute écriture : rien n'est envoyé, et rien n'est
 * journalisé comme envoyé. Un refus qui laisserait une trace d'envoi serait
 * pire qu'un envoi — il ferait croire à l'artisan que le message est parti.
 */
router.post("/prospection/envoyer", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      contactId: z.string().min(1),
      canal: z.enum(CANAUX),
      objet: z.string().min(1).max(300),
      message: z.string().min(1).max(20_000),
    })
    .safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  const contact = await chargerContact(tenantId, d.contactId);
  if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

  const verdict = await verifierEnvoi(tenantId, contact, d.canal);
  if (!verdict.ok) {
    res.status(403).json({ error: verdict.motif, canaux: verdict.canaux });
    return;
  }

  // Le courrier ne part pas d'ici : on rend la lettre à imprimer.
  if (d.canal === "courrier") {
    res.json({
      canal: "courrier",
      lettre: `${d.objet}\n\n${d.message}`,
      adresse: [contact.adresse, `${contact.codePostal ?? ""} ${contact.ville ?? ""}`.trim()]
        .filter(Boolean)
        .join("\n"),
    });
    return;
  }

  if (d.canal === "telephone") {
    // Un appel ne s'automatise pas : on confirme seulement qu'il est permis.
    res.json({ canal: "telephone", autorise: true, telephone: contact.telephone });
    return;
  }

  if (!contact.email) {
    res.status(409).json({ error: "Ce contact n'a pas d'adresse e-mail." });
    return;
  }

  const jeton = await poserJetonOpposition(tenantId, contact.id);
  const lienOpposition = `${process.env["APP_URL"] ?? "https://nodaq.fr"}/opposition/${jeton}`;

  // AUCUN PIXEL. Le lien d'opposition est un lien TEXTE, dans CHAQUE message.
  const corps = [
    d.message,
    ``,
    `———`,
    `Pour ne plus recevoir de messages de notre part : ${lienOpposition}`,
  ].join("\n");

  const envoi = await sendDocument({
    canal: "EMAIL",
    tenantId,
    to: contact.email,
    subject: d.objet,
    body: corps,
    documentType: "DEVIS",
  });

  await withTenant(tenantId, (tx) =>
    tx
      .update(contactsProspectionTable)
      .set({ derniereInteractionLe: toDateString(new Date()) })
      .where(eq(contactsProspectionTable.id, contact.id)),
  );

  res.json({ canal: "email", envoye: envoi.success, lienOpposition, corps });
});

// ── Axes de prospection, depuis des sources PUBLIQUES ───────────────────────

/** Lit un réglage du tenant, sans valeur inventée. */
async function reglage(tenantId: string, cle: string): Promise<string | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, cle)),
  );
  const v = rows[0]?.value;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * GET /prospection/axes — QUI démarcher, et pourquoi.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNIQUEMENT DES CIBLES PROFESSIONNELLES. Le type de sortie ne porte      ║
 * ║  aucune valeur « particulier » — ce n'est pas un filtre qu'on applique,   ║
 * ║  c'est un champ qui n'existe pas.                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Chaque axe CITE sa source. Quand aucune source n'est configurée, la route
 * rend zéro axe et DIT pourquoi : une suggestion que l'artisan ne pourrait pas
 * vérifier ne s'affiche pas.
 */
router.get("/prospection/axes", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  // La source vient de la CONFIGURATION. Absente ⇒ aucune suggestion, et on le
  // dit — jamais une piste qu'on ne pourrait pas justifier.
  let sources: Array<{ label: string; url: string }> = [];
  try {
    sources = [configAnnuaire().source];
  } catch (err) {
    if (!(err instanceof AnnuaireConfigError)) throw err;
  }

  // `votre-metier.metier` — pas `metier.secteur` : c'est la clé que l'écran
  // « Votre métier » pose réellement (voir creerRouteAppelsOffres plus bas,
  // même correctif). `CIBLES_PAR_SECTEUR` (axesProspection.ts) est keyé
  // directement par les valeurs de `Vertical` qui ont un équivalent —
  // batiment/paysage/maintenance — donc aucune traduction n'est nécessaire
  // ici, contrairement à `secteurMarchesPublicsPour` plus bas qui vise un
  // référentiel différent (CPV, marchés publics).
  const contexte = {
    secteur: await reglage(tenantId, VERTICAL_SETTING_KEY),
    zone: (await reglage(tenantId, "company.commune")) ?? (await reglage(tenantId, "company.code_postal")),
    sources,
  };

  const axes = axesPourMetier(contexte);
  const raison = raisonSilence(contexte);

  res.json({
    axes,
    // Le rappel est affiché en PERMANENCE, pas seulement quand il y a des axes.
    avertissement:
      "Ces pistes ne visent que des PROFESSIONNELS. Le démarchage téléphonique " +
      "d'un particulier exige son consentement préalable.",
    raisonSilence: raison,
    messageSilence: raison ? MESSAGES_SILENCE[raison] : null,
  });
});

/**
 * POST /prospection/contacts/:id/enrichir
 *
 * Complète un contact PROFESSIONNEL depuis un registre public, et n'écrit que
 * ce qui manque : l'artisan a pu corriger une adresse, et une source publique
 * n'a pas à écraser sa correction.
 *
 * ── PAS DE BASE LÉGALE, PAS D'ENRICHISSEMENT ────────────────────────────────
 * Aucune donnée n'est stockée sans base légale documentée. Un contact qui n'en
 * a pas est refusé en 409 — enrichir d'abord et régulariser ensuite serait
 * exactement l'inverse de ce que le registre décrit.
 *
 * L'origine de l'enrichissement est consignée dans une NOUVELLE ligne de
 * `contact_bases`, table append-only : on saura d'où viennent ces champs.
 */
export function creerRouteEnrichissement(transport?: TransportAnnuaire): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId!;
    const { id } = req.params;

    const contact = await chargerContact(tenantId, typeof id === "string" ? id : "");
    if (!contact) { res.status(404).json({ error: "Contact introuvable" }); return; }

    // Un PARTICULIER ne s'enrichit pas depuis un registre d'entreprises : la
    // donnée n'y serait pas, et l'y chercher reviendrait à traiter une
    // personne physique comme une cible professionnelle.
    if (contact.type !== "PRO") {
      res.status(422).json({
        error: "L'enrichissement ne vise que des contacts PROFESSIONNELS.",
      });
      return;
    }

    const base = await baseCourante(tenantId, contact.id);
    if (!base) {
      res.status(409).json({
        error:
          "Ce contact n'a aucune base légale enregistrée. Documentez-la avant " +
          "d'enrichir : aucune donnée n'est stockée sans base légale.",
      });
      return;
    }

    let trouvees;
    try {
      trouvees = await chercherEntreprises(
        { quoi: contact.nom, ou: contact.ville ?? contact.codePostal ?? "" },
        transport,
      );
    } catch (err) {
      if (err instanceof AnnuaireConfigError) {
        res.status(503).json({
          error: "Aucune source publique n'est configurée sur ce déploiement.",
          variableManquante: err.variableManquante,
        });
        return;
      }
      if (err instanceof AnnuaireError) {
        res.status(502).json({ error: err.message });
        return;
      }
      throw err;
    }

    const trouvee = trouvees[0];
    if (!trouvee) {
      // Rien trouvé est un RÉSULTAT, pas une panne — et surtout pas une
      // invitation à inventer.
      res.json({ enrichi: false, motif: "Aucune correspondance dans le registre public." });
      return;
    }

    const complement = {
      ...(contact.adresse ? {} : trouvee.adresse ? { adresse: trouvee.adresse } : {}),
      ...(contact.codePostal ? {} : trouvee.codePostal ? { codePostal: trouvee.codePostal } : {}),
      ...(contact.ville ? {} : trouvee.ville ? { ville: trouvee.ville } : {}),
      ...(contact.siret ? {} : trouvee.siren ? { siret: trouvee.siren } : {}),
    };

    if (Object.keys(complement).length > 0) {
      await withTenant(tenantId, (tx) =>
        tx
          .update(contactsProspectionTable)
          .set(complement)
          .where(eq(contactsProspectionTable.id, contact.id)),
      );
      // La provenance est consignée : append-only, donc une nouvelle ligne.
      await withTenant(tenantId, (tx) =>
        tx.insert(contactBasesTable).values({
          tenantId,
          contactId: contact.id,
          contactType: contact.type,
          base: base.base,
          source: `${base.source} · enrichi depuis ${trouvee.source.label}`,
          obtenueLe: toDateString(new Date()),
          ...(base.informeeLe ? { informeeLe: base.informeeLe } : {}),
        }),
      );
    }

    res.json({
      enrichi: Object.keys(complement).length > 0,
      champs: Object.keys(complement),
      // La source est CITÉE dans la réponse, pas seulement stockée.
      source: trouvee.source,
    });
  };
}

router.post("/prospection/contacts/:id/enrichir", creerRouteEnrichissement());

// ── Signaux de zone ──────────────────────────────────────────────────────────

/**
 * Compteurs par commune et par nature de travaux, SANS PERSONNE.
 *
 * Aucune donnée personnelle conservée, donc ni base légale, ni information, ni
 * opposition. En contrepartie, le SEUIL D'ANONYMAT est absolu : sous cinq
 * occurrences, on se tait.
 *
 * Dans une commune de trois cents habitants, « un permis de rénovation de
 * toiture ce mois-ci » désigne quelqu'un. Un agrégat n'anonymise que s'il
 * porte sur assez de monde.
 */
router.get("/prospection/signaux", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const rows = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT ville, count(*)::int AS occurrences
        FROM contacts_prospection
       WHERE ville IS NOT NULL
       GROUP BY ville
       ORDER BY occurrences DESC
    `);
    return (r as unknown as { rows: Array<{ ville: string; occurrences: number }> }).rows;
  });

  const publiables = rows.filter((r) => agregatPubliable(r.occurrences));
  const tus = rows.length - publiables.length;

  res.json({
    signaux: publiables,
    seuilAnonymat: SEUIL_ANONYMAT,
    /** Combien d'agrégats sont TUS faute d'atteindre le seuil. On le dit. */
    agregatsTus: tus,
  });
});

// ── Signaux de zone, sources publiques institutionnelles ────────────────────

/**
 * Les deux raisons de silence communes aux quatre sources ci-dessous : aucune
 * n'a besoin d'un secteur déclaré comme `/axes`, seulement d'une source
 * configurée et d'une zone. Un seul type local, pas une réutilisation forcée
 * du `RaisonSilence` d'`axesProspection.ts`, dont les variantes ne
 * correspondent pas à ce que ces routes vérifient.
 */
type RaisonSilenceZone = "aucune_source" | "zone_absente" | null;

const MESSAGES_SILENCE_ZONE: Record<NonNullable<RaisonSilenceZone>, string> = {
  aucune_source:
    "Aucune source publique n'est configurée sur ce déploiement. Nous ne proposons " +
    "pas de piste que vous ne pourriez pas vérifier.",
  zone_absente: "Renseignez votre ville ou votre code postal pour délimiter la recherche.",
};

/**
 * BOAMP et DECP filtrent en plus par PERTINENCE MÉTIER — voir
 * `secteurMarchesPublicsPour` dans `@nodaq/shared`. `secteur_non_couvert` :
 * ni deviné ni approximé, un menuisier ne doit jamais voir des fournitures de
 * peluches pour l'armée sous prétexte que le mapping manque.
 */
type RaisonSilenceMarche = RaisonSilenceZone | "secteur_non_couvert";

const MESSAGES_SILENCE_MARCHE: Record<Exclude<RaisonSilenceMarche, null>, string> = {
  ...MESSAGES_SILENCE_ZONE,
  secteur_non_couvert:
    "Votre métier n'a pas encore de correspondance établie avec les codes des " +
    "marchés publics. Plutôt que d'afficher des résultats non pertinents, nous " +
    "préférons ne rien proposer.",
};

/**
 * GET /prospection/appels-offres — avis de marchés publics du BTP, dans la zone.
 *
 * La source la plus simple des quatre : le côté acheteur d'un avis BOAMP est
 * TOUJOURS un organisme public, jamais une personne. Aucune garde
 * d'anonymisation n'est nécessaire ici.
 *
 * Exportée comme fabrique de route — comme `creerRouteEnrichissement` — pour
 * que les tests injectent un transport simulé sans jamais atteindre le réseau.
 */
export function creerRouteAppelsOffres(transport?: TransportBoamp): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId!;
    const ville = await reglage(tenantId, "company.commune");
    const codePostal = await reglage(tenantId, "company.code_postal");
    // `votre-metier.metier` — pas `metier.secteur` : c'est la clé que l'écran
    // « Votre métier » pose réellement. `metier.secteur` n'est écrite par
    // aucun écran de ce dépôt (vérifié) ; s'y fier rendrait ce filtre
    // silencieux pour tout le monde.
    const metier = await reglage(tenantId, VERTICAL_SETTING_KEY);
    const secteur = secteurMarchesPublicsPour(metier);

    let raison: RaisonSilenceMarche = null;
    try {
      configBoamp();
    } catch (err) {
      if (!(err instanceof BoampConfigError)) throw err;
      raison = "aucune_source";
    }
    if (!raison && !ville && !codePostal) raison = "zone_absente";
    if (!raison && !secteur) raison = "secteur_non_couvert";

    let marches: Awaited<ReturnType<typeof chercherMarches>> = [];
    if (!raison) {
      try {
        marches = await chercherMarches({ departement: null, codePostal }, transport, secteur!.motsCles);
      } catch (err) {
        if (err instanceof BoampConfigError) {
          res.status(503).json({ error: err.message, variableManquante: err.variableManquante });
          return;
        }
        if (err instanceof BoampError) {
          res.status(502).json({ error: err.message });
          return;
        }
        throw err;
      }
    }

    res.json({
      marches,
      avertissement:
        "Ces marchés sont publiés par des organismes publics — aucune personne n'est jamais identifiée ici.",
      raisonSilence: raison,
      messageSilence: raison ? MESSAGES_SILENCE_MARCHE[raison] : null,
    });
  };
}

router.get("/prospection/appels-offres", creerRouteAppelsOffres());

/**
 * GET /prospection/sous-traitance — attributaires de marchés publics, comme
 * piste de sous-traitance.
 *
 * ── UN TITULAIRE NOMMÉ N'EST JAMAIS RENDU PAR DÉFAUT ────────────────────────
 * Les DECP ne portent aucun marqueur fiable personne physique/morale — un
 * titulaire peut être un entrepreneur individuel. Par défaut, seuls des
 * AGRÉGATS anonymisés (secteur × zone, sous le seuil on se tait) sont rendus.
 * `titulairesProfessionnels` reste vide tant que le déploiement n'active pas
 * explicitement `DECP_AFFICHER_TITULAIRES_PRO` — c'est LA garde que le test
 * doit éprouver.
 */
export function creerRouteSousTraitance(transport?: TransportDecp): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId!;
    const ville = await reglage(tenantId, "company.commune");
    const codePostal = await reglage(tenantId, "company.code_postal");
    const metier = await reglage(tenantId, VERTICAL_SETTING_KEY);
    const secteur = secteurMarchesPublicsPour(metier);

    let raison: RaisonSilenceMarche = null;
    try {
      configDecp();
    } catch (err) {
      if (!(err instanceof DecpConfigError)) throw err;
      raison = "aucune_source";
    }
    if (!raison && !ville && !codePostal) raison = "zone_absente";
    if (!raison && !secteur) raison = "secteur_non_couvert";

    let agregats: ReturnType<typeof agregerParSecteurEtZone> = [];
    let agregatsTus = 0;
    let titulairesProfessionnels: Awaited<ReturnType<typeof chercherAttributions>> = [];
    if (!raison) {
      let attributions: Awaited<ReturnType<typeof chercherAttributions>>;
      try {
        attributions = await chercherAttributions(
          { departement: null, codePostal },
          transport,
          secteur!.divisionsCpv,
        );
      } catch (err) {
        if (err instanceof DecpConfigError) {
          res.status(503).json({ error: err.message, variableManquante: err.variableManquante });
          return;
        }
        if (err instanceof DecpError) {
          res.status(502).json({ error: err.message });
          return;
        }
        throw err;
      }
      const brutes = agregerParSecteurEtZone(attributions);
      agregats = brutes.filter((a) => agregatPubliable(a.occurrences));
      agregatsTus = brutes.length - agregats.length;
      if (process.env["DECP_AFFICHER_TITULAIRES_PRO"] === "true") {
        titulairesProfessionnels = attributions;
      }
    }

    res.json({
      agregats,
      titulairesProfessionnels,
      seuilAnonymat: SEUIL_ANONYMAT,
      agregatsTus,
      avertissement:
        "Un titulaire de marché public peut être un entrepreneur individuel, donc une " +
        "personne physique : aucun nom n'est affiché sans activation explicite de ce déploiement.",
      raisonSilence: raison,
      messageSilence: raison ? MESSAGES_SILENCE_MARCHE[raison] : null,
    });
  };
}

router.get("/prospection/sous-traitance", creerRouteSousTraitance());

/**
 * GET /prospection/syndics — syndics de copropriété, dans la commune.
 *
 * Un syndic PROFESSIONNEL (société) est une cible légitime ; un syndic
 * BÉNÉVOLE est un résident, donc un particulier — jamais nommé, seulement
 * compté dans `agregats`. `syndicsProfessionnels` reste vide tant que le
 * déploiement n'active pas `RNIC_AFFICHER_SYNDICS_PRO`.
 */
export function creerRouteSyndics(transport?: TransportRnic): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId!;
    const ville = await reglage(tenantId, "company.commune");
    const codePostal = await reglage(tenantId, "company.code_postal");

    let raison: RaisonSilenceZone = null;
    try {
      configRnic();
    } catch (err) {
      if (!(err instanceof RnicConfigError)) throw err;
      raison = "aucune_source";
    }
    if (!raison && !ville && !codePostal) raison = "zone_absente";

    let agregats: ReturnType<typeof agregerSyndicsBenevoles> = [];
    let agregatsTus = 0;
    let syndicsProfessionnels: Awaited<ReturnType<typeof chercherSyndics>> = [];
    if (!raison) {
      let syndics: Awaited<ReturnType<typeof chercherSyndics>>;
      try {
        syndics = await chercherSyndics({ commune: ville, codePostal }, transport);
      } catch (err) {
        if (err instanceof RnicConfigError) {
          res.status(503).json({ error: err.message, variableManquante: err.variableManquante });
          return;
        }
        if (err instanceof RnicError) {
          res.status(502).json({ error: err.message });
          return;
        }
        throw err;
      }
      const brutes = agregerSyndicsBenevoles(syndics);
      agregats = brutes.filter((a) => agregatPubliable(a.occurrences));
      agregatsTus = brutes.length - agregats.length;
      if (process.env["RNIC_AFFICHER_SYNDICS_PRO"] === "true") {
        syndicsProfessionnels = syndics.filter((s) => s.syndicProfessionnel);
      }
    }

    res.json({
      agregats,
      syndicsProfessionnels,
      seuilAnonymat: SEUIL_ANONYMAT,
      agregatsTus,
      avertissement:
        "Un syndic bénévole est un résident, donc un particulier : jamais nommé, " +
        "seulement compté par commune.",
      raisonSilence: raison,
      messageSilence: raison ? MESSAGES_SILENCE_ZONE[raison] : null,
    });
  };
}

router.get("/prospection/syndics", creerRouteSyndics());

/**
 * GET /prospection/permis — permis de construire, déclarations préalables et
 * permis d'aménager, dans la zone.
 *
 * ── LA LIGNE NÉGOCIÉE, TENUE ICI ─────────────────────────────────────────────
 * `pistesProfessionnelles` : un demandeur personne MORALE, gaté par
 * `PERMIS_AFFICHER_PISTES_PRO` — traité comme n'importe quelle autre source
 * professionnelle du lot.
 *
 * `informationsParticuliers` : un demandeur personne PHYSIQUE. Ce que la source
 * publie de LUI, en pratique : rien. Mesuré sur un échantillon réel, 44
 * enregistrements sur 100 ne portent ni `denom_dem` ni `cj_dem` — Sitadel
 * ANONYMISE les personnes physiques. Aucune source publique française ne
 * publie leur téléphone ni leur e-mail, et le démarchage électronique à froid
 * d'un particulier sans consentement préalable est de toute façon interdit
 * (art. L34-5 CPCE).
 *
 * Ce que la source publie, en revanche, c'est le CHANTIER : une adresse, une
 * nature de travaux, une date d'autorisation, une superficie de terrain.
 * C'est un signal de terrain — il s'y passera quelque chose, là, bientôt — et
 * c'est à ce titre qu'il vaut d'être affiché. D'où le nom du champ dans
 * l'écran : « signal de chantier », pas « piste ».
 *
 * `nomDemandeur` reste transmis parce qu'un republieur pourrait le fournir,
 * mais RIEN ne doit en dépendre : l'écran nomme la ligne par son adresse.
 */
export function creerRoutePermis(transport?: TransportPermis): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantId!;
  const ville = await reglage(tenantId, "company.commune");
  const codePostal = await reglage(tenantId, "company.code_postal");

  let raison: RaisonSilenceZone = null;
  try {
    configPermis();
  } catch (err) {
    if (!(err instanceof PermisConfigError)) throw err;
    raison = "aucune_source";
  }
  if (!raison && !ville && !codePostal) raison = "zone_absente";

  let pistesProfessionnelles: Awaited<ReturnType<typeof chercherPermis>> = [];
  let informationsParticuliers: Array<{
    nomDemandeur: string | null;
    adresse: string | null;
    codePostal: string | null;
    commune: string | null;
    dateOctroi: string | null;
    nature: string | null;
    superficieTerrain: number | null;
    source: SourcePublique;
  }> = [];
  if (!raison) {
    let permis: Awaited<ReturnType<typeof chercherPermis>>;
    try {
      permis = await chercherPermis({ commune: ville, codePostal }, transport);
    } catch (err) {
      if (err instanceof PermisConfigError) {
        res.status(503).json({ error: err.message, variableManquante: err.variableManquante });
        return;
      }
      if (err instanceof PermisError) {
        res.status(502).json({ error: err.message });
        return;
      }
      throw err;
    }
    if (process.env["PERMIS_AFFICHER_PISTES_PRO"] === "true") {
      pistesProfessionnelles = permis.filter((p) => p.demandeurPersonneMorale);
    }
    informationsParticuliers = permis
      .filter((p) => !p.demandeurPersonneMorale)
      .map((p) => ({
        nomDemandeur: p.nomDemandeur,
        adresse: p.adresse,
        codePostal: p.codePostal,
        commune: p.commune,
        dateOctroi: p.dateOctroi,
        nature: p.nature,
        // L'ampleur des travaux. Sur un permis anonymisé, c'est ce qui
        // distingue une véranda d'une maison entière — donc ce qui décide
        // si le déplacement vaut la peine.
        superficieTerrain: p.superficieTerrain,
        // La source, PAR LIGNE.
        //
        // L'écran se rabattait jusqu'ici sur celle de la première piste
        // professionnelle — or ces pistes sont derrière
        // `PERMIS_AFFICHER_PISTES_PRO`, désactivé en production. Le repli
        // rendait donc une URL VIDE, et le panneau affichait un lien vers
        // nulle part sous le mot « Source ». Citer sa source est la seule
        // chose qui rend ce signal vérifiable : elle voyage avec la ligne.
        source: p.source,
      }));
  }

  res.json({
    pistesProfessionnelles,
    informationsParticuliers,
    avertissement:
      "Les permis de particuliers sont un SIGNAL DE CHANTIER — une adresse où des " +
      "travaux sont autorisés — jamais une piste à contacter à distance : aucun " +
      "téléphone, aucun e-mail, aucune action d'envoi n'est proposée pour eux. " +
      "La source les publie d'ailleurs ANONYMISÉS : le nom du demandeur particulier " +
      "n'y figure pas.",
    raisonSilence: raison,
    messageSilence: raison ? MESSAGES_SILENCE_ZONE[raison] : null,
  });
  };
}

router.get("/prospection/permis", creerRoutePermis());

// ── Conservation ─────────────────────────────────────────────────────────────

/**
 * Aperçu de la purge — EN LECTURE SEULE.
 *
 * La purge elle-même ne peut pas vivre ici : `contact_bases` est append-only,
 * `app_user` n'a pas le DELETE, et c'est voulu — le journal des bases légales
 * est ce qui tient le jour d'un contrôle. Donner le DELETE à `app_user` pour
 * faire tenir la purge dans une route aurait détruit l'append-only pour toutes
 * les autres écritures.
 *
 * La purge est donc une opération de PROPRIÉTAIRE :
 * `node lib/db/scripts/purger-prospection.mjs`. Même doctrine que la purge du
 * journal d'envois, confiée au propriétaire par la migration 009.
 *
 * Cette route dit COMBIEN de contacts seraient purgés, pour que l'écran puisse
 * l'annoncer sans mentir sur qui l'exécute.
 */
router.get("/prospection/purge/apercu", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const limite = new Date();
  limite.setDate(limite.getDate() - RETENTION_PROSPECTION_JOURS);
  const limiteMetier = toDateString(limite);

  const rows = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT count(*)::int AS n FROM contacts_prospection
       WHERE client_id IS NULL
         AND coalesce(derniere_interaction_le, created_at::date) < ${limiteMetier}::date
    `);
    return (r as unknown as { rows: Array<{ n: number }> }).rows;
  });

  res.json({
    aPurger: rows[0]?.n ?? 0,
    limite: limiteMetier,
    retentionJours: RETENTION_PROSPECTION_JOURS,
    commande: "node lib/db/scripts/purger-prospection.mjs",
  });
});

export default router;
