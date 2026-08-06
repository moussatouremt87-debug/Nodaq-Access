// STUB — aucune IA branchée. Ne pas démontrer comme un agent.
// Les réponses ci-dessous sont préenregistrées. Remplacer par un vrai LLM avant tout usage en production.
import { Router, type IRouter } from "express";
import { withTenant, chatMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  SendChatMessageBody,
  GetChatHistoryQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const AI_REPLIES = [
  "J'ai bien reçu votre message. D'après les données disponibles, tout semble en ordre. Y a-t-il quelque chose de spécifique sur lequel vous souhaitez que je me concentre ?",
  "Bien sûr, je peux vous aider avec ça. Pouvez-vous me donner plus de détails pour que je puisse vous fournir une réponse précise ?",
  "Voici ce que j'observe : vos affaires en cours progressent normalement, et vos factures sont à jour. Avez-vous des questions sur un point particulier ?",
  "Je vais analyser cela pour vous. En attendant, n'hésitez pas à consulter votre brief matin pour un récapitulatif de vos priorités du jour.",
  "Compris. Je traite votre demande. Vos indicateurs financiers sont dans les normes habituelles pour cette période.",
];

let replyIndex = 0;

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

router.post("/chat/messages", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { content, conversationId } = parsed.data;
  const convId = conversationId ?? crypto.randomUUID();
  const tenantId = req.tenantId!;

  const reply = AI_REPLIES[replyIndex % AI_REPLIES.length] ?? AI_REPLIES[0]!;
  replyIndex++;

  const assistantMessage = await withTenant(tenantId, async (tx) => {
    await tx.insert(chatMessagesTable).values({
      tenantId, conversationId: convId, role: "user", content,
    });
    const [msg] = await tx.insert(chatMessagesTable).values({
      tenantId, conversationId: convId, role: "assistant", content: reply,
    }).returning();
    return msg;
  });

  res.json({ conversationId: convId, message: assistantMessage, stub: true });
});

export default router;
