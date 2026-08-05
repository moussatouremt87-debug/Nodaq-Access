import { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useChat } from '@/hooks/use-chat';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  "Quel est mon chiffre d'affaires ce mois-ci ?",
  'Quelles factures sont en retard ?',
  'Résume mon pipeline de prospects.',
  "Y a-t-il des actions en attente d'approbation ?",
];

export default function Chat() {
  const { messages, isLoadingHistory, sendMessage, isSending } = useChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  const handleSend = (content?: string) => {
    const text = (content ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    sendMessage(text);
  };

  return (
    <div className="flex flex-col h-[100dvh]">
      <PageHeader
        eyebrow="Agent NODAQ"
        title="Chat agent"
        description="Posez vos questions sur votre activité, en langage naturel."
        className="shrink-0"
      />

      <div className="flex-1 min-h-0 flex flex-col px-5 md:px-8">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-6 space-y-4">
          {isLoadingHistory ? (
            <div className="space-y-4 max-w-2xl mx-auto">
              <Skeleton className="h-14 w-2/3" />
              <Skeleton className="h-14 w-1/2 ml-auto" />
              <Skeleton className="h-14 w-3/4" />
            </div>
          ) : messages.length === 0 ? (
            <div className="max-w-lg mx-auto text-center pt-16">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary mb-4">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Votre copilote opérationnel
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                Demandez-lui un état de la trésorerie, une synthèse des affaires en cours,
                ou toute autre question sur votre activité.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
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
              {messages.map((m) => (
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
                      {m.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-card border border-card-border text-foreground rounded-tl-sm',
                    )}
                  >
                    {m.content}
                    <div
                      className={cn(
                        'mt-1 text-[10px] font-mono-nums',
                        m.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground',
                      )}
                    >
                      {fmtDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex gap-3">
                  <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                    <AvatarFallback className="bg-primary/15 text-primary text-[10px]">
                      <Bot className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="rounded-2xl rounded-tl-sm border border-card-border bg-card px-4 py-3 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot"
                      style={{ animationDelay: '0.15s' }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse-dot"
                      style={{ animationDelay: '0.3s' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border py-4">
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Écrivez à votre agent NODAQ..."
              rows={1}
              className="min-h-[44px] max-h-32 resize-none"
              data-testid="input-chat-message"
            />
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={!input.trim() || isSending}
              data-testid="button-send-chat"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
