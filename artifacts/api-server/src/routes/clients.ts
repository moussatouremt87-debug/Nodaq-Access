/**
 * Fiches clients.
 *
 * L'entité qui manquait : le nom du client était du texte libre recopié
 * séparément sur l'affaire, le devis, la facture et le prospect. « M. Dupont »
 * ne désignait donc aucune entité, et rien ne pouvait se propager.
 *
 * ── Ce que cette route NE fait PAS ──────────────────────────────────────────
 * Elle ne réécrit AUCUN document. Renommer une fiche ne change pas le nom
 * imprimé sur une facture émise : le texte de la facture est un instantané,
 * `client_id` est le lien. Une facture dont l'écran contredirait le PDF archivé
 * ne serait plus une preuve.
 */
import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant, clientsTable, TYPES_CLIENT } from "@workspace/db";
import { normaliser } from "@nodaq/shared";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const ClientBody = z.object({
  nom: z.string().min(1, "Le nom est obligatoire").max(200),
  type: z.enum(TYPES_CLIENT).default("PARTICULIER"),
  email: z.string().email("Adresse e-mail invalide").nullable().optional(),
  telephone: z.string().max(40).nullable().optional(),
  adresse: z.string().max(300).nullable().optional(),
  codePostal: z.string().max(10).nullable().optional(),
  ville: z.string().max(120).nullable().optional(),
  siret: z.string().max(20).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  archive: z.boolean().optional(),
});

const ClientPatch = ClientBody.partial();

// ── Lecture ──────────────────────────────────────────────────────────────────

router.get("/clients", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const inclureArchives = req.query["archives"] === "true";

  const clients = await withTenant(tenantId, (tx) => {
    const q = tx.select().from(clientsTable);
    return inclureArchives
      ? q.orderBy(desc(clientsTable.createdAt))
      : q.where(eq(clientsTable.archive, false)).orderBy(desc(clientsTable.createdAt));
  });

  res.json({ clients, total: clients.length });
});

/**
 * Recherche par nom NORMALISÉ — accents et casse ignorés.
 *
 * La normalisation est celle de `rapprochementCatalogue.ts`, réutilisée telle
 * quelle : deux normalisations différentes dans le même produit finiraient par
 * diverger, et « Génin » ne trouverait plus « GENIN » que dans un écran sur
 * deux.
 *
 * Le filtrage se fait en mémoire, après lecture : une TPE a quelques centaines
 * de fiches, et cela évite d'imposer une extension PostgreSQL pour un besoin
 * que le volume ne justifie pas. Écrit ici pour que le jour où le volume
 * change, on sache quoi remplacer.
 */
router.get("/clients/rechercher", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const parsed = z.object({ q: z.string().min(1).max(200) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Paramètre « q » obligatoire." }); return; }

  const cible = normaliser(parsed.data.q);
  const clients = await withTenant(tenantId, (tx) =>
    tx.select().from(clientsTable).where(eq(clientsTable.archive, false)),
  );

  const resultats = clients.filter((c) => normaliser(c.nom).includes(cible));
  res.json({ clients: resultats, total: resultats.length });
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [client] = await withTenant(tenantId, (tx) =>
    tx.select().from(clientsTable).where(eq(clientsTable.id, id!)),
  );
  if (!client) { res.status(404).json({ error: "Client introuvable" }); return; }
  res.json(client);
});

// ── Écriture ─────────────────────────────────────────────────────────────────

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = ClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;
  const d = parsed.data;

  // Aucun contrôle d'unicité sur le nom : deux Dupont existent, et c'est le cas
  // ordinaire dans une commune.
  const [cree] = await withTenant(tenantId, (tx) =>
    tx.insert(clientsTable).values({ tenantId, ...d }).returning(),
  );
  res.status(201).json(cree);
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const parsed = ClientPatch.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;
  const { id } = req.params;

  const [maj] = await withTenant(tenantId, (tx) =>
    tx.update(clientsTable).set(parsed.data).where(eq(clientsTable.id, id!)).returning(),
  );
  if (!maj) { res.status(404).json({ error: "Client introuvable" }); return; }
  res.json(maj);
});

/**
 * Archivage plutôt que suppression.
 *
 * Une fiche référencée par une facture émise ne peut pas disparaître : la clé
 * étrangère l'interdirait, et si elle ne l'interdisait pas ce serait pire — le
 * document perdrait son lien sans qu'on le sache.
 */
router.delete("/clients/:id", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const { id } = req.params;
  const [archive] = await withTenant(tenantId, (tx) =>
    tx
      .update(clientsTable)
      .set({ archive: true })
      .where(and(eq(clientsTable.id, id!), eq(clientsTable.archive, false)))
      .returning(),
  );
  if (!archive) { res.status(404).json({ error: "Client introuvable" }); return; }
  res.status(204).send();
});

export default router;
