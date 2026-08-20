import { fileManagementService } from '@/services/file-management-service';
import { useChatStore } from '@/stores/chat-store';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { ChatMessage, Reaction } from '@/services/chat-service';
import { MessageCircle, Paperclip, Send, Smile } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Button } from './ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { ScrollArea } from './ui/scroll-area';
import { Textarea } from './ui/textarea';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🙌', '👏', '🔥'];

function openChatFile(filePath: string): void {
  const normalized = filePath.replace(/\\/g, '/');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const folderPath =
    separatorIndex >= 0 ? filePath.substring(0, separatorIndex) : filePath;
  invoke('open_folder', { path: folderPath }).catch(() => {});
}

function renderMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const { sendReaction } = useChatStore();
  const isOperator = message.sender_type === 'operator';

  const toggleReaction = useCallback(
    (emoji: string) => {
      sendReaction(message.id, emoji).catch(() => {});
    },
    [message.id, sendReaction]
  );

  return (
    <div className={cn('group flex flex-col gap-1', isOperator ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{message.sender_name}</span>
        <span>{formatTime(message.ts)}</span>
      </div>

      <div
        className={cn(
          'relative max-w-[85%] rounded-xl px-3 py-2 text-sm',
          isOperator
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted/60 text-foreground'
        )}
      >
        {message.file && (
          <button
            type="button"
            onClick={() => openChatFile(message.file!.file_path)}
            className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-background/40 px-2 py-1.5 text-xs hover:bg-background/60"
          >
            <Paperclip className="size-3.5 shrink-0" />
            <span className="truncate">{message.file.file_name}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatFileSize(message.file.file_size)}
            </span>
          </button>
        )}
        {message.text && <div className="break-words">{renderMarkdown(message.text)}</div>}
      </div>

      {message.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {groupReactions(message.reactions).map(([emoji, count]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleReaction(emoji)}
              className="flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs hover:bg-accent"
            >
              <span>{emoji}</span>
              <span className="text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-0.5 flex gap-0.5">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => toggleReaction(emoji)}
            className="rounded-full p-1 text-sm opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function groupReactions(reactions: Reaction[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of reactions) {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  }
  return Array.from(counts.entries());
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatTab() {
  const { messages, config, init, sendMessage, sendFile } = useChatStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    init().catch(() => {});
  }, [init]);

  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
    };
    window.addEventListener('lumen:chat-focus', handler);
    return () => window.removeEventListener('lumen:chat-focus', handler);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom on new messages
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await sendMessage(trimmed);
      setText('');
    } catch {
      // keep text so the operator can retry
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [text, sending, sendMessage]);

  const handleAttach = useCallback(async () => {
    const picked = await fileManagementService.openFilePicker('files');
    if (!picked || picked.length === 0) return;
    const [filePath] = picked;
    if (!filePath) return;
    setSending(true);
    try {
      const caption = text.trim() || undefined;
      await sendFile(filePath, caption);
      setText('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }, [text, sendFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const exposeInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (config.enabled) {
      exposeInput();
    }
  }, [exposeInput, config.enabled]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 overflow-hidden" viewportProps={{ ref: viewportRef }}>
        <div className="flex flex-col gap-4 p-3">
          {messages.length === 0 ? (
            <Empty className="flex-1 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircle />
                </EmptyMedia>
                <EmptyTitle>{t('No messages yet')}</EmptyTitle>
                <EmptyDescription>
                  {t('Start a conversation with the connected operators.')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex flex-col gap-1.5">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('Type a message…')}
            disabled={!config.enabled || sending}
            className="min-h-[60px] resize-none"
            rows={2}
          />
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Attach file')}
                onClick={handleAttach}
                disabled={!config.enabled || sending}
              >
                <Paperclip />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Reactions')}
                disabled={!config.enabled}
                onClick={() => {}}
              >
                <Smile />
              </Button>
            </div>
            <Button size="sm" onClick={handleSend} disabled={!config.enabled || sending || !text.trim()}>
              <Send />
              {t('Send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ChatTab };