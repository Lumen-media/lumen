import { createFileRoute } from '@tanstack/react-router';
import { PreviewPanel } from '@/components/preview-panel';

export const Route = createFileRoute('/_layout/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <PreviewPanel />;
}
