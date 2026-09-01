import { Loader2 } from 'lucide-react';
import { useOptimizingStore } from '@/stores/optimizing-store';

export function OptimizingIndicator() {
  const count = useOptimizingStore((s) => s.active.size);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      <span className="text-muted-foreground">
        Otimizando imagens{count > 1 ? ` (${count})` : ''}…
      </span>
    </div>
  );
}