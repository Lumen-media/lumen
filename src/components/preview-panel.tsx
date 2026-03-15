import { CardContent } from '@/components/ui/card';

export function PreviewPanel() {
  return (
    <CardContent className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
      <span className="text-muted-foreground text-sm font-medium">Your slide preview</span>
    </CardContent>
  );
}
