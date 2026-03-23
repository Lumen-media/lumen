import { createFileRoute } from '@tanstack/react-router';
import { CardContent } from '@/components/ui/card';
import { LyricModal } from '@/components/lyric-modal';

export const Route = createFileRoute('/_layout/edit')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <CardContent className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
      <span className="text-muted-foreground text-sm font-medium">
        <LyricModal>Edit</LyricModal>
      </span>
    </CardContent>
  );
}
