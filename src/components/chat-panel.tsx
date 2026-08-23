import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { animate } from 'animejs';
import { toJpeg } from 'html-to-image';
import {
  Check,
  CheckCheck,
  Copy,
  MessageCircle,
  Paperclip,
  Presentation,
  Reply,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ChatMessage, Reaction } from '@/services/chat-service';
import { MAX_MESSAGE_LENGTH } from '@/services/chat-service';
import { fileManagementService } from '@/services/file-management-service';
import { mediaDbService } from '@/services/media-db-service';
import { thumbnailService } from '@/services/thumbnail-service';
import type { FileInfo } from '@/services/types';
import { urlMediaService } from '@/services/url-media-service';
import { useChatStore } from '@/stores/chat-store';
import { usePlayerStore } from '@/stores/player-store';
import { useQueueStore } from '@/stores/queue-store';
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
import { Dialog, DialogContent } from './ui/dialog';
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
  invoke('open_folder', { path: filePath }).catch((err) =>
    console.error('[chat] open file failed:', err)
  );
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const PDF_EXTS = new Set(['pdf']);
const PPT_EXTS = new Set(['ppt', 'pptx']);
const PRESENTABLE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'ppt',
  'pptx',
]);
const seenMessageIds = new Set<number>();

function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function isImage(fileName: string): boolean {
  return IMAGE_EXTS.has(getFileExt(fileName));
}

function isPdf(fileName: string): boolean {
  return PDF_EXTS.has(getFileExt(fileName));
}

function isPpt(fileName: string): boolean {
  return PPT_EXTS.has(getFileExt(fileName));
}

