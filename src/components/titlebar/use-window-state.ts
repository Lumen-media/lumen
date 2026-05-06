import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState } from 'react';

type WindowState = {
  appWindow: Window;
  isFocused: boolean;
  isFullscreen: boolean;
  isMaximized: boolean;
  toggleFullscreen: () => Promise<void>;
};

export type { WindowState };

export function useWindowState(): WindowState {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const ignoreNextResize = useRef(true);
  const [isFocused, setIsFocused] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlistenResize: null | (() => void) = null;
    let unlistenFocus: null | (() => void) = null;

    const syncWindowState = async () => {
      ignoreNextResize.current = true;

      try {
        const [maximized, fullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
        ]);

        if (!mounted) return;
        setIsMaximized(maximized);
        setIsFullscreen(fullscreen);
      } finally {
        ignoreNextResize.current = false;
      }
    };

    syncWindowState();

    appWindow
      .onResized(() => {
        if (ignoreNextResize.current) return;
        syncWindowState();
      })
      .then((cleanup) => {
        unlistenResize = cleanup;
      });

    appWindow
      .onFocusChanged(({ payload }) => {
        if (!mounted) return;
        setIsFocused(payload);
      })
      .then((cleanup) => {
        unlistenFocus = cleanup;
      });

    return () => {
      mounted = false;
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [appWindow]);

  const toggleFullscreen = async () => {
    const nextFullscreen = !isFullscreen;
    await appWindow.setFullscreen(nextFullscreen);
    setIsFullscreen(nextFullscreen);
  };

  return {
    appWindow,
    isFocused,
    isFullscreen,
    isMaximized,
    toggleFullscreen,
  };
}
