import { createFileRoute } from '@tanstack/react-router';
import { CardContent } from '@/components/ui/card';
import { useLyricModalStore } from '@/stores/lyric-modal-store';

export const Route = createFileRoute('/_layout/edit')({
  component: RouteComponent,
});

function RouteComponent() {
  const openLyricModal = useLyricModalStore((s) => s.open);

  return (
    <CardContent className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
      <button
        type="button"
        className="text-muted-foreground text-sm font-medium"
        onClick={() => openLyricModal()}
      >
        Edit
      </button>
    </CardContent>
  );
}
