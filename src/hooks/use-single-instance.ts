import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

interface SingleInstanceEvent {
  payload: string[];
}

export function useSingleInstance() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen("single-instance", (event: SingleInstanceEvent) => {
          console.log("Single instance event received:", event.payload);
          
          if (event.payload && event.payload.length > 0) {
            console.log("Arguments from second instance:", event.payload);
            
            const filePaths = event.payload.filter(arg => 
              arg.includes('/') || arg.includes('\\') || arg.includes('.')
            );
            
            if (filePaths.length > 0) {
              toast.info(`Files passed from another instance: ${filePaths.length} file(s)`, {
                description: "The app is already running. Use the upload button to add these files.",
              });
            }
          }
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
  }, []);
}