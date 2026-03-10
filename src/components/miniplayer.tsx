import { LucidePause, LucidePlay, LucidePlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface MiniPlayerProps {
  title?: string;
  subtitle?: string;
  duration?: number;
  currentTime?: number;
  onTimeChange?: (time: number) => void;
  onPlayPause?: () => void;
  isPlaying?: boolean;
  thumbnail?: string;
  className?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export function MiniPlayer({
  title = 'Untitled',
  subtitle,
  duration = 600,
  currentTime = 0,
  onTimeChange,
  onPlayPause,
  isPlaying = false,
  thumbnail,
  className,
}: MiniPlayerProps) {
  const [localTime, setLocalTime] = useState(currentTime);

  const time = onTimeChange !== undefined ? currentTime : localTime;

  function handleSliderChange(value: number[]) {
    const newTime = value[0] ?? 0;
    if (onTimeChange) {
      onTimeChange(newTime);
    } else {
      setLocalTime(newTime);
    }
  }

  return (
    <div className={cn('bg-card border rounded-xl p-3 flex items-center gap-3', className)}>
      {/* Thumbnail */}
      <div className="size-12 shrink-0 rounded-lg bg-muted overflow-hidden">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
      </div>

      {/* Info + Seek */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight truncate">{title}</span>
          {subtitle && (
            <span className="text-xs text-muted-foreground leading-tight">{subtitle}</span>
          )}
        </div>
        <Slider
          min={0}
          max={duration}
          value={[time]}
          onValueChange={handleSliderChange}
          trackClassName="bg-muted"
          rangeClassName="bg-primary"
          thumbClassName="size-3 border-primary bg-primary shadow-none focus-visible:ring-0"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatTime(time)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Play/Pause button */}
      <button
        type="button"
        onClick={onPlayPause}
        className="size-11 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:opacity-90 active:scale-95 transition-[opacity,transform]"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <LucidePause /> : <LucidePlay />}
      </button>
    </div>
  );
}
