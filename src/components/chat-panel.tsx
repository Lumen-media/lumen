import { invoke } from '@tauri-apps/api/core';
import { MessageCircle, Paperclip, Send } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ChatMessage, Reaction } from '@/services/chat-service';
import { fileManagementService } from '@/services/file-management-service';
import { useChatStore } from '@/stores/chat-store';
import { TextEditor, type TextEditorRef } from './text-editor';
import { TypingLoader } from './typing-loader';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { ScrollArea } from './ui/scroll-area';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🙌', '👏'];

const SENDER_COLORS = [
  '#38bdf8', // sky-400
  '#fbbf24', // amber-400
  '#34d399', // emerald-400
  '#fb7185', // rose-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#2dd4bf', // teal-400
  '#e879f9', // fuchsia-400
  '#a3e635', // lime-400
  '#22d3ee', // cyan-400
];

function senderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function openChatFile(filePath: string): void {
  const normalized = filePath.replace(/\\/g, '/');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  const folderPath = separatorIndex >= 0 ? filePath.substring(0, separatorIndex) : filePath;
  invoke('open_folder', { path: folderPath }).catch(() => { });
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
      sendReaction(message.id, emoji).catch(() => { });
    },
    [message.id, sendReaction]
  );

  return (
    <div className={cn('group flex flex-col gap-1', isOperator ? 'items-end' : 'items-start')}>
      <HoverCard>
        <HoverCardTrigger
          render={
            <Card
              className={cn(
                'relative max-w-[85%] min-w-2/5 rounded-xl px-3 py-2 gap-0 text-sm border-0 shadow-none cursor-default',
                isOperator
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted/60'
              )}
            />
          }
        >
          {!isOperator && (
            <p
              className="mb-1 text-xs font-medium"
              style={{ color: senderColor(message.sender_name) }}
            >
              {message.sender_name}
            </p>
          )}

          {message.file && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openChatFile(message.file!.file_path)}
              className="mb-1.5 flex w-full items-center justify-start gap-2 rounded-lg bg-background/40 px-2 py-1.5 text-xs hover:bg-background/60 h-auto"
            >
              <Paperclip className="size-3.5 shrink-0" />
              <span className="truncate">{message.file.file_name}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatFileSize(message.file.file_size)}
              </span>
            </Button>
          )}
          {message.text && <div className="wrap-break-word">{renderMarkdown(message.text)}</div>}

          <p
            className={cn(
              'text-[10px] text-right',
              isOperator ? 'text-primary-foreground/60' : 'text-muted-foreground'
            )}
          >
            {formatTime(message.ts)}
          </p>
        </HoverCardTrigger>

        <HoverCardContent
          side="top"
          align="end"
          sideOffset={-6}
          alignOffset={0}
          className="w-auto p-0.5 rounded-lg"
        >
          <div className="flex gap-0.5">
            {REACTION_EMOJIS.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleReaction(emoji)}
                title={emoji}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>

      {message.reactions?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {groupReactions(message.reactions).map(([emoji, count]) => (
            <Badge
              key={emoji}
              variant="outline"
              render={<button type="button" onClick={() => toggleReaction(emoji)} />}
              className="cursor-pointer gap-1"
            >
              <span>{emoji}</span>
              <span>{count}</span>
            </Badge>
          ))}
        </div>
      )}
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
  const { messages, config, init, sendMessage, sendFile, sendTyping, typingUsers } = useChatStore();
  const [sending, setSending] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextEditorRef>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  const handleSend = useCallback(async () => {
    const md = editorRef.current?.getMarkdown().trim() ?? '';
    if (!md || sending) return;
    setSending(true);
    try {
      await sendMessage(md);
      editorRef.current?.setMarkdown('');
      isNearBottomRef.current = true;
      requestAnimationFrame(scrollToBottom);
    } catch {
      // keep text so the operator can retry
    } finally {
      setSending(false);
      editorRef.current?.focus();
    }
  }, [sending, sendMessage, scrollToBottom]);

  const handleAttach = useCallback(async () => {
    const picked = await fileManagementService.openFilePicker('files');
    if (!picked || picked.length === 0) return;
    const [filePath] = picked;
    if (!filePath) return;
    setSending(true);
    try {
      const caption = editorRef.current?.getMarkdown().trim() || undefined;
      await sendFile(filePath, caption);
      editorRef.current?.setMarkdown('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }, [sendFile]);

  useEffect(() => {
    if (config.enabled) {
      editorRef.current?.focus();
    }
  }, [config.enabled]);

  useEffect(() => {
    init().catch(() => { });
  }, [init]);

  // Typing debounce — send typing true on edit, false after 2s idle
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(false);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const handleUpdate = () => {
      if (!config.enabled) return;

      if (!lastTypingRef.current) {
        lastTypingRef.current = true;
        sendTyping(true).catch(() => { });
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        lastTypingRef.current = false;
        sendTyping(false).catch(() => { });
      }, 2000);
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [config.enabled, sendTyping]);

  useEffect(() => {
    const handler = () => {
      editorRef.current?.focus();
    };
    window.addEventListener('lumen:chat-focus', handler);
    return () => window.removeEventListener('lumen:chat-focus', handler);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const threshold = 120;
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      isNearBottomRef.current = distanceFromBottom < threshold;
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll when near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    };

    editor.view.dom.addEventListener('keydown', handleEditorKeyDown);
    return () => editor.view.dom.removeEventListener('keydown', handleEditorKeyDown);
  }, [handleSend]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 overflow-hidden" viewportProps={{ ref: viewportRef }}>
        <div className="flex flex-col gap-3 p-3">
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

          {Object.keys(typingUsers).length > 0 && (
            <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2 w-fit mb-3 text-primary-foreground bg-primary p-1">
              {Object.values(typingUsers)
                .map((u) => u.name)
                .join(', ')}{' '}
              <TypingLoader size={4} />
            </div>
          )}

        </div>
      </ScrollArea>


      <div className="shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="max-h-40 overflow-auto scrollbar-none rounded-3xl border border-border bg-background/50 text-sm">
            <TextEditor
              ref={editorRef}
              placeholder={t('Type a message…')}
              editable={config.enabled && !sending}
              debounce={100}
            />
          </div>
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
            </div>
            <Button size="sm" onClick={handleSend} disabled={!config.enabled || sending}>
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
