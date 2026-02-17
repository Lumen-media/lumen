import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  useDebounceCallback,
  useEventListener,
  useInterval,
} from "usehooks-ts";
import { Videoplayer } from "@/components/ui/videoplayer";

export const Route = createFileRoute("/media-window")({
  component: MediaWindowComponent,
});

function MediaWindowComponent() {
  const [isFullscreen, setIsFullscreen] = useState(true);

  const saveCurrentPosition = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const { invoke } = await import("@tauri-apps/api/core");

      const window = getCurrentWebviewWindow();
      if (window) {
        const position = await window.innerPosition();

        await invoke("save_window_position", {
          label: "media-window",
          x: position.x,
          y: position.y,
        });
      }
    } catch (error) {
      console.error("Failed to save window position:", error);
    }
  }, []);

  const debouncedSavePosition = useDebounceCallback(saveCurrentPosition, 500);

  const setDecorations = async (decorated: boolean) => {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const window = getCurrentWebviewWindow();
      if (window) {
        await window.setDecorations(decorated);
      }
    } catch (error) {
      console.error("Failed to set window decorations:", error);
    }
  };

  const toggleFullscreen = async () => {
    try {
      const { getCurrentWebviewWindow } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const window = getCurrentWebviewWindow();

      if (window) {
        const isCurrentlyFullscreen = await window.isFullscreen();
        const next = !isCurrentlyFullscreen;

        await window.setFullscreen(next);
        await setDecorations(!next);
        setIsFullscreen(next);

        if (!next) {
          await saveCurrentPosition();
        }
      }
    } catch (error) {
      console.error("Failed to toggle fullscreen:", error);
    }
  };

  const closeWindow = async () => {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const window = getCurrentWebviewWindow();
      
      if (window) {
        await saveCurrentPosition();
        await window.close();
      }
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  const checkFullscreenState = async () => {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const window = getCurrentWebviewWindow();
      
      if (window) {
        const fullscreen = await window.isFullscreen();
        setIsFullscreen(fullscreen);
      }
    } catch (error) {
      console.error("Failed to check fullscreen state:", error);
    }
  };

  useEffect(() => {
    checkFullscreenState();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key || event.code;

      if (key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }

      if (key === "Escape") {
        event.preventDefault();
        void closeWindow();
      }
    },
    [closeWindow, toggleFullscreen],
  );

  useEventListener("keydown", handleKeyDown);

  useInterval(
    () => {
      void debouncedSavePosition();
    },
    isFullscreen ? null : 1000,
  );

  const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  return (
    <div className="h-dvh w-dvw bg-black">
      <Videoplayer
        className="h-full w-full"
        url={videoUrl}
        autoplay
        muted={false}
        interactive={false}
      />
    </div>
  );
}
