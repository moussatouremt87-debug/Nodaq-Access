import { useState, useCallback } from 'react';
import {
  useGetChatHistory,
  useSendChatMessage,
  getGetChatHistoryQueryKey,
  type ChatMessage,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const STORAGE_KEY = 'nodaq.chat.conversationId';

export function useChat() {
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined,
  );
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
          onSuccess: (reply) => {
            if (reply.conversationId && reply.conversationId !== conversationId) {
              setConversationId(reply.conversationId);
              localStorage.setItem(STORAGE_KEY, reply.conversationId);
            }
            queryClient.invalidateQueries({
              queryKey: getGetChatHistoryQueryKey({
                conversationId: reply.conversationId,
              }),
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
  };
}
