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
  Trash2,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { FileInfo, MediaType } from '@/services';
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

const getMediaIcon = (mediaType: MediaType) => {
  switch (mediaType) {
    case 'lyrics':
      return Music;
    case 'video':
      return Video;
    case 'audio':
      return Headphones;
    case 'image':
      return ImageIcon;
    case 'text':
      return FileText;
    case 'files':
      return File;
    default:
      return File;
  }
};

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
  const Icon = getMediaIcon(mediaType);
  const { openDeleteDialog } = useDeleteFileStore();

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

  const fileDescription = `${file.name}, ${formatFileSize(file.size)}, modified ${formatDate(file.modifiedAt)}`;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Button
          variant="ghost"
          className={`w-full justify-start text-left p-3 h-auto ${isFocused ? 'ring-2 ring-ring' : ''}`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          aria-label={fileDescription}
        >
          <div className="flex items-start gap-3 w-full min-w-0">
            <div className="shrink-0 mt-0.5">
              <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{file.name}</p>
              <div
                className="flex items-center gap-3 mt-1 text-sm text-muted-foreground"
                aria-hidden="true"
              >
                <span>{formatFileSize(file.size)}</span>
                <span>•</span>
                <span className="truncate">{formatDate(file.modifiedAt)}</span>
              </div>
            </div>
          </div>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent side="bottom">
        {(onPlayNext || onAddToQueue) && (
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
        <ContextMenuItem onClick={handleOpenFolder}>
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Open folder
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDeleteClick} variant="destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
