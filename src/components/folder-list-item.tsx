import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, FolderOpen, FolderPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { MediaFolder } from '@/services';
import { useDeleteFolderStore } from '@/stores/delete-folder-store';

interface FolderListItemProps {
  folder: MediaFolder;
  isFocused?: boolean;
  onClick: (folder: MediaFolder) => void;
}

export function FolderListItem({ folder, isFocused, onClick }: FolderListItemProps) {
  const openDeleteDialog = useDeleteFolderStore((s) => s.openDeleteDialog);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDeleteDialog(folder);
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_folder', { path: folder.absolutePath });
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="flex items-center gap-1 w-full min-w-0">
          <Button
            variant="ghost"
            className={`w-full justify-start text-left p-3 h-auto ${isFocused ? 'ring-2 ring-ring' : ''}`}
            onClick={() => onClick(folder)}
            aria-label={`Open folder ${folder.name}`}
          >
            <div className="flex items-center gap-3 w-full min-w-0">
              <FolderOpen className="size-5 text-muted-foreground shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{folder.name}</span>
            </div>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('rounded-full shrink-0', isFocused && 'ring-2 ring-ring')}
            onClick={handleDeleteClick}
            aria-label={`Delete folder ${folder.name}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent side="bottom">
        <ContextMenuItem onClick={() => onClick(folder)}>
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleOpenFolder}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDeleteClick} variant="destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
