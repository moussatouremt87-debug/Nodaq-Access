import type { Vertical } from "./verticalPacks.js";

/*
 * Module catalog (ticket 3.11) — same doctrine as the other versioned
 * configs (2.19/3.7/3.9): which business modules exist, which agent tools
 * they carry, and their PER-VERTICAL defaults are ONE dated config. A pure
 * resolver derives the effective state: vertical default, overridden by the
 * owner's explicit choices — every state carries its source, a module never
 * (dis)appears without an explanation. The core surface (cockpit, chat,
 * validation queue, connectors, notifications) is NOT a module and can
 * never be turned off. Deactivating a module hides its pages AND removes
 * its agent tools from the toolset; the API routes stay (authorization is
 * unchanged — this is product surface, not a security boundary).
 *
 * PIVOT (ADR-007) — ce catalogue porte désormais la frontière du produit.
 *
 * nodaq devient l'assistant opérationnel quotidien des TPE à l'affaire. Les
 * modules de l'ancienne direction (co-pilote financier) sont mis HORS SOCLE :
 * `defaultOn: "aucun"`. Ils ne sont ni supprimés ni cassés — leur code, leurs
 * routes et leurs tests restent en place, et un owner les réactive en un clic.
 *
 * C'est un choix réversible, et c'est le seul mécanisme d'extinction autorisé :
 * supprimer le code rendrait la décision irréversible, casserait la CI, et
 * détruirait un actif. Un module hors socle porte la source `hors_socle` —
 * « désactivé par défaut du vertical » serait faux quand il l'est partout.
 */

/**
 * Catalog snapshot date — bump on every module/defaults change.
 *
 * A `.N` suffix disambiguates two changes landing on the SAME day (4.1 added
 * `affaires`, F5 added `brief`, both on 2026-08-03). Reusing the date would
 * hide the second change; dating it tomorrow would claim a snapshot that does
 * not exist yet. The suffix keeps the value sortable and honest.
 */
export const MODULE_CATALOG_VERSION = "2026-08-18";

export interface ModuleDefinition {
  id: string;
  title: string;
  /** French, shown in the settings page. */
  description: string;
  /** Web page prefix (nav filtering). Absent = no page of its own (the
   * module only carries agent tools or a cockpit card). */
  href?: string;
  /** Agent tools removed from the toolset when the module is off. */
  tools: readonly string[];
  /**
   * Verticals where the module is ON by default.
   * - `"tous"` : socle du produit, actif partout ;
   * - `"aucun"` : HORS SOCLE (pivot ADR-007) — éteint partout, réactivable ;
   * - liste : défaut par vertical.
   */
  defaultOn: "tous" | "aucun" | readonly Vertical[];
}

