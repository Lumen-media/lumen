import { useDraggable } from '@dnd-kit/core';
import { invoke } from '@tauri-apps/api/core';
import {
  File,
  FileText,
  FolderOpen,
  Headphones,
  Image as ImageIcon,
  ListPlus,
  ListVideo,
  Music,
  Pencil,
  Presentation,
  Trash2,
  Video,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileInfo, MediaType } from '@/services';
import { thumbnailService } from '@/services/thumbnail-service';
import { useDeleteFileStore } from '@/stores/delete-file-store';

interface FileListItemProps {
  file: FileInfo;
  mediaType: MediaType;
  onClick?: (file: FileInfo) => void;
  onDoubleClick?: (file: FileInfo) => void;
  onEdit?: (file: FileInfo) => void;
  onPlayNext?: (file: FileInfo) => void;
  onAddToQueue?: (file: FileInfo) => void;
  isFocused?: boolean;
}

const THUMBNAIL_TYPES = new Set<MediaType>(['video', 'image']);

function isUnsupportedPresentation(ext: string): boolean {
  const e = ext.startsWith('.') ? ext : `.${ext}`;
  return ['.odp', '.pptm', '.ppsx', '.potx', '.key'].includes(e);
}

function isUrlMedia(file: FileInfo): boolean {
  return file.extension === 'url' || Boolean(file.originalUrl);
}

function downloadStatusLabel(file: FileInfo): string | null {
  if (!isUrlMedia(file)) return null;
  switch (file.downloadStatus) {
    case 'downloaded':
      return 'Downloaded';
    case 'missing':
      return 'Missing download';
    default:
      return 'Not downloaded';
  }
}

const ICON_BY_EXT: Record<string, typeof File> = {
  '.mp3': Headphones, '.wav': Headphones, '.ogg': Headphones,
  '.flac': Headphones, '.m4a': Headphones,
  '.mp4': Video, '.avi': Video, '.mov': Video, '.mkv': Video, '.webm': Video,
  '.jpg': ImageIcon, '.jpeg': ImageIcon, '.png': ImageIcon,
  '.gif': ImageIcon, '.webp': ImageIcon, '.svg': ImageIcon,
  '.txt': FileText, '.md': FileText, '.doc': FileText,
  '.docx': FileText, '.pdf': FileText,
  '.ppt': Presentation, '.pptx': Presentation, '.pptm': Presentation,
  '.potx': Presentation, '.ppsx': Presentation, '.odp': Presentation, '.key': Presentation,
  '.lrc': Music, '.srt': Music,
};

function iconForMedia(mediaType: MediaType, extension?: string): typeof File {
  if (mediaType === 'files' && extension) {
    const ext = extension.toLowerCase();
    const extWithDot = ext.startsWith('.') ? ext : `.${ext}`;
    const found = ICON_BY_EXT[extWithDot];
    if (found) return found;
  }

  if (mediaType === 'lyrics') return Music;
  if (mediaType === 'video') return Video;
  if (mediaType === 'audio') return Headphones;
  if (mediaType === 'image') return ImageIcon;
  if (mediaType === 'presentation') return Presentation;
  if (mediaType === 'text') return FileText;

  return File;
}

function FileThumbnail({ file, mediaType }: { file: FileInfo; mediaType: MediaType }) {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!THUMBNAIL_TYPES.has(mediaType)) return;
    let cancelled = false;
    thumbnailService
      .getMediaThumbnail(file)
      .then((url) => {
        if (!cancelled) setThumbSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file, mediaType]);

  const Icon = iconForMedia(mediaType, file.extension);

  if (!THUMBNAIL_TYPES.has(mediaType) || failed) {
    return <Icon className="size-5 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />;
  }

  return (
    <div className="h-10 aspect-video rounded overflow-hidden bg-muted shrink-0">
      {thumbSrc ? (
        <img src={thumbSrc} alt="" className="w-full h-full object-cover" aria-hidden="true" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon className="size-3 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
};

const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function FileListItem({
  file,
  mediaType,
  onClick,
  onDoubleClick,
  onEdit,
  onPlayNext,
  onAddToQueue,
  isFocused,
}: FileListItemProps) {
  const { openDeleteDialog } = useDeleteFileStore();
  const urlMedia = isUrlMedia(file);
  const statusLabel = downloadStatusLabel(file);
  const fileSizeLabel = urlMedia ? 'URL' : formatFileSize(file.size);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `media-file:${file.path}`,
    data: { type: 'media-file', file },
  });

  const handleClick = () => {
    if (onClick) {
      onClick(file);
    }
  };

  const handleDoubleClick = () => {
    if (onDoubleClick) {
      onDoubleClick(file);
    }
  };

  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (urlMedia) return;
    try {
      const folderPath = file.path.substring(0, file.path.lastIndexOf('\\'));
      await invoke('open_folder', { path: folderPath });
    } catch (error) {
      console.error('Failed to open folder:', error);
      toast.error('Failed to open folder');
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDeleteDialog(file);
  };

  const fileDescription = `${file.name}, ${fileSizeLabel}, modified ${formatDate(file.modifiedAt)}`;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          style={{ opacity: isDragging ? 0.5 : undefined }}
        >
          <Button
            variant="ghost"
            className={`w-full justify-start text-left p-3 h-auto ${isFocused ? 'ring-2 ring-ring' : ''}`}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            aria-label={fileDescription}
          >
            <div className="flex items-start gap-3 w-full min-w-0">
              <FileThumbnail file={file} mediaType={mediaType} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{file.title || file.name}</p>
                <div
                  className="flex items-center gap-2 mt-1 text-sm text-muted-foreground"
                  aria-hidden="true"
                >
                  {file.originalUrl && (
                    <Badge variant="secondary" className="h-4 rounded px-1.5 text-[10px]">
                      YouTube
                    </Badge>
                  )}
                  {statusLabel && (
                    <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px]">
                      {statusLabel}
                    </Badge>
                  )}
                  {!statusLabel && <span>{fileSizeLabel}</span>}
                  <span>-</span>
                  <span className="truncate">{formatDate(file.modifiedAt)}</span>
                </div>
              </div>
            </div>
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent side="bottom">
        {onDoubleClick && (
          <>
            <ContextMenuItem onClick={() => onDoubleClick(file)}>
              {(() => {
                const Icon = iconForMedia(mediaType, file.extension);
                return <Icon className="h-4 w-4" aria-hidden="true" />;
              })()}
              Open
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!isUnsupportedPresentation(file.extension) && (onPlayNext || onAddToQueue) && (
          <>
            {onPlayNext && (
              <ContextMenuItem onClick={() => onPlayNext(file)}>
                <ListVideo className="h-4 w-4" aria-hidden="true" />
                Play next
              </ContextMenuItem>
            )}
            {onAddToQueue && (
              <ContextMenuItem onClick={() => onAddToQueue(file)}>
                <ListPlus className="h-4 w-4" aria-hidden="true" />
                Add to queue
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        {onEdit && (
          <>
            <ContextMenuItem onClick={() => onEdit(file)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {!urlMedia && (
          <ContextMenuItem onClick={handleOpenFolder}>
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Open folder
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={handleDeleteClick} variant="destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
