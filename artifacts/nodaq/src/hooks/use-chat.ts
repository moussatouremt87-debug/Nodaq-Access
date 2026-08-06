import { useState, useCallback } from 'react';
import {
  useGetChatHistory,
  useSendChatMessage,
  getGetChatHistoryQueryKey,
  type ChatMessage,
  type ChatReply,
  type AgentAction,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export type { AgentAction };

const STORAGE_KEY = 'nodaq.chat.conversationId';

/** Maps assistant message ID → list of actions performed during that exchange */
export type ActionsMap = Map<string, AgentAction[]>;

export function useChat() {
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined,
  );
  const [actionsMap, setActionsMap] = useState<ActionsMap>(new Map());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const historyQuery = useGetChatHistory(
    { conversationId },
    { query: { queryKey: getGetChatHistoryQueryKey({ conversationId }) } },
  );

  const sendMutation = useSendChatMessage();

  const messages: ChatMessage[] = historyQuery.data?.messages ?? [];

  const sendMessage = useCallback(
    (content: string, onSettled?: () => void) => {
      sendMutation.mutate(
        { data: { content, conversationId: conversationId ?? null } },
        {
          onSuccess: (reply: ChatReply) => {
            const newConvId = reply.conversationId;
            if (newConvId && newConvId !== conversationId) {
              setConversationId(newConvId);
              localStorage.setItem(STORAGE_KEY, newConvId);
            }

            // Store actions_performed keyed by the assistant message ID
            const actions = reply.actions_performed;
            const msgId = reply.message?.id;
            if (actions && actions.length > 0 && msgId) {
              setActionsMap(prev => new Map(prev).set(msgId, actions));

              // Invalidate relevant caches based on entity types touched
              const types = new Set(actions.map((a) => a.entityType));
              const prefixMap: Record<string, string> = {
                affaire: '/api/affaires',
                prospect: '/api/prospects',
                echeance: '/api/echeances',
                classeur: '/api/classeur',
                activity: '/api/cockpit/activity',
              };
              const always = ['/api/brief', '/api/cockpit/kpis', '/api/pending-actions'];

              const toInvalidate = [...always];
              for (const entityType of types) {
                if (entityType && prefixMap[entityType]) {
                  toInvalidate.push(prefixMap[entityType]!);
                }
              }
              if (types.has('affaire')) {
                toInvalidate.push('/api/affaires/stats', '/api/cockpit/kpis');
              }
              if (types.has('activity')) {
                toInvalidate.push('/api/cockpit/activity');
              }

              for (const prefix of [...new Set(toInvalidate)]) {
                queryClient.invalidateQueries({ queryKey: [prefix] });
              }
            }

            queryClient.invalidateQueries({
              queryKey: getGetChatHistoryQueryKey({ conversationId: newConvId }),
            });
            onSettled?.();
          },
          onError: () => {
            toast({
              title: "L'agent n'a pas répondu",
              description: 'Vérifiez votre connexion et réessayez.',
              variant: 'destructive',
            });
            onSettled?.();
          },
        },
      );
    },
    [conversationId, queryClient, sendMutation, toast],
  );

  return {
    messages,
    isLoadingHistory: historyQuery.isLoading,
    isError: historyQuery.isError,
    refetch: historyQuery.refetch,
    sendMessage,
    isSending: sendMutation.isPending,
    actionsMap,
  };
}
