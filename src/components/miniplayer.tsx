import {
  LucideMonitorOff,
  LucideMonitorPlay,
  LucidePause,
  LucidePlay,
  LucideRepeat,
  LucideSkipBack,
  LucideSkipForward,
  LucideSquare,
  LucideVolume2,
  LucideVolumeX,
} from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { mediaDbService } from '@/services/media-db-service';
import { usePlayerStore } from '@/stores/player-store';
import { useQueueStore } from '@/stores/queue-store';

interface MiniPlayerProps {
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function MiniPlayer({ className }: MiniPlayerProps) {
  const player = usePlayerStore();
  const queue = useQueueStore();

  useEffect(() => {
    const cleanupWs = player.initWs();
    const cleanupListeners = player.initListeners();
    player.restoreLastMedia();
    return () => {
      cleanupWs();
      cleanupListeners();
    };
  }, [player.initWs, player.initListeners, player.restoreLastMedia]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const { source, path, action } = (
        e as CustomEvent<{ source: string; path: string; action: 'play' | 'queue' }>
      ).detail;

      if (action === 'play') {
        if (source === 'lyric') {
          await player.presentLyric(path);
          return;
        }
        if (source === 'image') {
          await player.presentImage(path);
          return;
        }
        await player.loadFile(path);
        return;
      }

      if (action === 'queue') {
        const hit = await mediaDbService.getByPath(path);
        if (!hit) return;
        await queue.addToQueue({
          name: hit.name,
          path: hit.path,
          size: 0,
          modifiedAt: new Date(hit.modified_at),
          extension: hit.original_url ? 'url' : (hit.path.split('.').pop() ?? ''),
          duration: hit.duration ?? undefined,
          artist: hit.artist ?? undefined,
          originalUrl: hit.original_url ?? undefined,
          thumbnailPath: hit.thumbnail_path ?? undefined,
          remoteThumbnailUrl: hit.remote_thumbnail_url ?? undefined,
          downloadStatus:
            hit.download_status === 'not_downloaded' ||
            hit.download_status === 'downloaded' ||
            hit.download_status === 'missing'
              ? hit.download_status
              : hit.original_url
                ? 'not_downloaded'
                : 'downloaded',
        });
      }
    };

    window.addEventListener('lumen:commander-open', handler);
    return () => window.removeEventListener('lumen:commander-open', handler);
  }, [player, queue]);

  const iconBtn =
    'p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors';

  return (
    <div className={cn('bg-card border rounded-xl p-3 flex flex-col gap-1', className)}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {player.localTitle && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold leading-tight truncate">
                {player.localTitle}
              </span>
              {player.localArtist && (
                <span className="text-xs text-muted-foreground leading-tight truncate">
                  {player.localArtist}
                </span>
              )}
            </div>
          )}
          {player.isLiveStream ? (
            <div className="flex h-5 items-center">
              <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-red-500/10 px-2 text-[11px] font-semibold leading-none text-red-500">
                <span className="size-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.75)]" />
                AO VIVO
              </span>
            </div>
          ) : (
            <>
              <Slider
                min={0}
                max={Math.max(player.localDuration, 1)}
                value={[Math.min(player.localTime, Math.max(player.localDuration, 1))]}
                onValueChange={player.handleSliderChange}
                onValueCommit={player.handleSliderCommit}
                onPointerDown={() => player.setIsDragging(true)}
                trackClassName="bg-muted"
                rangeClassName="bg-primary"
                thumbClassName="size-2.5 border-primary bg-primary shadow-none focus-visible:ring-0"
              />
              {(player.localTime > 0 || player.localDuration > 0) && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatTime(player.localTime)}</span>
                  <span>{formatTime(player.localDuration)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={player.handleToggleScreen}
          className={cn(
            'p-2 rounded-lg transition-colors',
            player.isScreenOpen ? 'text-primary bg-primary/10 hover:bg-primary/20' : iconBtn
          )}
          aria-label={player.isScreenOpen ? 'Close media screen' : 'Open media screen'}
        >
          {player.isScreenOpen ? (
            <LucideMonitorOff className="size-4" />
          ) : (
            <LucideMonitorPlay className="size-4" />
          )}
        </Button>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={player.handleStop}
            className={iconBtn}
            aria-label="Stop"
          >
            <LucideSquare className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={player.handlePrevious}
            className={iconBtn}
            aria-label="Previous"
          >
            <LucideSkipBack className="size-4" />
          </Button>

          <Button
            type="button"
            size="icon"
            onClick={player.handlePlayPause}
            className="size-10 rounded-full bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-[opacity,transform]"
            aria-label={player.isPlaying ? 'Pause' : 'Play'}
          >
            {player.isPlaying ? (
              <LucidePause className="size-4" />
            ) : (
              <LucidePlay className="size-4" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={player.handleNext}
            className={iconBtn}
            aria-label="Next"
          >
            <LucideSkipForward className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={player.handleLoop}
            className={cn(
              'p-2 rounded-lg transition-colors',
              player.isLoop ? 'text-primary bg-primary/10 hover:bg-primary/20' : iconBtn
            )}
            aria-label="Loop"
          >
            <LucideRepeat className="size-4" />
          </Button>
        </div>

        <HoverCard>
          <HoverCardTrigger delay={100} closeDelay={150}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtn}
              aria-label="Volume"
              onClick={player.handleMuteToggle}
            >
              {player.isMuted || player.volume === 0 ? (
                <LucideVolumeX className="size-4" />
              ) : (
                <LucideVolume2 className="size-4" />
              )}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent side="top" className="w-9 p-2 flex flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{player.volume}</span>
            <Slider
              orientation="vertical"
              min={0}
              max={100}
              value={[player.volume]}
              onValueChange={player.handleVolumeChange}
              onValueCommit={player.handleVolumeCommit}
              className="h-7"
              trackClassName="bg-muted"
              rangeClassName="bg-primary"
              thumbClassName="size-3 border-primary bg-primary shadow-none focus-visible:ring-0"
            />
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  );
}
