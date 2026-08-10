/**
 * Paramétrage de l'envoi et vérification DNS.
 *
 * Le résolveur DNS est INJECTABLE : les tests ne font aucune requête réseau, et
 * l'écran d'état est éprouvé sur des enregistrements construits à la main.
 *
 * Aucune valeur de fournisseur n'est écrite ici. La valeur `include:` du SPF
 * est COMMUNE à tous les tenants et vient de la configuration
 * (`EMAIL_SPF_INCLUDE`) ; le sélecteur DKIM et sa valeur sont PROPRES AU
 * DOMAINE et arrivent par ce paramétrage.
 */
import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { resolveTxt } from "node:dns/promises";
import { withTenant, parametresEnvoiTable, envoisJournalTable } from "@workspace/db";
import {
  verifierDomaine,
  enregistrementsAttendus,
  type EnregistrementsResolus,
  type ConfigurationDomaine,
} from "@nodaq/shared";

const router: IRouter = Router();

const DOMAINE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const ParametresBody = z.object({
  mode: z.enum(["domaine_authentifie", "repli_nodaq"]),
  domaine: z.string().regex(DOMAINE, "Domaine invalide").nullable().optional(),
  emailExpediteur: z.string().email().nullable().optional(),
  nomExpediteur: z.string().min(1).max(120).nullable().optional(),
  dkimSelecteur: z.string().max(60).nullable().optional(),
  dkimValeur: z.string().max(2000).nullable().optional(),
});

/**
 * Résolveur DNS. Injectable pour les tests — la signature ne fait aucune
 * hypothèse sur la source des enregistrements.
 */
export type ResolveurTxt = (nom: string) => Promise<string[][]>;

const resolveurParDefaut: ResolveurTxt = (nom) => resolveTxt(nom);

/** Résout tous les noms attendus, en tolérant les absences (NXDOMAIN). */
async function resoudre(
  noms: readonly string[],
  resolveur: ResolveurTxt,
): Promise<EnregistrementsResolus> {
  const resultat = new Map<string, readonly string[]>();
  await Promise.all(
    noms.map(async (nom) => {
      try {
        const enregistrements = await resolveur(nom);
        // resolveTxt rend des tableaux de morceaux : on les aplatit, le module
        // de vérification se charge de les recoller.
        resultat.set(nom, enregistrements.flat());
      } catch {
        // Nom absent ou non résolu : « rien de publié ». Distinct d'une erreur
        // serveur, et c'est exactement ce que l'artisan doit lire.
      }
    }),
  );
  return resultat;
}

/** La valeur `include:` du SPF — COMMUNE, jamais une constante de ce fichier. */
function spfInclude(): string | null {
  const v = process.env["EMAIL_SPF_INCLUDE"];
  return v && v.trim().length > 0 ? v.trim() : null;
}

// ── Lecture ───────────────────────────────────────────────────────────────────

router.get("/parametres-envoi", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const [params] = await withTenant(tenantId, (tx) =>
    tx.select().from(parametresEnvoiTable).where(eq(parametresEnvoiTable.tenantId, tenantId)),
  );

  const include = spfInclude();
  const enModeRepli = !params || params.mode === "repli_nodaq" || params.verifieLe === null;

  res.json({
    parametres: params ?? null,
    /** Absent de la configuration : la vérification ne peut pas être proposée. */
    spfIncludeConfigure: include !== null,
    /**
     * L'écran DOIT afficher cet avertissement en repli : un repli silencieux
     * ferait croire que tout va bien pendant que les devis tombent en
     * indésirables.
     */
    avertissementDelivrabilite: enModeRepli,
    messageAvertissement: enModeRepli
      ? "Vos documents partent depuis nodaq.fr, pas depuis votre domaine. Beaucoup de " +
        "messageries les classeront en indésirables. Authentifiez votre domaine pour que " +
        "vos devis arrivent."
      : null,
  });
});

// ── Écriture ──────────────────────────────────────────────────────────────────

