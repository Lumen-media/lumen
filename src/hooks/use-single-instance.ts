import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { toast } from "sonner";

interface SingleInstanceEvent {
  payload: string[];
}

const MEDIA_EXTENSIONS =
  /\.(md|markdown|txt|json|pptx?|pdf|png|jpe?g|webp|gif|svg|mp4|webm|mov|mkv|mp3|wav|m4a|flac|ogg)$/i;

/**
 * Windows puts the executable itself in `argv[0]`, so it must be dropped or every
 * relaunch looks like it carried a file.
 */
function forwardedFiles(payload: string[] | undefined): string[] {
  if (!payload || payload.length === 0) return [];
  return payload
    .slice(1)
    .filter((arg) => !arg.startsWith('-') && MEDIA_EXTENSIONS.test(arg));
}

export function useSingleInstance(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen("single-instance", (event: SingleInstanceEvent) => {
          const filePaths = forwardedFiles(event.payload);
          if (filePaths.length === 0) return;

          toast.info(`Files passed from another instance: ${filePaths.length} file(s)`, {
            description: "The app is already running. Use the upload button to add these files.",
          });
        });
      } catch (error) {
        console.error("Failed to set up single instance listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled]);
}
