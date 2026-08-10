import { Router, type IRouter } from "express";
import { withTenant, chatMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  SendChatMessageBody,
  GetChatHistoryQueryParams,
} from "@workspace/api-zod";
import { runAgent, getContextualSuggestions } from "../lib/mistralAgent";
import { LlmConfigError } from "@nodaq/llm";
import { enregistrerPlan } from "../lib/plan-vocal.js";

const router: IRouter = Router();

// ─── GET history ──────────────────────────────────────────────────────────────

router.get("/chat/messages", async (req, res): Promise<void> => {
  const parsed = GetChatHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { conversationId } = parsed.data;

  if (!conversationId) {
    res.json({ conversationId: crypto.randomUUID(), messages: [] });
    return;
  }

  const tenantId = req.tenantId!;
  const messages = await withTenant(tenantId, async (tx) =>
    tx.select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, conversationId))
      .orderBy(asc(chatMessagesTable.createdAt))
  );

  res.json({ conversationId, messages });
});

// ─── POST message → agent ─────────────────────────────────────────────────────

router.post("/chat/messages", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { content, conversationId } = parsed.data;
  const convId = conversationId ?? crypto.randomUUID();
  const tenantId = req.tenantId!;

  // 1. Persist user message via withTenant (RLS maintained)
  await withTenant(tenantId, async (tx) => {
    await tx.insert(chatMessagesTable).values({
      tenantId, conversationId: convId, role: "user", content,
    });
  });

  // 2. Fetch full conversation history for context
  const history = await withTenant(tenantId, async (tx) =>
    tx.select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.conversationId, convId))
      .orderBy(asc(chatMessagesTable.createdAt))
  );

  // 3. Run agent (classifier gate + tool-calling loop via LiteLLM)
  let agentResult: Awaited<ReturnType<typeof runAgent>>;
  try {
    agentResult = await runAgent(tenantId, history);
  } catch (err: unknown) {
    // Missing configuration → 503 with the exact variable name, never its value
    if (err instanceof LlmConfigError) {
      const missingVar = err.missingVar;
      req.log?.warn({ missingVar }, "LLM config missing");
      res.status(503).json({
        error: `${missingVar} is not configured — agent unavailable`,
        detail: `La variable d'environnement "${missingVar}" est absente.`,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    req.log?.error({ err }, "agent error");
    res.status(502).json({ error: "L'agent IA a rencontré une erreur.", detail: message });
    return;
  }

  // 3 bis. Les écritures proposées deviennent un PLAN à valider.
  //
  // C'est la règle 4 du dépôt : une écriture agentique crée une
  // `pending_action`, elle ne s'exécute jamais directement.
  const planId =
    agentResult.operations.length > 0
      ? await enregistrerPlan(tenantId, {
          operations: agentResult.operations,
          questions: [],
          nonCompris: [],
        })
      : null;

  // 4. Persist assistant reply via withTenant (RLS maintained)
  const assistantMessage = await withTenant(tenantId, async (tx) => {
    const [msg] = await tx.insert(chatMessagesTable).values({
      tenantId,
      conversationId: convId,
      role: "assistant",
      content: agentResult.content,
    }).returning();
    return msg;
  });

  res.json({
    conversationId: convId,
    message: assistantMessage,
    // `actions_proposees` et non `actions_performed` : rien n'est écrit tant
    // que le plan n'a pas été validé. Le passé était un mensonge.
    actions_proposees: agentResult.actions,
    /** Plan à valider, quand l'agent a proposé des écritures. */
    planId,
  });
});

// ─── GET contextual suggestions ───────────────────────────────────────────────

router.get("/chat/suggestions", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const suggestions = await getContextualSuggestions(tenantId);
  res.json({ suggestions });
});

export default router;
