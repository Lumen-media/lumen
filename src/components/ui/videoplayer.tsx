"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, useCallback } from "react";
import ReactPlayer from "react-player";
import { listen } from "@tauri-apps/api/event";
import { Slider } from "./slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import {
  LucidePause,
  LucidePlay,
  LucideVolume2,
  LucideVolumeOff,
} from "lucide-react";

const formatTime = (time: number) => {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

export type VideoplayerProps = {
  className?: string;
};

type stateTypes = {
  loaded: number;
  loadedSeconds: number;
  played: number;
  playedSeconds: number;
};

export const Videoplayer = ({ className }: VideoplayerProps) => {
  // const video = "/video.mp4";
  const video = "https://www.youtube.com/watch?v=zajUgQLviwk";
  const playerRef = useRef<ReactPlayer>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [played, setPlayed] = useState(0);
  const [loaded, setLoaded] = useState(0);

  const handlePlayPause = () => {
    setPlaying(!playing);
  };

  const handleVolumeChange = (e: number) => {
    setVolume(e);
  };

  const handleMute = useCallback(() => {
    setMuted((prevMuted) => !prevMuted);
  }, []);

  const handleProgress = (state: stateTypes) => {
    setPlayed(state.played);
    setLoaded(state.loaded);
  };

  const handleSeekChange = (value: number) => {
    if (!playerRef.current) {
      return;
    }
    playerRef.current.seekTo(value);
    setPlayed(value);
  };

  useEffect(() => {
    const unlistenVolumeUp = listen("volume-up", () => {
      console.log("Volume Up event received");
    });

    const unlistenVolumeDown = listen("volume-down", () => {
      console.log("Volume Down event received");
    });

    const unlistenMute = listen("mute", () => {
      handleMute();
      console.log("Mute event received here");
    });

    const unlistenPlayPause = listen("play-pause", () => {
      handlePlayPause();
      console.log("Play/Pause event received here");
    });

    return () => {
      unlistenVolumeUp.then((f: any) => f());
      unlistenVolumeDown.then((f: any) => f());
      unlistenMute.then((f: any) => f());
      unlistenPlayPause.then((f: any) => f());
    };
  }, [handleMute, handlePlayPause]);

  return (
    <div className={cn("relative mx-auto group overflow-y-hidden", className)}>
      <div className="w-[1000px] aspect-video h-auto">
        <ReactPlayer
          ref={playerRef}
          url={video}
          playing={playing}
          volume={volume}
          muted={muted}
          onProgress={handleProgress}
          onClick={handlePlayPause}
          onEnded={() => {
            console.log("ended");
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          controls={false}
          width="100%"
          height="100%"
        />
      </div>

      <div
        className={cn(
          "controls flex flex-col gap-1 absolute bottom-0 left-0 w-full bg-linear-to-t from-black/60 to-transparent p-4 translate-y-20 group-hover:translate-0 transition-transform duration-300",
          {
            "translate-y-0": !playing,
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
              {playing ? "Pause" : "Play"}
            </TooltipContent>
          </Tooltip>

          <div className="flex items-center group/controls">
            <Tooltip>
              <TooltipTrigger
                className="text-white/80 hover:text-white p-3"
                onClick={handleMute}
              >
                {muted ? (
                  <LucideVolumeOff fill="white" className="size-4" />
                ) : (
                  <LucideVolume2 fill="white" className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent className="pointer-events-none">
                {muted ? "Unmute" : "Mute"}
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