router.put("/parametres-envoi", async (req, res): Promise<void> => {
  const parsed = ParametresBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const tenantId = req.tenantId!;

  if (d.mode === "domaine_authentifie" && (!d.domaine || !d.emailExpediteur)) {
    res.status(400).json({
      error: "Le mode domaine authentifié exige un domaine et une adresse d'expédition.",
    });
    return;
  }

  // L'adresse d'expédition doit appartenir au domaine déclaré : expédier
  // « martin@gmail.com » depuis un domaine authentifié « toituremartin.fr »
  // échouerait à l'alignement DMARC, sans message clair pour l'artisan.
  if (d.mode === "domaine_authentifie" && d.domaine && d.emailExpediteur) {
    const domaineAdresse = d.emailExpediteur.split("@")[1]?.toLowerCase();
    if (domaineAdresse !== d.domaine.toLowerCase()) {
      res.status(400).json({
        error: `L'adresse d'expédition doit appartenir au domaine « ${d.domaine} ».`,
      });
      return;
    }
  }

  const valeurs = {
    mode: d.mode,
    domaine: d.domaine ?? null,
    emailExpediteur: d.emailExpediteur ?? null,
    nomExpediteur: d.nomExpediteur ?? null,
    dkimSelecteur: d.dkimSelecteur ?? null,
    dkimValeur: d.dkimValeur ?? null,
    // Toute modification INVALIDE la vérification : changer de domaine ou de
    // sélecteur sans revérifier laisserait le produit expédier depuis une
    // configuration qui n'a jamais été contrôlée.
    verifieLe: null,
  };

  const [enregistre] = await withTenant(tenantId, async (tx) => {
    const [existant] = await tx
      .select()
      .from(parametresEnvoiTable)
      .where(eq(parametresEnvoiTable.tenantId, tenantId));
    if (existant) {
      return tx
        .update(parametresEnvoiTable)
        .set(valeurs)
        .where(eq(parametresEnvoiTable.id, existant.id))
        .returning();
    }
    return tx.insert(parametresEnvoiTable).values({ tenantId, ...valeurs }).returning();
  });

  res.json(enregistre);
});

// ── Vérification DNS ──────────────────────────────────────────────────────────

/**
 * POST /parametres-envoi/verifier
 *
 * Interroge réellement le DNS et rend l'état de CHAQUE enregistrement, avec ce
 * qu'il faut y mettre. Marque le domaine vérifié seulement si TOUT est
 * conforme.
 */
export function creerRouteVerification(
  resolveur: ResolveurTxt = resolveurParDefaut,
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.tenantId!;
    const include = spfInclude();
    if (include === null) {
      res.status(503).json({
        error:
          "EMAIL_SPF_INCLUDE n'est pas configurée : la vérification de domaine ne peut pas " +
          "être proposée tant que le service d'envoi n'est pas renseigné.",
      });
      return;
    }

    const [params] = await withTenant(tenantId, (tx) =>
      tx.select().from(parametresEnvoiTable).where(eq(parametresEnvoiTable.tenantId, tenantId)),
    );
    if (!params?.domaine) {
      res.status(400).json({ error: "Aucun domaine déclaré." });
      return;
    }

    const config: ConfigurationDomaine = {
      domaine: params.domaine,
      spfInclude: include,
      dkimSelecteur: params.dkimSelecteur,
      dkimValeur: params.dkimValeur,
    };

    const noms = enregistrementsAttendus(config).map((e) => e.nom);
    const resolus = await resoudre(noms, resolveur);
    const diagnostic = verifierDomaine(config, resolus);

    await withTenant(tenantId, (tx) =>
      tx
        .update(parametresEnvoiTable)
        .set({ verifieLe: diagnostic.conforme ? new Date() : null })
        .where(eq(parametresEnvoiTable.id, params.id)),
    );

    res.json(diagnostic);
  };
}

router.post("/parametres-envoi/verifier", creerRouteVerification());

// ── Journal ───────────────────────────────────────────────────────────────────

router.get("/parametres-envoi/journal", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const envois = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(envoisJournalTable)
      .orderBy(desc(envoisJournalTable.envoyeLe))
      .limit(200),
  );
  res.json({ envois, total: envois.length });
});

export default router;
