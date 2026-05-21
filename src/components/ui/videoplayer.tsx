'use client';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { LucidePause, LucidePlay, LucideVolume2, LucideVolumeOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { cn } from '@/lib/utils';
import { thumbnailService } from '@/services/thumbnail-service';
import { Slider } from './slider';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const formatTime = (time: number) => {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

export type VideoplayerProps = {
  className?: string;
  url?: string;
  autoplay?: boolean;
  muted?: boolean;
  interactive?: boolean;
};

type stateTypes = {
  loaded: number;
  loadedSeconds: number;
  played: number;
  playedSeconds: number;
};

export const Videoplayer = ({
  className,
  url,
  autoplay = true,
  muted = false,
  interactive = true,
}: VideoplayerProps) => {
  async function fetchMetadata(
    videoUrl: string
  ): Promise<{ title: string; thumbnail?: string; artist?: string }> {
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      try {
        const u = new URL(videoUrl);
        if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
          const res = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
          );
          if (res.ok) {
            const data = await res.json();
            return {
              title: data.title,
              thumbnail: data.thumbnail_url,
              artist: data.author_name ?? undefined,
            };
          }
          return { title: 'YouTube Video' };
        }
      } catch {}
    }
    const raw = videoUrl.split(/[\\/]/).pop() ?? videoUrl;
    const decoded = decodeURIComponent(raw);
    return { title: decoded.replace(/\.[^.]+$/, '') };
  }
  const playerRef = useRef<ReactPlayer>(null);
  const currentBlobUrl = useRef<string | null>(null);
  const currentFilePath = useRef<string | null>(null);
  const pendingThumbnail = useRef<string | null>(null);
  const pendingSeekTime = useRef<number | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playing, setPlaying] = useState(autoplay);
  const [volume, setVolume] = useState(1);
  const [mutedState, setMutedState] = useState(muted);
  const [played, setPlayed] = useState(0);
  const [_loaded, setLoaded] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [activeUrl, setActiveUrl] = useState(url ?? '');

  useEffect(() => {
    setPlaying(autoplay);
  }, [autoplay]);

  useEffect(() => {
    setMutedState(muted);
  }, [muted]);

  const handlePlayPause = useCallback(() => {
    if (playing && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'manual_pause' }));
    }
    setPlaying((prevPlaying) => !prevPlaying);
  }, [playing, ws]);

  const handleVolumeChange = (e: number) => {
    setVolume(e);
  };

  const handleMute = useCallback(() => {
    setMutedState((prevMuted) => !prevMuted);
  }, []);

  const handleProgress = (state: stateTypes) => {
    setPlayed(state.played);
    setLoaded(state.loaded);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: 'progress',
          value: state.playedSeconds,
          duration: playerRef.current?.getDuration() ?? 0,
        })
      );
    }
  };

  const handleSeekChange = (value: number) => {
    if (!playerRef.current) {
      return;
    }
    playerRef.current.seekTo(value);
    setPlayed(value);
  };

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');

    socket.onopen = () => {
      setWs(socket);
    };

    socket.onclose = () => {
      setWs(null);
    };

    socket.onerror = (error) => {
      setWs(null);
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    const unlistenVolume = listen('set-volume', (event) => {
      const volumeReceived = event.payload as number;
      if (typeof volumeReceived === 'number' && volumeReceived >= 0 && volumeReceived <= 100) {
        const newVolumeState = volumeReceived / 100;
        setVolume(newVolumeState);
      }
    });

    const unlistenMute = listen('mute', () => {
      handleMute();
    });

    const unlistenPlayPause = listen('play-pause', () => {
      handlePlayPause();
    });

    const unlistenSeek = listen('seek', (event) => {
      const seconds = event.payload as number;
      if (playerRef.current) {
        playerRef.current.seekTo(seconds, 'seconds');
        setPlayed(seconds / (playerRef.current.getDuration() || 1));
      }
    });

    const unlistenLoop = listen('video-loop', (event) => {
      setIsLooping(event.payload as boolean);
    });

    const unlistenStop = listen('stop', () => {
      setPlaying(false);
      if (playerRef.current) {
        playerRef.current.seekTo(0, 'seconds');
        setPlayed(0);
      }
    });

    const unlistenLoadUrl = listen<{ url: string; time: number }>('load-url', async (event) => {
      const { url: filePath, time: seekTime } = event.payload;
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current);
        currentBlobUrl.current = null;
      }
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        avi: 'video/x-msvideo',
        mov: 'video/quicktime',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
      };
      const mime = mimeTypes[ext] ?? 'application/octet-stream';
      const data = await readFile(filePath);
      const blobUrl = URL.createObjectURL(new Blob([data], { type: mime }));
      currentBlobUrl.current = blobUrl;
      currentFilePath.current = filePath;
      pendingSeekTime.current = seekTime > 0 ? seekTime : null;
      if (mime.startsWith('video/')) {
        pendingThumbnail.current = await thumbnailService.getThumbnail(filePath).catch(() => null);
      } else {
        pendingThumbnail.current = null;
      }
      setPlayed(0);
      setActiveUrl(blobUrl);
      setPlaying(true);
    });

    return () => {
      unlistenVolume.then((f) => f());
      unlistenMute.then((f) => f());
      unlistenPlayPause.then((f) => f());
      unlistenSeek.then((f) => f());
      unlistenLoop.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenLoadUrl.then((f) => f());
    };
  }, [handleMute, handlePlayPause]);

  return (
    <div
      className={cn(
        'relative mx-auto group overflow-y-hidden',
        {
          'pointer-events-none': !interactive,
        },
        className
      )}
    >
      <ReactPlayer
        ref={playerRef}
        url={activeUrl}
        playing={playing}
        volume={volume}
        muted={mutedState}
        onReady={async () => {
          if (pendingSeekTime.current !== null && pendingSeekTime.current > 0) {
            playerRef.current?.seekTo(pendingSeekTime.current, 'seconds');
            pendingSeekTime.current = null;
          }
          if (ws?.readyState === WebSocket.OPEN) {
            const meta = await fetchMetadata(currentFilePath.current ?? activeUrl);
            const thumbnail = pendingThumbnail.current ?? meta.thumbnail ?? '';
            pendingThumbnail.current = null;
            ws.send(
              JSON.stringify({
                event: 'metadata',
                title: meta.title,
                url: thumbnail,
                artist: meta.artist ?? '',
              })
            );
          }
        }}
        onProgress={handleProgress}
        onEnded={() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'stop' }));
          }
          setPlaying(false);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        loop={isLooping}
        controls={false}
        width="100%"
        height="100%"
      />

      <div
        className={cn(
          'controls flex flex-col gap-1 absolute bottom-0 left-0 w-full bg-linear-to-t from-black/60 to-transparent p-4 translate-y-20 group-hover:translate-0 transition-transform duration-300',
          {
            'translate-y-0': !playing,
          }
        )}
      >
        <Slider
          trackClassName="rounded-[0.125rem] bg-muted/60"
          rangeClassName="bg-red-500"
          thumbClassName="group-hover:opacity-100 opacity-0 transition-all duration-400 bg-red-500 border-none"
          value={[played]}
          onValueChange={(value) => handleSeekChange(value[0])}
          max={1}
          step={0.01}
        />
        <div className="flex">
          <Tooltip>
            <TooltipTrigger
              className="text-white/80 hover:text-white p-3"
              onClick={handlePlayPause}
            >
              {playing ? (
                <LucidePause fill="white" className="size-4" />
              ) : (
                <LucidePlay fill="white" className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent className="pointer-events-none">
              {playing ? 'Pause' : 'Play'}
            </TooltipContent>
          </Tooltip>

          <div className="flex items-center group/controls">
            <Tooltip>
              <TooltipTrigger className="text-white/80 hover:text-white p-3" onClick={handleMute}>
                {mutedState ? (
                  <LucideVolumeOff fill="white" className="size-4" />
                ) : (
                  <LucideVolume2 fill="white" className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {muted ? 'Unmute' : 'Mute'}
              </TooltipContent>
            </Tooltip>

            <Slider
              className="w-0 opacity-0 group-hover/controls:w-[4.3dvw] group-hover/controls:opacity-100 transition-discrete duration-300"
              trackClassName="bg-gray-300/60 data-[orientation=horizontal]:h-1"
              rangeClassName="bg-white"
              thumbClassName="bg-white border-none size-3"
              value={[volume]}
              onValueChange={(value) => handleVolumeChange(value[0])}
              min={0}
              max={1}
              step={0.01}
            />
          </div>
          <p className="text-gray-200 flex items-center gap-2 ml-3 text-[0.75rem]">
            <span>{formatTime(playerRef.current?.getCurrentTime() || 0)}</span>/
            <span>{formatTime(playerRef.current?.getDuration() || 0)}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
