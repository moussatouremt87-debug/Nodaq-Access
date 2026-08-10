import { useState, useCallback, useRef } from 'react';
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

const API_BASE = '/api';

export type { AgentAction };

const STORAGE_KEY = 'nodaq.chat.conversationId';

/** Maps assistant message ID → list of actions performed during that exchange */
export type ActionsMap = Map<string, AgentAction[]>;

/**
 * A locally-tracked "voice" message — holds the transcription text and
 * whether it is still pending (i.e. not yet in the server history).
 */
export interface VoiceMessage {
  id: string;
  text: string;
}

// ─── Cache invalidation helper ─────────────────────────────────────────────

function invalidateCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  actions: AgentAction[],
  conversationId: string | undefined,
) {
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
    if (entityType && prefixMap[entityType]) toInvalidate.push(prefixMap[entityType]!);
  }
  if (types.has('affaire')) toInvalidate.push('/api/affaires/stats', '/api/cockpit/kpis');
  if (types.has('activity')) toInvalidate.push('/api/cockpit/activity');
  for (const prefix of [...new Set(toInvalidate)]) {
    queryClient.invalidateQueries({ queryKey: [prefix] });
  }
  queryClient.invalidateQueries({
    queryKey: getGetChatHistoryQueryKey({ conversationId }),
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useChat() {
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined,
  );
  const [actionsMap, setActionsMap] = useState<ActionsMap>(new Map());

  // Image upload state
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<VoiceMessage[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const historyQuery = useGetChatHistory(
    { conversationId },
    { query: { queryKey: getGetChatHistoryQueryKey({ conversationId }) } },
  );

  const sendMutation = useSendChatMessage();

  const messages: ChatMessage[] = historyQuery.data?.messages ?? [];

  // ─── Update conversation ID helper ──────────────────────────────────────

  const applyConvId = useCallback(
    (newId: string) => {
      if (newId !== conversationId) {
        setConversationId(newId);
        localStorage.setItem(STORAGE_KEY, newId);
      }
    },
    [conversationId],
  );

  // ─── On-success handler shared by text + image sends ────────────────────

  const handleReply = useCallback(
    (reply: ChatReply) => {
      const newConvId = reply.conversationId;
      if (newConvId) applyConvId(newConvId);

      const actions = reply.actions_proposees ?? [];
      const msgId = reply.message?.id;
      if (actions.length > 0 && msgId) {
        setActionsMap((prev) => new Map(prev).set(msgId, actions));
        invalidateCaches(queryClient, actions, newConvId);
      } else {
        queryClient.invalidateQueries({
          queryKey: getGetChatHistoryQueryKey({ conversationId: newConvId }),
        });
      }
    },
    [applyConvId, conversationId, queryClient],
  );

  // ─── Send text message ───────────────────────────────────────────────────

  const sendMessage = useCallback(
    (content: string, onSettled?: () => void) => {
      sendMutation.mutate(
        { data: { content, conversationId: conversationId ?? null } },
        {
          onSuccess: (reply: ChatReply) => {
            handleReply(reply);
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
    [conversationId, handleReply, sendMutation, toast],
  );

  // ─── Send image (POST /api/chat/upload, multipart) ───────────────────────

  const sendImage = useCallback(
    async (file: File, caption?: string) => {
      if (!file) return;

      const objectUrl = URL.createObjectURL(file);
      setPendingImageUrl(objectUrl);
      setIsUploadingImage(true);

      try {
        const formData = new FormData();
        formData.append('image', file);
        if (caption?.trim()) formData.append('text', caption.trim());
        if (conversationId) formData.append('conversationId', conversationId);

        const res = await fetch(`${API_BASE}/chat/upload`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const reply = (await res.json()) as ChatReply & {
          document?: { name: string; documentType: string; summary: string };
        };
        handleReply(reply);
      } catch (err) {
        toast({
          title: "L'image n'a pas pu être analysée",
          description: err instanceof Error ? err.message : 'Erreur inconnue',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({
          queryKey: getGetChatHistoryQueryKey({ conversationId }),
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
        setPendingImageUrl(null);
        setIsUploadingImage(false);
      }
    },
    [conversationId, handleReply, queryClient, toast],
  );

  // ─── Voice recording ─────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        audioStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (blob.size < 1000) {
          toast({ title: 'Enregistrement trop court', description: 'Maintenez le bouton pour parler.' });
          return;
        }

        setIsTranscribing(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const res = await fetch(`${API_BASE}/chat/transcribe`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { text } = (await res.json()) as { text: string };

          if (text.trim()) {
            // Register as a voice message for italic display, then auto-send
            const vmId = crypto.randomUUID();
            setVoiceMessages((prev) => [...prev, { id: vmId, text }]);
            sendMessage(text, () => {
              // Remove the ephemeral voice message once history reloads
              setVoiceMessages((prev) => prev.filter((v) => v.id !== vmId));
            });
          }
        } catch (err) {
          toast({
            title: 'Transcription échouée',
            description: err instanceof Error ? err.message : 'Erreur inconnue',
            variant: 'destructive',
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(200); // collect chunks every 200 ms
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      const isPermission = err instanceof DOMException && err.name === 'NotAllowedError';
      toast({
        title: isPermission ? 'Permission microphone refusée' : "Impossible d'accéder au microphone",
        description: isPermission
          ? "Autorisez l'accès au microphone dans les réglages de votre navigateur."
          : err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'destructive',
      });
    }
  }, [isRecording, sendMessage, toast]);

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, [isRecording]);

  return {
    messages,
    isLoadingHistory: historyQuery.isLoading,
    isError: historyQuery.isError,
    refetch: historyQuery.refetch,
    sendMessage,
    isSending: sendMutation.isPending || isUploadingImage || isTranscribing,
    actionsMap,
    // Image
    sendImage,
    isUploadingImage,
    pendingImageUrl,
    // Voice
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    voiceMessages,
  };
}
