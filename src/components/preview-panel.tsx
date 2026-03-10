import { useState } from 'react';
import { MiniPlayer } from '@/components/miniplayer';
import { Card } from '@/components/ui/card';

export function PreviewPanel() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <Card className="w-full h-full gap-3">
      <div className="flex-1 rounded-lg bg-background/80 flex items-center justify-center min-h-0">
        <span className="text-muted-foreground text-sm font-medium">Your slide preview</span>
      </div>

      <MiniPlayer
        isPlaying={isPlaying}
        onPlayPause={() => setIsPlaying((p) => !p)}
      />
    </Card>
  );
}
