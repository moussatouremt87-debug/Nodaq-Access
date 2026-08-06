import { useEffect, useRef, useState } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  CheckCircle2,
  Zap,
  Camera,
  Mic,
  MicOff,
  X,
  ImageIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useChat, type AgentAction } from '@/hooks/use-chat';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGetChatSuggestions } from '@workspace/api-client-react';

// ─── Suggestions fallback ─────────────────────────────────────────────────────

const FALLBACK_SUGGESTIONS = [
  "Quel est mon chiffre d'affaires ce mois-ci ?",
  'Quelles factures sont en retard ?',
  'Résume mon pipeline de prospects.',
  "Y a-t-il des actions en attente ?",
];

// ─── Action card ──────────────────────────────────────────────────────────────

function ActionCard({ actions }: { actions: AgentAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary/70">
        <Zap className="h-3 w-3" />
        <span>Actions effectuées</span>
      </div>
      {actions.map((action, i) => (
        <div key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
          <span>{action.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Typing indicator (three dots) ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <Avatar className="h-7 w-7 shrink-0 mt-0.5">
        <AvatarFallback className="bg-primary/15 text-primary text-[10px]">
          <Bot className="h-3.5 w-3.5" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-sm border border-card-border bg-card px-4 py-3 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: '0.15s' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: '0.3s' }} />
      </div>
    </div>
  );
}

// ─── Image preview (pending upload) ───────────────────────────────────────────

function PendingImageBubble({ src }: { src: string }) {
  return (
    <>
      {/* User "message" showing the photo */}
      <div className="flex gap-3 flex-row-reverse animate-stagger-in">
        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
          <AvatarFallback className="bg-secondary text-secondary-foreground text-[10px]">
            <User className="h-3.5 w-3.5" />
          </AvatarFallback>
        </Avatar>
        <div className="max-w-[60%] flex flex-col items-end">
          <div className="rounded-2xl rounded-tr-sm overflow-hidden border border-card-border">
            <img
              src={src}
              alt="Document en cours d'analyse"
              className="max-h-48 object-contain bg-muted"
            />
          </div>
          <span className="mt-1 text-[10px] text-muted-foreground">Analyse en cours…</span>
        </div>
      </div>
      {/* Agent typing dots */}
      <TypingIndicator />
    </>
  );
}

// ─── Waveform animation (during recording) ────────────────────────────────────

function WaveformAnimation() {
  const heights = [3, 6, 10, 14, 10, 6, 3];
  return (
    <div className="flex items-center gap-0.5 h-5">
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-red-400 animate-pulse"
          style={{
            height: `${h * 1.2}px`,
            animationDelay: `${i * 80}ms`,
            animationDuration: '700ms',
          }}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Chat() {
  const {
    messages,
    isLoadingHistory,
    sendMessage,
    isSending,
    actionsMap,
    sendImage,
    isUploadingImage,
    pendingImageUrl,
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    voiceMessages,
  } = useChat();

  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<{ file: File; url: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestionsQuery = useGetChatSuggestions();
  const suggestions = suggestionsQuery.data?.suggestions ?? FALLBACK_SUGGESTIONS;

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending, pendingImageUrl, voiceMessages]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSendText = (content?: string) => {
    const text = (content ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    sendMessage(text);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImagePreview({ file, url });
    // Reset input value so the same file can be re-selected
    e.target.value = '';
  };

  const handleSendImage = async () => {
    if (!imagePreview || isSending) return;
    const { file } = imagePreview;
    URL.revokeObjectURL(imagePreview.url);
    setImagePreview(null);
    await sendImage(file, input.trim() || undefined);
    setInput('');
  };

  const handleClearImagePreview = () => {
    if (!imagePreview) return;
    URL.revokeObjectURL(imagePreview.url);
    setImagePreview(null);
  };

  const handleMicToggle = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (imagePreview) handleSendImage();
      else handleSendText();
    }
  };

  const showEmpty = !isLoadingHistory && messages.length === 0 && voiceMessages.length === 0;

  return (
    <div className="flex flex-col h-[100dvh]">
      <PageHeader
        eyebrow="Agent NODAQ"
        title="Chat agent"
        description="Posez vos questions, donnez des instructions, photographiez un document ou dictez un message vocal."
        className="shrink-0"
      />

      {/* ── Message thread ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col px-5 md:px-8">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-6 space-y-4">
          {isLoadingHistory ? (
            <div className="space-y-4 max-w-2xl mx-auto">
              <Skeleton className="h-14 w-2/3" />
              <Skeleton className="h-14 w-1/2 ml-auto" />
              <Skeleton className="h-14 w-3/4" />
            </div>
          ) : showEmpty ? (
            /* Empty state with suggestion pills */
            <div className="max-w-lg mx-auto text-center pt-16">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary mb-4">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Votre copilote opérationnel
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                Demandez l'état d'une affaire, photographiez un post-it pour créer un prospect,
                ou dictez ce qui vient de se passer.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSendText(s)}
                    className="text-left rounded-lg border border-card-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground hover-elevate"
                    data-testid={`button-suggestion-${s.slice(0, 10)}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Persisted messages */}
              {messages.map((m) => {
                const actions = actionsMap.get(m.id) ?? [];
                const isVoice = voiceMessages.some((v) => v.text === m.content);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      'flex gap-3 animate-stagger-in',
                      m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                    )}
                    data-testid={`message-${m.role}-${m.id}`}
                  >
                    <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                      <AvatarFallback
                        className={cn(
                          'text-[10px]',
                          m.role === 'user'
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-primary/15 text-primary',
                        )}
                      >
                        {m.role === 'user' ? (
                          <User className="h-3.5 w-3.5" />
                        ) : (
                          <Bot className="h-3.5 w-3.5" />
                        )}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn('max-w-[80%] flex flex-col', m.role === 'user' && 'items-end')}>
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                          m.role === 'user'
                            ? 'bg-primary text-primary-foreground rounded-tr-sm'
                            : 'bg-card border border-card-border text-foreground rounded-tl-sm',
                          /* Transcribed voice messages appear in italic */
                          isVoice && m.role === 'user' && 'italic opacity-90',
                        )}
                      >
                        {m.content}
                        <div
                          className={cn(
                            'mt-1 text-[10px] font-mono-nums',
                            m.role === 'user'
                              ? 'text-primary-foreground/60'
                              : 'text-muted-foreground',
                          )}
                        >
                          {fmtDateTime(m.createdAt)}
                        </div>
                      </div>

                      {m.role === 'assistant' && actions.length > 0 && (
                        <ActionCard actions={actions} />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Ephemeral voice messages (pending send) */}
              {voiceMessages.map((vm) => (
                <div key={vm.id} className="flex gap-3 flex-row-reverse animate-stagger-in">
                  <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-[10px]">
                      <Mic className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="max-w-[80%] flex flex-col items-end">
                    <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed italic bg-primary/80 text-primary-foreground">
                      {vm.text}
                    </div>
                    <span className="mt-1 text-[10px] text-muted-foreground">Transcription — envoi en cours…</span>
                  </div>
                </div>
              ))}

              {/* Pending image upload */}
              {pendingImageUrl && <PendingImageBubble src={pendingImageUrl} />}

              {/* Typing indicator (text or transcribing) */}
              {(isSending && !isUploadingImage) && <TypingIndicator />}
            </div>
          )}
        </div>

        {/* ── Composer ──────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border py-4 space-y-2">
          {/* Image preview card */}
          {imagePreview && (
            <div className="max-w-2xl mx-auto flex items-start gap-3 rounded-xl border border-card-border bg-card p-3">
              <div className="relative shrink-0">
                <img
                  src={imagePreview.url}
                  alt="Aperçu"
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
                <button
                  onClick={handleClearImagePreview}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center hover:bg-muted"
                >
                  <X className="h-2.5 w-2.5 text-muted-foreground" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{imagePreview.file.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  Ajoutez une note (optionnel) puis cliquez Envoyer
                </p>
              </div>
            </div>
          )}

          {/* Main composer row */}
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            {/* Hidden file input — capture="environment" opens camera on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelected}
              data-testid="input-image-file"
            />

            {/* Camera / attach button */}
            <Button
              size="icon"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending || isRecording || isTranscribing}
              title="Photographier ou joindre un document"
              className="shrink-0"
              data-testid="button-camera"
            >
              <Camera className="h-4 w-4" />
            </Button>

            {/* Microphone button */}
            <Button
              size="icon"
              variant={isRecording ? 'destructive' : 'outline'}
              onClick={handleMicToggle}
              disabled={isSending || isTranscribing || !!imagePreview}
              title={isRecording ? "Arrêter l'enregistrement" : 'Enregistrer un message vocal'}
              className={cn('shrink-0', isRecording && 'ring-2 ring-red-400 ring-offset-1')}
              data-testid="button-mic"
            >
              {isRecording ? (
                <WaveformAnimation />
              ) : isTranscribing ? (
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>

            {/* Text input */}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                imagePreview
                  ? 'Note optionnelle sur le document…'
                  : isRecording
                  ? 'Enregistrement en cours… cliquez 🎙️ pour arrêter'
                  : 'Écrivez à votre agent NODAQ…'
              }
              rows={1}
              className="min-h-[44px] max-h-32 resize-none"
              disabled={isRecording || isTranscribing}
              data-testid="input-chat-message"
            />

            {/* Send button */}
            <Button
              size="icon"
              onClick={imagePreview ? handleSendImage : () => handleSendText()}
              disabled={
                isRecording ||
                isTranscribing ||
                isSending ||
                (!imagePreview && !input.trim())
              }
              data-testid="button-send-chat"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {/* Recording status hint */}
          {isRecording && (
            <p className="max-w-2xl mx-auto text-[10px] text-red-500 text-center animate-pulse">
              🔴 Enregistrement en cours — parlez clairement, puis cliquez 🎙️ pour envoyer
            </p>
          )}
          {isTranscribing && (
            <p className="max-w-2xl mx-auto text-[10px] text-muted-foreground text-center">
              Transcription en cours…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
