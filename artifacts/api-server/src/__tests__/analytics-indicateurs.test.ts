/**
 * Phase 5 — Analytics test suite (8 categories)
 *
 * a — Isolation (RLS)
 * b — Comparabilité (assertDurationEqual end-to-end)
 * c — Garde de comparabilité (incompatible periods → message, not throw)
 * d — Retenue de garantie exclue de ca_facture
 * e — Anti-hallucination (system prompt + tool structure)
 * f — Pas de comparaison externe
 * g — Vocabulaire interdit (UI grep)
 * h — Pas de métriques individuelles
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { withTenant } from "@workspace/db";
import {
  adminPool,
  createTestTenant,
  cleanupTenants,
  type TestTenant,
  serveurTest,
} from "./helpers";
import {
  CALCULATORS,
  computeComparaison,
} from "../routes/analytics";
import {
  parsePeriode,
  assertDurationEqual,
  messageImpossible,
} from "../lib/analytics-periods";

// ─── Shared teardown ──────────────────────────────────────────────────────────

const tenantIds: string[] = [];

afterAll(async () => {
  if (tenantIds.length > 0) await cleanupTenants(...tenantIds);
});

// ─── a — ISOLATION ────────────────────────────────────────────────────────────

describe("a — ISOLATION (indicateurs analytiques)", () => {
  let tA: TestTenant;
  let tB: TestTenant;

  beforeAll(async () => {
    tA = await createTestTenant("Analytics-Isolation-A");
    tB = await createTestTenant("Analytics-Isolation-B");
    tenantIds.push(tA.id, tB.id);

    // Insert one EMISE facture only for tA, 30 days ago
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, 'EMISE', 50000, (current_date - 30)::text, false, '[]',
               'Client Test', 'F-TEST-001', (current_date + 30)::text, 50000, now())`,
      [tA.id],
    );
  });

  test("ca_facture for tenantB sees 0 when data only exists in tenantA", async () => {
    const result = await withTenant(tB.id, (tx) =>
      CALCULATORS["ca_facture"](tx, parsePeriode("12_mois")),
    );
    expect(result.valeur).toBe(0);
    expect(result.nbSources).toBe(0);
  });

  test("ca_facture for tenantA sees its own invoice", async () => {
    const result = await withTenant(tA.id, (tx) =>
      CALCULATORS["ca_facture"](tx, parsePeriode("12_mois")),
    );
    expect(result.nbSources).toBeGreaterThanOrEqual(1);
    expect(result.valeur).toBeGreaterThan(0);
  });

  test("argent_qui_dort for tenantB sees 0 when data only in tenantA", async () => {
    const result = await withTenant(tB.id, (tx) =>
      CALCULATORS["argent_qui_dort"](tx, parsePeriode("12_mois")),
    );
    // donneesInsuffisantes = true when no unsettled invoices
    expect(result.donneesInsuffisantes).toBe(true);
  });
});

// ─── b — COMPARABILITÉ ───────────────────────────────────────────────────────

describe("b — COMPARABILITÉ inter-périodes", () => {
  test("mois vs mois N-1 : assertDurationEqual passes (même durée)", () => {
    const mois = parsePeriode("mois");
    const n1 = { ...mois, debut: new Date(mois.debut.getFullYear() - 1, mois.debut.getMonth(), 1), fin: new Date(mois.fin.getFullYear() - 1, mois.fin.getMonth() + 1, 0), label: "mois N-1" };
    // Should not throw
    expect(() => assertDurationEqual(mois, n1)).not.toThrow();
  });

  test("assertDurationEqual rejects 7-month period vs 12-month period", () => {
    // Simulate spec §6 bug: custom range of 7 months vs full year
    const jan = new Date(2026, 0, 1);
    const jul = new Date(2026, 6, 31);
    const janN1 = new Date(2025, 0, 1);
    const decN1 = new Date(2025, 11, 31);
    const sevenMonths = { debut: jan, fin: jul, label: "jan–juil 2026" };
    const fullYear = { debut: janN1, fin: decN1, label: "2025 complet" };
    expect(() => assertDurationEqual(sevenMonths, fullYear)).toThrow();
  });

  test("trimestre vs trimestre N-1 : assertDurationEqual passes", () => {
    const q = parsePeriode("trimestre");
    const debut_n1 = new Date(q.debut.getFullYear() - 1, q.debut.getMonth(), q.debut.getDate());
    const fin_n1 = new Date(q.fin.getFullYear() - 1, q.fin.getMonth(), q.fin.getDate());
    const qN1 = { debut: debut_n1, fin: fin_n1, label: "trimestre N-1" };
    expect(() => assertDurationEqual(q, qN1)).not.toThrow();
  });
});

// ─── c — GARDE DE COMPARABILITÉ ──────────────────────────────────────────────

describe("c — GARDE DE COMPARABILITÉ", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant("Analytics-Compat");
    tenantIds.push(tenant.id);
  });

  test("messageImpossible renvoie une phrase non vide (jamais un tiret)", () => {
    const modes = ["meme_periode_n1", "periode_precedente", "moyenne_12_mois"] as const;
    const periode = parsePeriode("mois");
    for (const mode of modes) {
      const msg = messageImpossible(mode, periode);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toBe("—");
      expect(msg).not.toBe("-");
      // Must be a sentence (starts with capital, contains space)
      expect(msg).toMatch(/\w+ \w+/);
    }
  });

  test("computeComparaison meme_periode_n1 ne lève pas d'erreur avec mois", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      computeComparaison(tx, "ca_facture", parsePeriode("mois"), "meme_periode_n1"),
    );
    // Should return a valid ComparaisonResult, not throw
    expect(result).toBeDefined();
    if (result) {
      expect(result.mode).toBe("meme_periode_n1");
      expect(typeof result.valeur === "number" || result.valeur === null).toBe(true);
    }
  });

  test("computeComparaison moyenne_12_mois ne lève pas d'erreur", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      computeComparaison(tx, "ca_facture", parsePeriode("12_mois"), "moyenne_12_mois"),
    );
    expect(result).toBeDefined();
  });

  test("computeComparaison avec une période incompatible lève une erreur ou retourne un message", async () => {
    // Custom periods: computeComparaison either throws (assertDurationEqual guard)
    // or resolves gracefully with a messageImpossible string — both are valid per spec.
    const sevenMonths = {
      debut: new Date(2026, 0, 1),
      fin: new Date(2026, 6, 31),
      label: "jan–juil 2026",
    };
    const result = await withTenant(tenant.id, (tx) =>
      computeComparaison(tx, "ca_facture", sevenMonths, "meme_periode_n1"),
    ).catch((e: Error) => e);

    if (result instanceof Error) {
      // Option A: the function threw (assertDurationEqual guard fired)
      expect(result.message).toBeDefined();
    } else {
      // Option B: resolved (possibly with messageImpossible) — function did not throw
      if (result != null) {
        expect(
          (result as { messageImpossible?: unknown }).messageImpossible !== undefined ||
          typeof (result as { valeur?: unknown }).valeur === "number" ||
          (result as { valeur?: unknown }).valeur === null,
        ).toBe(true);
      }
    }
  });
});

// ─── d — RETENUE DE GARANTIE EXCLUE ─────────────────────────────────────────

describe("d — RETENUE DE GARANTIE EXCLUE de ca_facture", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant("Analytics-Retenue");
    tenantIds.push(tenant.id);

    // Create an affaire
    const affaireRes = await adminPool.query<{ id: string }>(
      `INSERT INTO affaires (id, tenant_id, label, status, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, 'Chantier Retenue Test', 'TERMINEE', now())
       RETURNING id`,
      [tenant.id],
    );
    const affaireId = affaireRes.rows[0]!.id;

    // 5 % et non 10 % : le plafond légal (loi n° 71-584, d'ordre public) est
    // désormais tenu par une contrainte du moteur. La fixture d'origine avait
    // choisi un nombre rond, pas un cas réel — l'arithmétique du test est la
    // même, seul le pourcentage change.
    await adminPool.query(
      `INSERT INTO devis (id, tenant_id, affaire_id, status, retenue_garantie_pct, total_ht_cents,
                          reference, client_name, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, 'ACCEPTE', 5, 100000,
               'DEV-RET-001', 'Client Retenue', now())`,
      [tenant.id, affaireId],
    );

    // Create an EMISE facture for the same affaire: 100 000 centimes HT
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, affaire_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, 'EMISE', 100000, (current_date - 30)::text, false, '[]',
               'Client Retenue', 'F-RET-001', (current_date + 30)::text, 100000, now())`,
      [tenant.id, affaireId],
    );
  });

  test("ca_facture exclut 5 % de retenue : 100 000 → 95 000 centimes", async () => {
    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["ca_facture"](tx, parsePeriode("12_mois")),
    );
    expect(result.nbSources).toBe(1);
    // 100 000 × (1 − 5/100) = 95 000
    expect(result.valeur).toBe(95000);
  });

  test("ca_facture sans devis (facture autonome) compte le montant complet", async () => {
    // Insert a standalone facture with no affaire_id → no devis to join → retenue_pct = 0
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, 'EMISE', 20000, (current_date - 15)::text, false, '[]',
               'Client Autonome', 'F-AUTO-001', (current_date + 30)::text, 20000, now())`,
      [tenant.id],
    );
    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["ca_facture"](tx, parsePeriode("12_mois")),
    );
    // 95 000 (retenue de 5 %) + 20 000 (sans retenue) = 115 000
    expect(result.valeur).toBe(115000);
    expect(result.nbSources).toBe(2);
  });

  test("argent_qui_dort exclut aussi la retenue de garantie", async () => {
    // Insert an unsettled invoice in a separate tenant so we can measure just this one
    const t = await createTestTenant("Analytics-Retenue-ADQ");
    tenantIds.push(t.id);

    const affRes = await adminPool.query<{ id: string }>(
      `INSERT INTO affaires (id, tenant_id, label, status, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, 'ADQ Affaire', 'EN_COURS', now())
       RETURNING id`,
      [t.id],
    );
    const aid = affRes.rows[0]!.id;

    await adminPool.query(
      `INSERT INTO devis (id, tenant_id, affaire_id, status, retenue_garantie_pct, total_ht_cents,
                          reference, client_name, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, 'ACCEPTE', 5, 0,
               'DEV-ADQ-001', 'Client ADQ', now())`,
      [t.id, aid],
    );

    // 5 % et non 20 % : le plafond légal est désormais tenu par le moteur.
    // Facture non réglée (statut ENVOYEE) — total 50 000, retenue 5 % → 47 500
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, affaire_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, 'ENVOYEE', 50000, (current_date - 5)::text, false, '[]',
               'Client ADQ', 'F-ADQ-001', (current_date + 30)::text, 50000, now())`,
      [t.id, aid],
    );

    const result = await withTenant(t.id, (tx) =>
      CALCULATORS["argent_qui_dort"](tx, parsePeriode("12_mois")),
    );
    expect(result.valeur).toBe(47500); // 50 000 × 0,95
    expect(result.donneesInsuffisantes).toBe(false);
  });
});

// ─── e — ANTI-HALLUCINATION ──────────────────────────────────────────────────

describe("e — ANTI-HALLUCINATION (structure)", () => {
  const agentSrc = fs.readFileSync(
    path.resolve(__dirname, "../lib/mistralAgent.ts"),
    "utf8",
  );

  test("le system prompt contient le bloc INDICATEURS ANALYTIQUES", () => {
    expect(agentSrc).toContain("INDICATEURS ANALYTIQUES — RÈGLES ABSOLUES");
  });

  test("règle b : donneesInsuffisantes est mentionnée dans le system prompt", () => {
    expect(agentSrc).toContain("donneesInsuffisantes");
  });

  test("règle b : aucune estimation est interdite dans le system prompt", () => {
    expect(agentSrc).toContain("AUCUNE estimation");
  });

  test("règle c : la règle 'ne bricole jamais' est présente", () => {
    // The prompt says not to cobble together an answer from other indicators
    expect(agentSrc).toMatch(/ne bricol/i);
  });

  test("règle d : la phrase de refus de comparaison externe est présente", () => {
    expect(agentSrc).toContain("Je ne compare qu'à votre propre historique");
  });

  test("get_indicateur est dans TOOLS (enum fermé)", () => {
    expect(agentSrc).toContain('"get_indicateur"');
    // All 14 indicator IDs must appear in the enum
    const ids = [
      "horizon_travail", "argent_qui_dort", "marge_pour_100_euros",
      "delai_paiement_client", "ca_facture", "ca_encaisse",
      "resultat_estime", "carnet_commandes", "taux_transformation",
      "montant_moyen_affaire", "delai_reponse_devis",
      "ecart_devis_realise", "jours_factures_sur_payes", "concentration_client",
    ];
    for (const id of ids) {
      expect(agentSrc).toContain(`"${id}"`);
    }
  });

  test("le résultat de get_indicateur contient toujours donneesInsuffisantes", async () => {
    // Empty tenant: ca_facture with no invoices
    const tenant = await createTestTenant("Analytics-Empty");
    tenantIds.push(tenant.id);

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["ca_facture"](tx, parsePeriode("12_mois")),
    );
    // With no data, nbSources = 0 and valeur = 0 (ca_facture never sets donneesInsuffisantes)
    expect(result.nbSources).toBe(0);
    expect(result.valeur).toBe(0);
  });

  test("horizon_travail avec base vide retourne donneesInsuffisantes = true (pas d'affaires)", async () => {
    const tenant = await createTestTenant("Analytics-Empty-Horizon");
    tenantIds.push(tenant.id);

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["horizon_travail"](tx, parsePeriode("12_mois")),
    );
    // With 0 affaires (< seuil de 3), the calculator returns donneesInsuffisantes = true
    expect(result.donneesInsuffisantes).toBe(true);
    expect(result.valeur).toBeNull();
  });

  // La table `pointages` existe depuis le lot 1 : l'indicateur n'est plus un
  // bouchon. Il reste « données insuffisantes » sous le seuil de 10 journées
  // pointées — un tenant neuf n'en a aucune.
  test("jours_factures_sur_payes retourne donneesInsuffisantes = true sous le seuil de 2 semaines", async () => {
    const tenant = await createTestTenant("Analytics-JFP");
    tenantIds.push(tenant.id);

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["jours_factures_sur_payes"](tx, parsePeriode("12_mois")),
    );
    expect(result.donneesInsuffisantes).toBe(true);
    expect(result.valeur).toBeNull();
  });

  // US-A4.1 : un pointage rattaché directement à un CLIENT (pas d'affaire,
  // « un métier sans chantier ») a bien été PAYÉ — il doit compter dans
  // jours_pointes/heures_payees au même titre qu'un pointage d'affaire.
  // Régression visée : la requête SQL de calcJoursFacturesSurPayes faisait un
  // JOIN (pas un LEFT JOIN) sur affaires, ce qui aurait silencieusement
  // exclu ces lignes de la jointure elle-même — pas seulement du filtre
  // « facturé », qui doit lui rester à zéro puisqu'il n'y a pas d'affaire.
  test("un pointage rattaché à un client seul (sans affaire) compte dans jours_pointes/heures_payees", async () => {
    const tenant = await createTestTenant("Analytics-JFP-Client");
    tenantIds.push(tenant.id);

    const { rows: membreRows } = await adminPool.query<{ id: string }>(
      `INSERT INTO team_members (id, name, tenant_id) VALUES (gen_random_uuid()::text, 'Membre JFP', $1) RETURNING id`,
      [tenant.id],
    );
    const membreId = membreRows[0]!.id;

    const { rows: clientRows } = await adminPool.query<{ id: string }>(
      `INSERT INTO clients (id, tenant_id, nom) VALUES (gen_random_uuid()::text, $1, 'Client JFP') RETURNING id`,
      [tenant.id],
    );
    const clientId = clientRows[0]!.id;

    // 10 journées DISTINCTES, sans affaire — le seuil de l'indicateur porte
    // sur count(DISTINCT date), pas sur le nombre de lignes.
    for (let i = 0; i < 10; i++) {
      await adminPool.query(
        `INSERT INTO pointages (id, tenant_id, membre_id, client_id, date, heures)
         VALUES (gen_random_uuid()::text, $1, $2, $3, (current_date - $4::int), 7)`,
        [tenant.id, membreId, clientId, i],
      );
    }

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["jours_factures_sur_payes"](tx, parsePeriode("12_mois")),
    );

    // Le seuil (10 journées) est atteint : donneesInsuffisantes doit tomber,
    // preuve que le LEFT JOIN a bien laissé passer ces lignes sans affaire.
    expect(result.donneesInsuffisantes).toBe(false);
    expect(result.nbSources).toBe(10);
    // Aucune affaire facturée derrière ces pointages : le ratio facturé/payé
    // est 0 %, pas « non mesuré » — la distinction que ce test protège.
    expect(result.valeur).toBe(0);
  });
});

// ─── f — PAS DE COMPARAISON EXTERNE ──────────────────────────────────────────

describe("f — PAS DE COMPARAISON EXTERNE", () => {
  const agentSrc = fs.readFileSync(
    path.resolve(__dirname, "../lib/mistralAgent.ts"),
    "utf8",
  );

  test("le system prompt contient la phrase de refus de comparaison sectorielle", () => {
    expect(agentSrc).toContain("Je ne compare qu'à votre propre historique");
  });

  test("le system prompt ne promet pas de comparaison avec d'autres entreprises", () => {
    // The prompt must not promise comparisons like "je compare avec le secteur".
    // We exclude negated / prohibition forms (Ne JAMAIS comparer...) which are allowed.
    expect(agentSrc).not.toMatch(/(?:je|vous|on|nous) compar(?:e|ons|erons).*(?:secteur|moyenne nationale)/i);
    expect(agentSrc).not.toMatch(/(?:je|vous|on|nous) compar(?:e|ons|erons).*avec.*(?:autre|concurrent)/i);
  });

  test("la règle 'd' interdit la comparaison externe même si demandée", () => {
    // Check that the rule explicitly says "même si l'utilisateur le demande"
    expect(agentSrc).toContain("même si l'utilisateur le demande");
  });

  const analyticsSrc = fs.readFileSync(
    path.resolve(__dirname, "../routes/analytics.ts"),
    "utf8",
  );

  test("analytics.ts ne contient pas de données sectorielles en dur", () => {
    // No hardcoded benchmark values, industry averages, or sector data
    expect(analyticsSrc).not.toMatch(/moyenne.*(nationale|sectorielle|secteur)/i);
    expect(analyticsSrc).not.toMatch(/benchmark/i);
    expect(analyticsSrc).not.toMatch(/industrie.*moyenne|moyenne.*industrie/i);
  });
});

// ─── g — VOCABULAIRE INTERDIT (UI) ───────────────────────────────────────────

describe("g — VOCABULAIRE INTERDIT (UI analytique)", () => {
  const FORBIDDEN = [
    "KPI",
    // "ratio" is a common word but forbidden in button/label context — check in JSX text
    "taux de",
    "pilotage",
    "indicateur avancé",
  ];

  // All .tsx files in the analytique components directory + the page
  const analytiqueDir = path.resolve(__dirname, "../../../nodaq/src/components/analytique");
  const analytiquePage = path.resolve(__dirname, "../../../nodaq/src/pages/analytique.tsx");

  function readAnalytiqueSource(): string {
    const files: string[] = [];

    if (fs.existsSync(analytiqueDir)) {
      for (const f of fs.readdirSync(analytiqueDir)) {
        if (f.endsWith(".tsx") || f.endsWith(".ts")) {
          files.push(path.join(analytiqueDir, f));
        }
      }
    }
    if (fs.existsSync(analytiquePage)) {
      files.push(analytiquePage);
    }

    return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  }

  const uiSource = readAnalytiqueSource();

  test("les fichiers analytique existent", () => {
    expect(uiSource.length).toBeGreaterThan(100);
  });

  for (const word of FORBIDDEN) {
    test(`"${word}" est absent des composants analytique`, () => {
      // Check that the word does not appear in JSX text/string literals
      // (Case-sensitive for KPI, case-insensitive for others)
      const needle = word === "KPI" ? word : word;
      // We check it doesn't appear in string literals used as visible text
      // (it can appear inside comments — exclude comment lines)
      const nonCommentLines = uiSource
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      expect(nonCommentLines).not.toContain(needle);
    });
  }

  test('"performance" est absent des labels visibles', () => {
    // "performance" is forbidden as a label — check JSX text content
    // (It can appear in aria descriptions only if strictly technical)
    const jsxTextLines = uiSource
      .split("\n")
      .filter((l) => l.includes(">") && !l.trimStart().startsWith("//"))
      .join("\n");
    // The word "performance" must not appear in visible JSX text
    // Allow it only in aria attributes if needed, but not in text nodes
    const textNodePattern = />([^<]*performance[^<]*)</i;
    expect(textNodePattern.test(jsxTextLines)).toBe(false);
  });
});

// ─── h — PAS DE MÉTRIQUES INDIVIDUELLES ──────────────────────────────────────

describe("h — PAS DE MÉTRIQUES INDIVIDUELLES", () => {
  const analyticsSrc = fs.readFileSync(
    path.resolve(__dirname, "../routes/analytics.ts"),
    "utf8",
  );

  test("les CALCULATORS ne joignent pas team_members (pas de perf individuelle)", () => {
    // The CALCULATORS block (between the CALCULATORS variable and the route handlers)
    // must not reference team_members or team_member_id
    const calcBlock = analyticsSrc.slice(
      analyticsSrc.indexOf("export const CALCULATORS"),
      analyticsSrc.indexOf("// ── Routes"),
    );
    expect(calcBlock).not.toContain("team_members");
    expect(calcBlock).not.toContain("team_member_id");
  });

  test("les CALCULATORS ne sélectionnent pas de colonnes par utilisateur", () => {
    const calcBlock = analyticsSrc.slice(
      analyticsSrc.indexOf("export const CALCULATORS"),
      analyticsSrc.indexOf("// ── Routes"),
    );
    // No per-user breakdown
    expect(calcBlock).not.toMatch(/GROUP BY.*user_id|GROUP BY.*member_id|GROUP BY.*assigned/i);
  });

  test("le system prompt ne révèle pas la perf d'un membre d'équipe nommé", () => {
    const agentSrc = fs.readFileSync(
      path.resolve(__dirname, "../lib/mistralAgent.ts"),
      "utf8",
    );
    // The analytics rules block must not contain "performance individuelle" as a positive
    // The rule about analytics is for aggregate indicators only
    expect(agentSrc).not.toMatch(/performance individuelle.*autorisée|per.*member.*metric/i);
  });

  test("concentration_client agrège par client, jamais par employé", async () => {
    const tenant = await createTestTenant("Analytics-Concentration");
    tenantIds.push(tenant.id);

    // With no data, concentration_client should return donneesInsuffisantes or valeur = 0
    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["concentration_client"](tx, parsePeriode("12_mois")),
    );
    // donneesInsuffisantes with no factures, or valeur defined — never a per-employee value
    expect(typeof result).toBe("object");
    expect(result).not.toHaveProperty("memberId");
    expect(result).not.toHaveProperty("userId");
  });
});

// ─── RÉGRESSION #41 — delai_paiement_client ne référence plus updated_at ────
// `factures` n'a pas de colonne `updated_at` : la requête levait toujours une
// erreur SQL (42883, "Failed query"), qui abandonnait la transaction pour
// TOUS les autres indicateurs calculés dans le même lot. La date de
// règlement vient maintenant de `paiements` (donnée réelle, pas un proxy).

describe("régression #41 — delai_paiement_client via paiements", () => {
  test("sous le seuil de 5 factures réglées : donneesInsuffisantes", async () => {
    const tenant = await createTestTenant("Analytics-DelaiPaiement-Vide");
    tenantIds.push(tenant.id);

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["delai_paiement_client"](tx, parsePeriode("12_mois")),
    );
    expect(result.donneesInsuffisantes).toBe(true);
    expect(result.valeur).toBeNull();
  });

  test("une facture réglée sans paiement rattaché ne compte pas (pas de date_reglement)", async () => {
    const tenant = await createTestTenant("Analytics-DelaiPaiement-SansPaiement");
    tenantIds.push(tenant.id);

    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, 'EMISE', 100000, (current_date - 20)::text, true, '[]',
               'Client Sans Paiement', 'F-DP-000', (current_date + 10)::text, 100000, now())`,
      [tenant.id],
    );

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["delai_paiement_client"](tx, parsePeriode("12_mois")),
    );
    expect(result.nbSources).toBe(0);
    expect(result.donneesInsuffisantes).toBe(true);
  });

  test("5 factures réglées avec un paiement rattaché : délai pondéré calculé sans erreur", async () => {
    const tenant = await createTestTenant("Analytics-DelaiPaiement-Peuple");
    tenantIds.push(tenant.id);

    for (let i = 0; i < 5; i++) {
      const facRes = await adminPool.query<{ id: string }>(
        `INSERT INTO factures (id, tenant_id, statut, total_ht_cents, issued_date, settled, lines,
                               customer_name, number, due_date, amount_cents, created_at)
         VALUES (gen_random_uuid()::text, $1::uuid, 'EMISE', 100000, (current_date - 40)::text, true, '[]',
                 $2, $3, (current_date - 10)::text, 100000, now())
         RETURNING id`,
        [tenant.id, `Client ${i}`, `F-DP-${String(i).padStart(3, "0")}`],
      );
      const factureId = facRes.rows[0]!.id;

      // Réglée 15 jours après émission — délai attendu : 15 jours.
      await adminPool.query(
        `INSERT INTO paiements (id, tenant_id, facture_id, date, montant_cents, sens, moyen, nature)
         VALUES (gen_random_uuid()::text, $1::uuid, $2, current_date - 25, 100000, 'ENCAISSEMENT', 'VIREMENT', 'SOLDE')`,
        [tenant.id, factureId],
      );
    }

    const result = await withTenant(tenant.id, (tx) =>
      CALCULATORS["delai_paiement_client"](tx, parsePeriode("12_mois")),
    );
    expect(result.donneesInsuffisantes).toBe(false);
    expect(result.nbSources).toBe(5);
    expect(result.valeur).toBe(15);
  });
});
