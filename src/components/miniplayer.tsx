import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
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
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';

interface MiniPlayerProps {
  title?: string;
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
  duration = 0,
  currentTime = 0,
  onTimeChange,
  onPlayPause,
  isPlaying = false,
  thumbnail,
  className,
}: MiniPlayerProps) {
  const [localTime, setLocalTime] = useState(currentTime);
  const [localDuration, setLocalDuration] = useState(duration);
  const [localTitle, setLocalTitle] = useState(title);
  const [localUrl, setLocalUrl] = useState<string | undefined>(thumbnail);
  const [isLoop, setIsLoop] = useState(false);
  const [isScreenOpen, setIsScreenOpen] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const isDragging = useRef(false);

  function handleMuteToggle() {
    const next = !isMuted;
    setIsMuted(next);
    sendWs({ event: 'set_volume', value: next ? 0 : volume });
  }

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');
    socket.onopen = () => {
      wsRef.current = socket;
    };
    socket.onclose = () => {
      wsRef.current = null;
    };
    socket.onerror = () => {
      wsRef.current = null;
    };
    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<{ seconds: number; duration: number }>(
      'video-progress',
      (event) => {
        if (isDragging.current) return;
        setLocalTime(event.payload.seconds);
        if (event.payload.duration > 0) setLocalDuration(event.payload.duration);
      }
    );
    const unlistenMeta = listen<{ title: string; url: string }>('video-metadata', (event) => {
      setLocalTitle(event.payload.title);
      setLocalUrl(event.payload.url);
    });
    const unlistenStop = listen('stop', () => {
      setIsScreenOpen(false);
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenMeta.then((f) => f());
      unlistenStop.then((f) => f());
    };
  }, []);

  function sendWs(message: object) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }

  function handlePlayPause() {
    sendWs({ event: 'play_pause' });
    onPlayPause?.();
  }

  function handleStop() {
    sendWs({ event: 'stop' });
    setLocalTime(0);
  }

  function handlePrevious() {
    sendWs({ event: 'previous' });
  }

  function handleNext() {
    sendWs({ event: 'next' });
  }

  function handleLoop() {
    const next = !isLoop;
    setIsLoop(next);
    sendWs({ event: 'set_loop', value: next ? 1 : 0 });
  }

  function handleVolumeChange(value: number[]) {
    const v = value[0] ?? 100;
    setVolume(v);
    sendWs({ event: 'set_volume', value: v });
  }

  function handleSliderChange(value: number[]) {
    const newTime = value[0] ?? 0;
    sendWs({ event: 'seek', value: newTime });
    setLocalTime(newTime);
    onTimeChange?.(newTime);
  }

  async function handleToggleScreen() {
    const existing = await WebviewWindow.getByLabel('media-window');
    if (existing) {
      await existing.close();
      setIsScreenOpen(false);
    } else {
      try {
        await invoke('create_window', { label: 'media-window', title: 'Media Player' });
        setIsScreenOpen(true);
      } catch {}
    }
  }

  const iconBtn =
    'p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors';

  return (
    <div className={cn('bg-card border rounded-xl p-3 flex flex-col gap-0', className)}>
      <div className="flex items-center gap-3">
        <div className="h-10 aspect-video shrink-0 rounded bg-muted overflow-hidden">
          {localUrl ? (
            <img src={localUrl} alt={localTitle} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-sm font-semibold leading-tight truncate">{localTitle}</span>
          <Slider
            min={0}
            max={localDuration}
            value={[localTime]}
            onValueChange={handleSliderChange}
            onValueCommit={() => {
              isDragging.current = false;
            }}
            onPointerDown={() => {
              isDragging.current = true;
            }}
            trackClassName="bg-muted"
            rangeClassName="bg-primary"
            thumbClassName="size-2.5 border-primary bg-primary shadow-none focus-visible:ring-0"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(localTime)}</span>
            <span>{formatTime(localDuration)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleToggleScreen}
          className={cn(
            'p-2 rounded-lg transition-colors',
            isScreenOpen
              ? 'text-primary bg-primary/10 hover:bg-primary/20'
              : iconBtn
          )}
          aria-label={isScreenOpen ? 'Close media screen' : 'Open media screen'}
        >
          {isScreenOpen
            ? <LucideMonitorOff className="size-4" />
            : <LucideMonitorPlay className="size-4" />
          }
        </Button>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleStop}
            className={iconBtn}
            aria-label="Stop"
          >
            <LucideSquare className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handlePrevious}
            className={iconBtn}
            aria-label="Previous"
          >
            <LucideSkipBack className="size-4" />
          </Button>

          <Button
            type="button"
            size="icon"
            onClick={handlePlayPause}
            className="size-10 rounded-full bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-[opacity,transform]"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <LucidePause className="size-4" /> : <LucidePlay className="size-4" />}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleNext}
            className={iconBtn}
            aria-label="Next"
          >
            <LucideSkipForward className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleLoop}
            className={cn(
              'p-2 rounded-lg transition-colors',
              isLoop ? 'text-primary bg-primary/10 hover:bg-primary/20' : iconBtn
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
              onClick={handleMuteToggle}
            >
              {isMuted || volume === 0 ? (
                <LucideVolumeX className="size-4" />
              ) : (
                <LucideVolume2 className="size-4" />
              )}
            </Button>
          </HoverCardTrigger>
          <HoverCardContent side="top" className="w-9 p-2 flex flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{volume}</span>
            <Slider
              orientation="vertical"
              min={0}
              max={100}
              value={[volume]}
              onValueChange={handleVolumeChange}
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
