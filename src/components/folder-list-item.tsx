import { Folder, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MediaFolder } from '@/services';
import { useDeleteFolderStore } from '@/stores/delete-folder-store';
import { cn } from '@/lib/utils';

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

  return (
    <div className="flex items-center gap-1 w-full min-w-0">
      <Button
        variant="ghost"
        className={`w-full justify-start text-left p-3 h-auto ${isFocused ? 'ring-2 ring-ring' : ''}`}
        onClick={() => onClick(folder)}
        aria-label={`Open folder ${folder.name}`}
      >
        <div className="flex items-center gap-3 w-full min-w-0">
          <Folder className="size-5 text-muted-foreground shrink-0" aria-hidden="true" />
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
  );
}
