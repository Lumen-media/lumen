import { createFileRoute } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';

export const Route = createFileRoute('/_layout/live')({
  component: RouteComponent,
});

function RouteComponent() {
  return <Card className="w-full h-full gap-3">Live</Card>;
}