function FilePreview({
  file,
  onPresentableClick,
}: {
  file: NonNullable<ChatMessage['file']>;
  onPresentableClick?: (file: { file_name: string; file_path: string }) => void;
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const handleClick = useCallback(() => {
    const ext = getFileExt(file.file_name);
    if (PRESENTABLE_EXTS.has(ext) && onPresentableClick) {
      onPresentableClick(file);
    } else {
      openChatFile(file.file_path);
    }
  }, [file, onPresentableClick]);

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

    if (isPpt(file.file_name)) {
      let cancelled = false;
      setLoading(true);
      getPptThumbnail(file.file_path)
        .then((url) => {
          if (!cancelled) {
            setThumbnail(url);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error('[chat] PPT thumbnail error:', err);
          if (!cancelled) setLoading(false);
        });
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
        onClick={handleClick}
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

  if (isPpt(file.file_name)) {
    return (
      <button
        type="button"
        onClick={handleClick}
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
      onClick={handleClick}
      className="mb-1.5 flex w-full items-center gap-2 rounded-lg bg-background/40 px-2 py-1.5 text-xs hover:bg-background/60"
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="truncate">{file.file_name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(file.file_size)}</span>
    </button>
  );
}

function renderMarkdown(text: string, onYouTubeLink?: (url: string) => void): React.ReactNode[] {
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
        const href = link[2];
        const safe = /^https?:\/\//i.test(href);
        if (safe && onYouTubeLink && urlMediaService.parseYouTubeUrl(href)) {
          return (
            <a
              key={i}
              href={href}
              className="text-blue-400 underline underline-offset-4 hover:text-blue-300"
              onClick={(e) => {
                e.preventDefault();
                onYouTubeLink(href);
              }}
            >
              {link[1]}
            </a>
          );
        }
        return (
          <a
            key={i}
            href={safe ? href : '#'}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'underline underline-offset-4',
              safe
                ? 'text-blue-400 hover:text-blue-300'
                : 'text-muted-foreground cursor-not-allowed'
            )}
            onClick={safe ? undefined : (e) => e.preventDefault()}
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

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

interface YouTubeMeta {
  title: string;
  artist?: string;
  duration?: number;
  thumb: string | null;
}

type ChatFileDialogTarget =
  | { type: 'youtube'; url: string }
  | { type: 'file'; file_name: string; file_path: string }
  | null;

function ChatFileDialog({
  target,
  onClose,
}: {
  target: ChatFileDialogTarget;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [ytMeta, setYtMeta] = useState<YouTubeMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const isYoutube = target?.type === 'youtube';
  const isPptFile = target?.type === 'file' && isPpt(target.file_name);
  const isImage =
    target?.type === 'file' &&
    IMAGE_EXTS.has(target.file_name.split('.').pop()?.toLowerCase() ?? '');

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setSrc(null);
    setYtMeta(null);
    setLoading(false);

    if (target.type === 'youtube') {
      setLoading(true);
      (async () => {
        try {
          const parsed = urlMediaService.parseYouTubeUrl(target.url);
          if (!parsed) return;
          const [metadata, stored] = await Promise.all([
            urlMediaService.resolveYouTube(parsed.canonicalUrl),
            mediaDbService.getFileInfoByOriginalUrl(parsed.canonicalUrl),
          ]);
          const fileInfo: FileInfo = {
            name: metadata.title,
            path: metadata.canonicalUrl,
            size: 0,
            modifiedAt: new Date(),
            extension: 'url',
            thumbnailPath: metadata.thumbnailPath,
            remoteThumbnailUrl: metadata.remoteThumbnailUrl,
          };
          const thumb = await thumbnailService.getMediaThumbnail(fileInfo).catch(() => null);
          if (cancelled) return;
          setYtMeta({
            title: metadata.title,
            artist: metadata.artist,
            duration: stored?.duration,
            thumb,
          });
        } catch (err) {
          console.error('[chat] dialog resolve failed:', err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (target.type === 'file' && isImage) {
      thumbnailService
        .getThumbnail(target.file_path, 600)
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          if (cancelled) return;
          invoke<string>('get_thumbnail', { path: target.file_path, size: 600 })
            .then((cachePath) => readFile(cachePath))
            .then((bytes) => {
              if (!cancelled)
                setSrc(URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
            })
            .catch(() => {});
        });
      return () => {
        cancelled = true;
      };
    }

    if (target.type === 'file' && isPptFile) {
      setLoading(true);
      getPptThumbnail(target.file_path)
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [target, isImage, isPptFile]);

  const handlePlay = useCallback(() => {
    if (!target) return;
    const path = target.type === 'youtube' ? target.url : target.file_path;
    usePlayerStore
      .getState()
      .loadFile(path)
      .catch((err) => console.error('[chat] play failed:', err));
    onClose();
  }, [target, onClose]);

  const handleQueue = useCallback(() => {
    if (target?.type !== 'youtube') return;
    useQueueStore
      .getState()
      .addUrlToQueue(target.url)
      .catch((err) => console.error('[chat] add to queue failed:', err));
    onClose();
  }, [target, onClose]);

  const ready = isYoutube ? !loading && !!ytMeta : isPptFile ? !loading : !!src;
  const fileName = target?.type === 'file' ? target.file_name : null;

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={ready} className="max-w-sm gap-3 p-4">
        <div
          className={cn(
            'flex items-center justify-center overflow-hidden rounded-lg bg-muted/40',
            isYoutube ? 'aspect-video w-full' : 'max-h-[60vh]'
          )}
        >
          {isYoutube ? (
            ytMeta?.thumb ? (
              <img src={ytMeta.thumb} alt={ytMeta.title} className="size-full object-cover" />
            ) : (
              <div className="size-full animate-pulse bg-muted/60" />
            )
          ) : isPptFile ? (
            src ? (
              <img src={src} alt={fileName ?? ''} className="max-h-[60vh] w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <Presentation className="size-12 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t('Presentation')}</span>
              </div>
            )
          ) : src ? (
            <img src={src} alt={fileName ?? ''} className="max-h-[60vh] w-full object-contain" />
          ) : (
            <div className="h-48 w-full animate-pulse bg-muted/60" />
          )}
        </div>

        {isYoutube ? (
          <div className="min-w-0">
            {loading || !ytMeta ? (
              <>
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
                <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </>
            ) : (
              <>
                <p className="text-sm font-medium leading-snug line-clamp-2">{ytMeta.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                  {ytMeta.artist}
                  {ytMeta.duration ? ` · ${formatDuration(ytMeta.duration)}` : ''}
                </p>
              </>
            )}
          </div>
        ) : (
          fileName && <p className="text-sm font-medium text-center truncate">{fileName}</p>
        )}

        <div className="flex gap-2">
          {isYoutube ? (
            <>
              <Button size="sm" className="flex-1" onClick={handlePlay} disabled={loading}>
                {t('Play now')}
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={handleQueue}>
                {t('Add to queue')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" className="flex-1" onClick={handlePlay} disabled={!ready}>
                {t('Present')}
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={onClose}>
                {t('Cancel')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageBubble({
  message,
  showHeader,
  onReply,
  onLinkClick,
  onPresentableClick,
}: {
  message: ChatMessage;
  showHeader: boolean;
  onReply: (msg: ChatMessage) => void;
  onLinkClick: (url: string) => void;
  onPresentableClick: (file: { file_name: string; file_path: string }) => void;
}) {
  const { sendReaction, deleteMessage } = useChatStore();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const deletingRef = useRef(false);
  const isOperator = message.sender_type === 'operator';

  useEffect(() => {
    const el = bubbleRef.current;
    if (!el || seenMessageIds.has(message.id)) return;
    seenMessageIds.add(message.id);
    animate(el, {
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 260,
      ease: 'outCubic',
    });
  }, [message.id]);

  const toggleReaction = useCallback(
    (emoji: string) => {
      sendReaction(message.id, emoji).catch((err) => console.error('[chat] reaction failed:', err));
    },
    [message.id, sendReaction]
  );

  const handleDelete = useCallback(async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    const el = bubbleRef.current;
    if (!el) {
      deleteMessage(message.id).catch((err) => console.error('[chat] delete failed:', err));
      return;
    }
    el.style.pointerEvents = 'none';
    try {
      await animate(el, { opacity: [1, 0], translateY: [0, -8], duration: 160, ease: 'inQuad' });
      await animate(el, { height: [el.offsetHeight, 0], duration: 180, ease: 'inOutQuad' });
    } catch {}
    deleteMessage(message.id).catch((err) => console.error('[chat] delete failed:', err));
  }, [message.id, deleteMessage]);

  const handleCopyText = useCallback(() => {
    navigator.clipboard
      .writeText(message.text || message.file?.file_name || '')
      .catch((err) => console.error('[chat] copy failed:', err));
  }, [message]);

  const handleTextContextMenu = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    setLinkUrl(anchor && href && href !== '#' ? href : null);
  }, []);

  const handleCopyLink = useCallback(() => {
    if (!linkUrl) return;
    navigator.clipboard
      .writeText(linkUrl)
      .catch((err) => console.error('[chat] copy failed:', err));
  }, [linkUrl]);

  return (
    <ContextMenu>
      <ContextMenuTrigger onContextMenu={handleTextContextMenu}>
        <div
          ref={bubbleRef}
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
                      : 'rounded-bl-sm bg-muted/40'
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

              {message.file && (
                <FilePreview file={message.file} onPresentableClick={onPresentableClick} />
              )}
              {message.text && (
                <div className="wrap-break-word whitespace-pre-wrap select-text">
                  {renderMarkdown(message.text, onLinkClick)}
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

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onReply(message)}
                className={cn(
                  'opacity-0 group-hover:opacity-100 transition-opacity absolute top-1/2 -translate-y-1/2',
                  isOperator ? '-left-7.5' : '-right-7.5'
                )}
                title={t('Reply')}
              >
                <Reply />
              </Button>
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
                  className="cursor-pointer gap-1 animate-in fade-in-0 zoom-in-95 duration-150"
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {linkUrl ? (
          <ContextMenuItem onClick={handleCopyLink}>
            <Copy />
            {t('Copy link')}
          </ContextMenuItem>
        ) : (
          (message.text || message.file) && (
            <ContextMenuItem onClick={handleCopyText}>
              <Copy />
              {t('Copy text')}
            </ContextMenuItem>
          )
        )}
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

async function getPptThumbnail(filePath: string): Promise<string | null> {
  const bytes = await readFile(filePath);
  const wrapper = document.createElement('div');
  wrapper.style.position = 'absolute';
  wrapper.style.left = '-9999px';
  wrapper.style.overflow = 'hidden';
  wrapper.style.width = '320px';
  document.body.appendChild(wrapper);

  try {
    const viewer = await PptxViewer.open(bytes.buffer, wrapper, {
      renderMode: 'slide',
      fitMode: 'contain',
      zipLimits: RECOMMENDED_ZIP_LIMITS,
    });
    const th = viewer.renderThumbnailToContainer(0, wrapper, { width: 320 });
    await th?.ready;
    let dataUrl = '';
    if (th?.element) {
      try {
        dataUrl = await toJpeg(th.element, { quality: 0.7, pixelRatio: 2 });
      } catch {}
    }
    th?.dispose();
    viewer.destroy();
    return dataUrl || null;
  } finally {
    wrapper.remove();
  }
}

function ChatTab() {
  const { messages, config, init, sendMessage, sendFile, sendTyping, typingUsers } = useChatStore();
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [dialogTarget, setDialogTarget] = useState<ChatFileDialogTarget>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextEditorRef>(null);
  const firstScrollRef = useRef(true);
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
    if (messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, {
      align: 'end',
      behavior: firstScrollRef.current ? 'auto' : 'smooth',
    });
  }, [messages.length, virtualizer]);

  const handleSend = useCallback(async () => {
    const md = editorRef.current?.getMarkdown().trim() ?? '';
    if (!md || sending) return;
    if (md.length > MAX_MESSAGE_LENGTH) return;
    isNearBottomRef.current = true;
    setSending(true);
    try {
      await sendMessage(md, replyTo?.id);
      editorRef.current?.setMarkdown('');
      setReplyTo(null);
      setCharCount(0);
    } catch (err) {
      console.error('[chat] send failed:', err);
    } finally {
      setSending(false);
      editorRef.current?.focus();
    }
  }, [sending, sendMessage, replyTo]);

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

  useEffect(() => {
    if (messages.length === 0 || !isNearBottomRef.current) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
    const correction = setTimeout(() => {
      scrollToBottom();
      firstScrollRef.current = false;
    }, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(correction);
    };
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
      <ChatFileDialog target={dialogTarget} onClose={() => setDialogTarget(null)} />
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
                  <MessageBubble
                    message={message}
                    showHeader={showHeader}
                    onReply={setReplyTo}
                    onLinkClick={(url) => setDialogTarget({ type: 'youtube', url })}
                    onPresentableClick={(file) => setDialogTarget({ type: 'file', ...file })}
                  />
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
