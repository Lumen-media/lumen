import { createFileRoute } from '@tanstack/react-router';
import { CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/_layout/settings')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <CardContent className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
      Settings
    </CardContent>
  );
}
