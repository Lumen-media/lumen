import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { Check, CheckCheck, MessageCircle, Paperclip, Reply, Send, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ChatMessage, Reaction } from '@/services/chat-service';
import { MAX_MESSAGE_LENGTH } from '@/services/chat-service';
import { fileManagementService } from '@/services/file-management-service';
import { thumbnailService } from '@/services/thumbnail-service';
import { useChatStore } from '@/stores/chat-store';
import { TextEditor, type TextEditorRef } from './text-editor';
import { TypingLoader } from './typing-loader';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './ui/context-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { ScrollArea } from './ui/scroll-area';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🙌', '👏'];

const SENDER_COLORS = [
  '#38bdf8',
  '#fbbf24',
  '#34d399',
  '#fb7185',
  '#a78bfa',
  '#fb923c',
  '#2dd4bf',
  '#e879f9',
  '#a3e635',
  '#22d3ee',
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
  invoke('open_folder', { path: folderPath }).catch((err) =>
    console.error('[chat] open folder failed:', err)
  );
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const PDF_EXTS = new Set(['pdf']);

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function isImage(fileName: string): boolean {
  return IMAGE_EXTS.has(getFileExt(fileName));
}

function isPdf(fileName: string): boolean {
  return PDF_EXTS.has(getFileExt(fileName));
}

function FilePreview({ file }: { file: NonNullable<ChatMessage['file']> }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isImage(file.file_name)) {
      let cancelled = false;
      setLoading(true);
      thumbnailService
        .getThumbnail(file.file_path, 300)
        .then((url) => {
          if (!cancelled) {
            setThumbnail(url);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error('[chat] thumbnail load failed:', err);
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (isPdf(file.file_name)) {
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const pdfjsLib = await import('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url
          ).toString();

          const bytes = await readFile(file.file_path);
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const blobUrl = URL.createObjectURL(blob);
          const doc = await pdfjsLib.getDocument({ url: blobUrl }).promise;
          const page = await doc.getPage(1);
          const viewport = page.getViewport({ scale: 1.5 });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvas, viewport }).promise;

          if (!cancelled) {
            setThumbnail(canvas.toDataURL('image/jpeg', 0.7));
            setLoading(false);
          }
          URL.revokeObjectURL(blobUrl);
        } catch (err) {
          console.error('[chat] PDF thumbnail error:', err);
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setLoading(false);
  }, [file.file_path, file.file_name]);

  if (isImage(file.file_name)) {
    return (
      <button
        type="button"
        onClick={() => openChatFile(file.file_path)}
        className="mb-1.5 block w-full overflow-hidden rounded-lg"
      >
        {loading || !thumbnail ? (
          <div className="h-32 w-full animate-pulse rounded-lg bg-muted/40" />
        ) : (
          <img
            src={thumbnail}
            alt={file.file_name}
            className="max-h-48 w-full rounded-lg object-cover"
          />
        )}
      </button>
    );
  }

  if (isPdf(file.file_name)) {
    return (
      <button
        type="button"
        onClick={() => openChatFile(file.file_path)}
        className="mb-1.5 w-full overflow-hidden rounded-lg bg-background/40 hover:bg-background/60"
      >
        {loading || !thumbnail ? (
          <div className="flex h-20 items-center justify-center bg-muted/30">
            <div className="size-12 animate-pulse rounded bg-muted/40" />
          </div>
        ) : (
          <img src={thumbnail} alt={file.file_name} className="h-20 w-full object-cover" />
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="truncate text-xs font-medium flex-1">{file.file_name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatFileSize(file.file_size)}
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openChatFile(file.file_path)}
      className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-background/40 px-2 py-1.5 text-xs hover:bg-background/60"
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="truncate">{file.file_name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(file.file_size)}</span>
    </button>
  );
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
    const rendered = parts.map((part, i) => {
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
            className="text-blue-400 underline underline-offset-4 hover:text-blue-300"
          >
            {link[1]}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
    return lineIdx > 0 ? (
      <React.Fragment key={lineIdx}>
        {'\n'}
        {rendered}
      </React.Fragment>
    ) : (
      rendered
    );
  });
}

function formatTime(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncatePreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

function ReplyPreview({ message, onClear }: { message: ChatMessage; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-t-lg bg-muted/30 px-3 py-1.5 text-xs">
      <Reply className="size-3 shrink-0 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">{message.sender_name}</span>
      <span className="truncate text-muted-foreground/70 flex-1">
        {truncatePreview(message.text || (message.file?.file_name ?? ''), 60)}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function ReadIndicator({ read }: { read: boolean }) {
  return read ? (
    <CheckCheck className="size-3 text-blue-400 shrink-0" />
  ) : (
    <Check className="size-3 text-muted-foreground/50 shrink-0" />
  );
}

function MessageBubble({
  message,
  showHeader,
  onReply,
}: {
  message: ChatMessage;
  showHeader: boolean;
  onReply: (msg: ChatMessage) => void;
}) {
  const { sendReaction, deleteMessage } = useChatStore();
  const isOperator = message.sender_type === 'operator';

  const toggleReaction = useCallback(
    (emoji: string) => {
      sendReaction(message.id, emoji).catch((err) => console.error('[chat] reaction failed:', err));
    },
    [message.id, sendReaction]
  );

  const handleDelete = useCallback(() => {
    deleteMessage(message.id).catch((err) => console.error('[chat] delete failed:', err));
  }, [message.id, deleteMessage]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn('group flex flex-col gap-1', isOperator ? 'items-end' : 'items-start')}
      >
        <HoverCard>
          <HoverCardTrigger
            render={
              <Card
                className={cn(
                  'relative max-w-[85%] min-w-30 rounded-xl p-1.5 leading-relaxed gap-0 text-sm border-0 shadow-none cursor-default',
                  isOperator
                    ? 'rounded-br-sm bg-primary/15 text-foreground'
                    : 'rounded-bl-sm bg-muted/40',
                  'animate-in fade-in-0 zoom-in-95 duration-200'
                )}
              />
            }
          >
            {message.reply_to && (
              <div
                className={cn(
                  'mb-1 rounded-md px-2 py-1 text-[11px] leading-tight border-l-2 cursor-default',
                  isOperator
                    ? 'bg-foreground/[0.07] border-foreground/20'
                    : 'bg-foreground/5 border-foreground/15'
                )}
              >
                <p
                  className={cn(
                    'font-medium truncate',
                    isOperator ? 'text-foreground/60' : 'text-muted-foreground'
                  )}
                >
                  {message.reply_to.sender_name}
                </p>
                <p
                  className={cn(
                    'truncate',
                    isOperator ? 'text-foreground/40' : 'text-muted-foreground/50'
                  )}
                >
                  {message.reply_to.text || message.reply_to.file?.file_name || ''}
                </p>
              </div>
            )}

            {showHeader && !isOperator && (
              <p
                className="mb-1 text-xs font-medium"
                style={{ color: senderColor(message.sender_name) }}
              >
                {message.sender_name}
              </p>
            )}

            {message.file && <FilePreview file={message.file} />}
            {message.text && (
              <div className="wrap-break-word whitespace-pre-wrap">
                {renderMarkdown(message.text)}
              </div>
            )}

            <div
              className={cn(
                'flex items-center gap-1 mt-0.5',
                isOperator ? 'justify-end' : 'justify-start'
              )}
            >
              <p className="text-[10px] text-muted-foreground">{formatTime(message.ts)}</p>
              {isOperator && <ReadIndicator read={message.read ?? false} />}
            </div>
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

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onReply(message)}
          className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity absolute top-1/2 -translate-y-1/2',
            isOperator ? '-left-7' : '-right-7'
          )}
          title={t('Reply')}
        >
          <Reply />
        </Button>

        {message.reactions?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {groupReactions(message.reactions).map(([emoji, count]) => (
              <Badge
                key={emoji}
                variant="outline"
                render={<button type="button" onClick={() => toggleReaction(emoji)} />}
                className="cursor-pointer gap-1 animate-in fade-in-0 zoom-in-95 duration-150"
              >
                <span>{emoji}</span>
                <span>{count}</span>
              </Badge>
            ))}
          </div>
        )}
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={() => onReply(message)}>
          <Reply />
          {t('Reply')}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 />
          {t('Delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextEditorRef>(null);
  const isNearBottomRef = useRef(true);
  const [charCount, setCharCount] = useState(0);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 60,
    overscan: 15,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  const scrollToBottom = useCallback(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [messages.length, virtualizer]);

  const handleSend = useCallback(async () => {
    const md = editorRef.current?.getMarkdown().trim() ?? '';
    if (!md || sending) return;
    if (md.length > MAX_MESSAGE_LENGTH) return;
    setSending(true);
    try {
      await sendMessage(md, replyTo?.id);
      editorRef.current?.setMarkdown('');
      setReplyTo(null);
      setCharCount(0);
      isNearBottomRef.current = true;
      setTimeout(scrollToBottom, 150);
    } catch (err) {
      console.error('[chat] send failed:', err);
    } finally {
      setSending(false);
      editorRef.current?.focus();
    }
  }, [sending, sendMessage, scrollToBottom, replyTo]);

  const handleAttach = useCallback(async () => {
    const picked = await fileManagementService.openFilePicker('files');
    if (!picked || picked.length === 0) return;
    const [filePath] = picked;
    if (!filePath) return;
    setSending(true);
    try {
      const caption = editorRef.current?.getMarkdown().trim() || undefined;
      await sendFile(filePath, caption, replyTo?.id);
      editorRef.current?.setMarkdown('');
      setReplyTo(null);
      setCharCount(0);
    } catch (err) {
      console.error('[chat] attach failed:', err);
    } finally {
      setSending(false);
    }
  }, [sendFile, replyTo]);

  useEffect(() => {
    if (config.enabled) {
      editorRef.current?.focus();
    }
  }, [config.enabled]);

  useEffect(() => {
    init().catch((err) => console.error('[chat] init failed:', err));
  }, [init]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(false);

  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const handleUpdate = () => {
      if (!config.enabled) return;
      const md = editor.markdown?.serialize(editor.state.doc.toJSON()) ?? '';
      setCharCount(md.length);

      if (!lastTypingRef.current) {
        lastTypingRef.current = true;
        sendTyping(true).catch((err) => console.error('[chat] typing true failed:', err));
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        lastTypingRef.current = false;
        sendTyping(false).catch((err) => console.error('[chat] typing false failed:', err));
      }, 2000);
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [config.enabled, sendTyping]);

  useEffect(() => {
    const handler = () => editorRef.current?.focus();
    window.addEventListener('lumen:chat-focus', handler);
    return () => window.removeEventListener('lumen:chat-focus', handler);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleScroll = () => {
      const threshold = 300;
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      isNearBottomRef.current = distanceFromBottom < threshold;
    };
    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll when near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      setTimeout(scrollToBottom, 100);
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

  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 overflow-hidden" viewportProps={{ ref: viewportRef }}>
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
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const message = messages[virtualItem.index];
              const prev = virtualItem.index > 0 ? messages[virtualItem.index - 1] : null;
              const showHeader = !prev || prev.sender_id !== message.sender_id;

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'absolute top-0 left-0 w-full px-3 pb-1.5',
                    showHeader ? 'pt-2' : 'pt-0.5'
                  )}
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <MessageBubble message={message} showHeader={showHeader} onReply={setReplyTo} />
                </div>
              );
            })}
          </div>
        )}

        {Object.keys(typingUsers).length > 0 && (
          <div className="flex items-center gap-2 text-xs rounded-xl px-3 py-2 w-fit mb-3 text-primary-foreground bg-primary p-1">
            {Object.values(typingUsers)
              .map((u) => u.name)
              .join(', ')}{' '}
            <TypingLoader size={4} />
          </div>
        )}
      </ScrollArea>

      <div className="shrink-0 px-2 pb-2">
        <div className="flex flex-col gap-1">
          {replyTo && <ReplyPreview message={replyTo} onClear={() => setReplyTo(null)} />}

          <div
            className={cn(
              'max-h-40 overflow-auto scrollbar-none rounded-2xl border text-sm',
              isOverLimit ? 'border-destructive' : 'border-border',
              replyTo ? 'rounded-t-none' : '',
              'bg-background/50'
            )}
          >
            <TextEditor
              ref={editorRef}
              placeholder={t('Type a message…')}
              editable={config.enabled && !sending}
              debounce={100}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Attach file')}
                onClick={handleAttach}
                disabled={!config.enabled || sending}
              >
                <Paperclip />
              </Button>
              {charCount > 0 && (
                <span
                  className={cn(
                    'text-[10px] tabular-nums',
                    isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'
                  )}
                >
                  {charCount}/{MAX_MESSAGE_LENGTH}
                </span>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!config.enabled || sending || isOverLimit}
              className="rounded-xl"
            >
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ChatTab };