export const MODULES: readonly ModuleDefinition[] = [
  // ── SOCLE — l'assistant opérationnel quotidien ──────────────────────────
  {
    id: "brief",
    title: "Brief du matin",
    description:
      "Ce qui a changé et ce qui vous attend, en trois lignes — assemblé à partir des " +
      "écrans existants, sans rien recalculer.",
    href: "/brief",
    tools: [],
    // Socle : c'est le premier écran de la journée. Il n'affiche que ce que
    // les autres modules produisent, donc l'allumer n'impose rien.
    defaultOn: "tous",
  },
  {
    id: "affaires",
    title: "Affaires",
    description:
      "Chantiers, événements, interventions, missions : les pièces s'y rattachent, " +
      "et la marge se lit pendant que le travail est en cours. Le mot affiché vient " +
      "du vertical.",
    href: "/affaires",
    tools: [],
    // Pivot ADR-007 : l'affaire est le PIVOT du produit, pas une option. Elle
    // est donc au socle — et comme tout rattachement est nullable, l'allumer
    // ne change rien pour un tenant qui ne s'en sert pas : il voit une page de
    // plus, jamais une saisie de plus.
    defaultOn: "tous",
  },
  {
    id: "classeur",
    title: "Classeur photo",
    description: "Classement photo des documents, extraction et rapprochement bancaire.",
    href: "/classeur",
    tools: [],
    defaultOn: "tous",
  },
  {
    id: "rh",
    title: "Équipe & plannings",
    description: "Équipe, absences, plannings capacité vs charge, performance horaire.",
    // `/rh` ne routait rien : l'écran s'appelle `/equipe` depuis toujours.
    href: "/equipe",
    // `plan_staffing` et `analyze_hourly_performance` n'existent pas côté
    // serveur. Les déclarer laissait croire qu'éteindre ce module retirait
    // des outils à l'agent, ce qui n'a jamais été le cas.
    tools: [],
    defaultOn: "tous",
  },

  // ── HORS SOCLE (pivot ADR-007) — éteint par défaut, jamais supprimé ────
  {
    id: "facturation_electronique",
    title: "Facturation électronique",
    description:
      "Factur-X, dépôt en plateforme agréée (PDP) et e-reporting — obligation " +
      "de septembre 2027 pour les TPE/PME (voir US-A2.6).",
    // `/factures` était FAUX, et dangereusement : ce module éteint par défaut
    // aurait fait disparaître l'écran Factures — le socle du produit — chez
    // tous les tenants le jour où quelqu'un aurait branché le filtrage. La
    // page de ce module est `/facturation-electronique`, et elle existe.
    href: "/facturation-electronique",
    tools: [],
    // Reste « aucun » : l'obligation n'entre en vigueur qu'en septembre 2027,
    // et `auditEmissionElectronique` ne bloque rien avant cette date. Un
    // owner qui s'y prépare l'allume. C'est une décision, pas un oubli.
    defaultOn: "aucun",
  },

  // ── Ce qui a été RETIRÉ de ce catalogue, et pourquoi ───────────────────
  // stocks, immobilisations, reglementaire, avis, rgpd, prevision_ventes,
  // signaux_clients, silae.
  //
  // Le pivot ADR-007 les avait mis « hors socle » plutôt que supprimés, au
  // motif qu'« un module éteint garde son code, ses routes et ses tests, et
  // qu'un owner le réactive en un clic ». Cette doctrine est juste — mais
  // elle suppose qu'il y ait du code derrière. Vérification faite : les six
  // pages annoncées (/stocks, /immobilisations, /reglementaire, /avis,
  // /rgpd, et /rh) n'existent dans AUCUNE route, et les treize outils cités
  // n'existent nulle part côté serveur. Il n'y avait rien à réactiver.
  //
  // Un catalogue qui décrit un produit inexistant est pire qu'un catalogue
  // incomplet : il rend `resolveModules` inutilisable — le brancher aurait
  // masqué l'écran Factures chez tous les tenants (le module
  // `facturation_electronique` déclarait `href: "/factures"` et un défaut
  // « aucun »), sans masquer une seule page réelle ni retirer un seul outil.
  // C'est très probablement pourquoi personne ne l'a jamais appelé.
  //
  // Les gardes de parité (`artifacts/nodaq/src/lib/modules-parite.test.ts` et
  // `artifacts/api-server/src/__tests__/modules-outils-parite.test.ts`)
  // empêchent désormais un module de déclarer une page ou un outil qui
  // n'existe pas.
] as const;

export interface ResolvedModule {
  id: string;
  title: string;
  description: string;
  href?: string;
  tools: readonly string[];
  active: boolean;
  /** Where the state comes from — explainability, 3.11 doctrine.
   * `hors_socle` : éteint par le pivot (ADR-007), réactivable en un clic —
   * le dire « défaut du vertical » serait faux quand c'est vrai partout. */
  source: "defaut_vertical" | "hors_socle" | "choix";
}

/**
 * Effective module states for a tenant: per-vertical default, overridden by
 * the owner's explicit choices. Unknown or non-boolean overrides are
 * IGNORED (never an exception, never a phantom module).
 */
export function resolveModules(
  vertical: Vertical,
  overrides: Record<string, unknown>,
): ResolvedModule[] {
  return MODULES.map((module) => {
    const outOfCore = module.defaultOn === "aucun";
    const byDefault =
      module.defaultOn === "tous" ||
      (module.defaultOn !== "aucun" && module.defaultOn.includes(vertical));
    const override = overrides[module.id];
    const hasOverride = typeof override === "boolean";
    return {
      id: module.id,
      title: module.title,
      description: module.description,
      // `exactOptionalPropertyTypes` : une clé `href: undefined` n'est PAS la
      // même chose qu'une clé absente — un module sans page n'en a pas.
      ...(module.href !== undefined ? { href: module.href } : {}),
      tools: module.tools,
      active: hasOverride ? override : byDefault,
      source: hasOverride ? "choix" : outOfCore ? "hors_socle" : "defaut_vertical",
    };
  });
}

/** Tools to strip from a toolset given the resolved modules. */
export function inactiveModuleTools(resolved: ResolvedModule[]): Set<string> {
  const tools = new Set<string>();
  for (const module of resolved) {
    if (!module.active) {
      for (const tool of module.tools) tools.add(tool);
    }
  }
  return tools;
}
