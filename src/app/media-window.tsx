import { createFileRoute } from '@tanstack/react-router';
import { emit, listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounceCallback, useInterval } from 'usehooks-ts';
import { MarkdownPresentation } from '@/components/markdown-presentation';
import { PptxPresentation } from '@/components/reveal-presentation';
import { Videoplayer } from '@/components/ui/videoplayer';
import { useProfiles } from '@/hooks/use-profiles';
import { useStreamPreview } from '@/hooks/use-stream-preview';
import { ipc } from '@/lib/ipc';
import { useScopedShortcuts } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';
import { lumenUrl } from '@/services/lumen-url';
import { getMediaTypeFromPath } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';

function StreamOverlay() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useStreamPreview({ videoRef });

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="absolute inset-0 h-full w-full object-contain bg-black transform-[translateZ(0)]"
    >
      <track kind="captions" />
    </video>
  );
}

function useMediaImageSrc(path?: string | null) {
  const [src, setSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!path) {
      setSrc(undefined);
      return;
    }
    setSrc(lumenUrl(path, { w: 1280 }));
  }, [path]);

  return src;
}

export const Route = createFileRoute('/media-window')({
  component: MediaWindowComponent,
});

function MediaWindowComponent() {
  useProfiles();
  const { profiles, activeProfileId } = useProfileStore();
  const profileBackground =
    profiles.find((profile) => profile.id === activeProfileId)?.defaultBackground?.src ?? undefined;
  const profileBackgroundSrc = useMediaImageSrc(profileBackground);

  const [isFullscreen, setIsFullscreen] = useState(true);
  const [lyricPath, setLyricPath] = useState('');
  const [lyricStartIndex, setLyricStartIndex] = useState(0);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | undefined>();
  const [streamOverlayActive, setStreamOverlayActive] = useState(false);
  const [isBlackoutActive, setIsBlackoutActive] = useState(false);
  const [presentationPath, setPresentationPath] = useState<string | null>(null);
  const [presentationInitialSlide, setPresentationInitialSlide] = useState(0);
  const [presentationCurrentSlide, setPresentationCurrentSlide] = useState(0);
  const [presentationTotalSlides, setPresentationTotalSlides] = useState(0);
  const [useProfileWallpaper, setUseProfileWallpaper] = useState(false);
  const [hideLyrics, setHideLyrics] = useState(false);

  useEffect(() => {
    if (!imagePath) {
      setImageSrc(undefined);
      return;
    }
    setImageSrc(lumenUrl(imagePath));
  }, [imagePath]);

  const resetPresenterDisplayModes = useCallback(() => {
    setIsBlackoutActive(false);
    setUseProfileWallpaper(false);
    setHideLyrics(false);
  }, []);

  useEffect(() => {
    emit('presenter:display-state', {
      wallpaper: useProfileWallpaper,
      hideLyrics,
      blackout: isBlackoutActive,
    }).catch(() => {});
  }, [hideLyrics, isBlackoutActive, useProfileWallpaper]);

  const presentationPathRef = useRef(presentationPath);
  presentationPathRef.current = presentationPath;

  // Esta janela não roda os listeners do player-store, então precisa saber
  // localmente o que está no palco para decidir o que o "exit" deve fechar.
  const hasBaseVideoRef = useRef(false);
  const isBasePlayingRef = useRef(false);
  const presentedViewRef = useRef({ lyricPath, imagePath, presentationPath });
  presentedViewRef.current = { lyricPath, imagePath, presentationPath };

  const handlePlayerPlayingChange = useCallback((playing: boolean) => {
    isBasePlayingRef.current = playing;
  }, []);

  const clearPresentedContent = useCallback(() => {
    const hadPresentation = Boolean(presentationPathRef.current);
    setLyricPath('');
    setLyricStartIndex(0);
    setImagePath(null);
    setImageSrc(undefined);
    setPresentationPath(null);
    if (hadPresentation) {
      emit('presentation:presenter-closed').catch(() => {});
    }
    resetPresenterDisplayModes();
    useModuleStore.getState().clearPresenter();
    ipc('push_stream_blank').catch(() => {});
    emit('module:presenter-clear').catch(() => {});
    // The overlay is gone: let the main window drop its presented state too.
    emit('presented-content-cleared').catch(() => {});
    emit('stage-backdrop-change', {
      active: false,
      source: null,
      mediaType: null,
      id: null,
      name: null,
    }).catch(() => {});
  }, [resetPresenterDisplayModes]);

  const saveCurrentPosition = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');

      const window = getCurrentWebviewWindow();
      if (window) {
        const position = await window.innerPosition();

        await ipc('save_window_position', {
          label: 'media-window',
          x: position.x,
          y: position.y,
        });
      }
    } catch (error) {
      console.error('Failed to save window position:', error);
    }
  }, []);

  const debouncedSavePosition = useDebounceCallback(saveCurrentPosition, 500);

  const setDecorations = useCallback(async (decorated: boolean) => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const window = getCurrentWebviewWindow();
      if (window) {
        await window.setDecorations(decorated);
      }
    } catch (error) {
      console.error('Failed to set window decorations:', error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const appWindow = getCurrentWebviewWindow();

      if (appWindow) {
        const isCurrentlyFullscreen = await appWindow.isFullscreen();
        const next = !isCurrentlyFullscreen;

        if (next) {
          await setDecorations(false);
          await appWindow.setFullscreen(true);
        } else {
          await appWindow.setFullscreen(false);
          await setDecorations(true);
          await saveCurrentPosition();
        }

        setIsFullscreen(next);
      }
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
    }
  }, [setDecorations, saveCurrentPosition]);

  const closeWindow = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const window = getCurrentWebviewWindow();

      if (window) {
        await saveCurrentPosition();
        await window.close();
      }
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  }, [saveCurrentPosition]);

  const exitPresentedContent = useCallback(() => {
    const {
      lyricPath: presentedLyric,
      imagePath: presentedImage,
      presentationPath: presentedDeck,
    } = presentedViewRef.current;

    const hasPresentedContent =
      Boolean(presentedLyric) ||
      Boolean(presentedImage) ||
      Boolean(presentedDeck) ||
      useModuleStore.getState().presenterViewId !== null;

    if (!hasPresentedContent) {
      void closeWindow();
      return;
    }

    clearPresentedContent();

    // Cascata: o exit só devolve o palco para a mídia de base se ela estiver
    // tocando; um vídeo pausado (ou encerrado) não é algo a ser exibido.
    if (hasBaseVideoRef.current && isBasePlayingRef.current) {
      emit('stage-backdrop-change', { active: true, source: 'player', mediaType: 'video' }).catch(
        () => {}
      );
      return;
    }

    void closeWindow();
  }, [clearPresentedContent, closeWindow]);

  const ensureDefaultWindowMode = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const appWindow = getCurrentWebviewWindow();

      if (appWindow) {
        await setDecorations(false);
        setIsFullscreen(true);
      }
    } catch (error) {
      console.error('Failed to enforce media window defaults:', error);
    }
  }, [setDecorations]);

  useEffect(() => {
    void ensureDefaultWindowMode();
  }, [ensureDefaultWindowMode]);

  useEffect(() => {
    let detachCloseListener: (() => void) | undefined;

    const notifyPresenterClosed = () => {
      emit('presentation:presenter-closed').catch(() => {});
      emit('module:presenter-window-closed').catch(() => {});
      emit('stage-backdrop-change', {
        active: false,
        source: null,
        mediaType: null,
        id: null,
        name: null,
      }).catch(() => {});
    };

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(notifyPresenterClosed))
      .then((unlisten) => {
        detachCloseListener = unlisten;
      })
      .catch((error) => {
        console.error('Failed to bind media window close listener:', error);
      });

    window.addEventListener('beforeunload', notifyPresenterClosed);
    return () => {
      detachCloseListener?.();
      window.removeEventListener('beforeunload', notifyPresenterClosed);
    };
  }, []);

  useEffect(() => {
    bootPresenterModules()
      .then(() => emit('module:presenter-ready').catch(() => {}))
      .catch(console.error);

    const unlistenProject = listen<{ viewId: string; props: unknown }>(
      'module:presenter-project',
      (e) => {
        useModuleStore.getState().projectPanel(e.payload.viewId, e.payload.props);
      }
    );
    const unlistenClear = listen('module:presenter-clear', () => {
      useModuleStore.getState().clearPresenter();
      emit('stage-backdrop-change', {
        active: false,
        source: null,
        mediaType: null,
        id: null,
        name: null,
      }).catch(() => {});
    });

    return () => {
      unlistenProject.then((f) => f());
      unlistenClear.then((f) => f());
    };
  }, []);

  useScopedShortcuts(
    'media-window',
    {
      'media.fullscreen': () => void toggleFullscreen(),
      'media.wallpaper': () => {
        setIsBlackoutActive(false);
        setUseProfileWallpaper((active) => !active);
      },
      'media.hide-lyrics': () => {
        setIsBlackoutActive(false);
        setHideLyrics((active) => !active);
      },
      'media.blackout': () =>
        setIsBlackoutActive((active) => {
          const next = !active;
          if (next) ipc('push_stream_blank').catch(() => {});
          return next;
        }),
      'media.escape': () => exitPresentedContent(),
      'media.next-slide': () => {
        if (presentationCurrentSlide >= presentationTotalSlides - 1) return;
        emit('presentation:set-slide', {
          index: Math.min(presentationCurrentSlide + 1, presentationTotalSlides - 1),
        }).catch(() => {});
      },
      'media.prev-slide': () => {
        if (presentationCurrentSlide <= 0) return;
        emit('presentation:set-slide', {
          index: Math.max(presentationCurrentSlide - 1, 0),
        }).catch(() => {});
      },
      'media.first-slide': () => {
        if (presentationCurrentSlide === 0) return;
        emit('presentation:set-slide', { index: 0 }).catch(() => {});
      },
      'media.last-slide': () => {
        if (presentationCurrentSlide === presentationTotalSlides - 1) return;
        emit('presentation:set-slide', { index: presentationTotalSlides - 1 }).catch(() => {});
      },
    },
    {
      'media.next-slide': { enabled: Boolean(presentationPath) },
      'media.prev-slide': { enabled: Boolean(presentationPath) },
      'media.first-slide': { enabled: Boolean(presentationPath) },
      'media.last-slide': { enabled: Boolean(presentationPath) },
    }
  );

  useEffect(() => {
    const unlistenLyric = listen<{ url: string }>('load-lyric', (event) => {
      resetPresenterDisplayModes();
      setLyricPath(event.payload.url);
      setImagePath(null);
      emit('stage-backdrop-change', { active: true, source: 'lyrics', mediaType: 'lyrics' }).catch(
        () => {}
      );
    });

    const unlistenStartSlide = listen<{ startIndex: number }>('lyric-start-slide', (event) => {
      setLyricStartIndex(event.payload.startIndex);
    });

    const unlistenLoadUrl = listen<{ url: string; time: number }>('load-url', (event) => {
      // Audio is rendered by the main window; it must not replace whatever is
      // presented here, otherwise lyrics would vanish when the track changes.
      if (getMediaTypeFromPath(event.payload.url) !== 'video') {
        hasBaseVideoRef.current = false;
        emit('unload-video').catch(() => {});
        return;
      }
      hasBaseVideoRef.current = true;
      // A new video owns the stage: clear the presented view before it starts
      // instead of leaving a stale overlay on top of a fresh player.
      clearPresentedContent();
      emit('stage-backdrop-change', { active: true, source: 'player', mediaType: 'video' }).catch(
        () => {}
      );
    });

    const unlistenLoadImage = listen<{ url: string }>('load-image', (event) => {
      resetPresenterDisplayModes();
      setLyricPath('');
      setImagePath(event.payload.url);
      emit('stage-backdrop-change', { active: true, source: 'media', mediaType: 'image' }).catch(
        () => {}
      );
    });

    const unlistenStreamOverlay = listen<{ active: boolean }>('stream-overlay-toggle', (event) => {
      setStreamOverlayActive(event.payload.active);
    });

    const unlistenBlackout = listen('presenter:blackout-toggle', () => {
      setIsBlackoutActive((active) => {
        const next = !active;
        if (next) ipc('push_stream_blank').catch(() => {});
        return next;
      });
    });

    const unlistenWallpaper = listen('presenter:wallpaper-toggle', () => {
      setIsBlackoutActive(false);
      setUseProfileWallpaper((active) => !active);
    });

    const unlistenLyricsToggle = listen('presenter:lyrics-toggle', () => {
      setIsBlackoutActive(false);
      setHideLyrics((active) => !active);
    });

    const unlistenExit = listen('presenter:exit', exitPresentedContent);

    const unlistenPresentationLoad = listen<{ filePath: string; initialSlide?: number }>(
      'presentation:load',
      (event) => {
        resetPresenterDisplayModes();
        setLyricPath('');
        setImagePath(null);
        setImageSrc(undefined);
        setPresentationInitialSlide(event.payload.initialSlide ?? 0);
        setPresentationPath(event.payload.filePath);
        emit('stage-backdrop-change', {
          active: true,
          source: 'scene',
          mediaType: 'unknown',
          name: event.payload.filePath.split(/[\\/]/).pop(),
        }).catch(() => {});
      }
    );

    const unlistenPresentationClear = listen('presentation:clear', () => {
      setPresentationInitialSlide(0);
      setPresentationPath(null);
    });

    const unlistenSlideChanged = listen<{
      currentSlide: number;
      totalSlides: number;
    }>('presentation:slide-changed', (event) => {
      setPresentationCurrentSlide(event.payload.currentSlide);
      setPresentationTotalSlides(event.payload.totalSlides);
    });

    Promise.all([
      unlistenLyric,
      unlistenStartSlide,
      unlistenLoadUrl,
      unlistenLoadImage,
      unlistenStreamOverlay,
      unlistenBlackout,
      unlistenWallpaper,
      unlistenLyricsToggle,
      unlistenExit,
      unlistenPresentationLoad,
      unlistenPresentationClear,
      unlistenSlideChanged,
    ]).then(() => emit('media-window-ready').catch(() => {}));

    return () => {
      unlistenLyric.then((f) => f());
      unlistenStartSlide.then((f) => f());
      unlistenLoadUrl.then((f) => f());
      unlistenLoadImage.then((f) => f());
      unlistenStreamOverlay.then((f) => f());
      unlistenBlackout.then((f) => f());
      unlistenWallpaper.then((f) => f());
      unlistenLyricsToggle.then((f) => f());
      unlistenExit.then((f) => f());
      unlistenPresentationLoad.then((f) => f());
      unlistenPresentationClear.then((f) => f());
      unlistenSlideChanged.then((f) => f());
    };
  }, [clearPresentedContent, exitPresentedContent, resetPresenterDisplayModes]);

  useInterval(
    () => {
      void debouncedSavePosition();
    },
    isFullscreen ? null : 1000
  );

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      {/* The player is never unmounted: overlays are layers on top of it, so
          playback and play/pause keep working while content is presented. */}
      <Videoplayer
        className="h-full w-full"
        url=""
        autoplay
        muted={false}
        interactive={false}
        onPlayingChange={handlePlayerPlayingChange}
      />
      {imageSrc && !lyricPath && (
        <div className="absolute inset-0 z-10 w-dvw h-dvh bg-black">
          <img src={imageSrc} alt="" className="w-full h-full object-contain" />
        </div>
      )}
      {lyricPath && (
        <div className="absolute inset-0 z-10">
          <MarkdownPresentation
            filePath={lyricPath}
            startIndex={lyricStartIndex}
            hideLyrics={hideLyrics}
            useProfileWallpaper={useProfileWallpaper}
            blackoutActive={isBlackoutActive}
          />
        </div>
      )}
      {presentationPath && (
        <div className="absolute inset-0 z-10">
          <PptxPresentation filePath={presentationPath} initialSlide={presentationInitialSlide} />
        </div>
      )}
      {streamOverlayActive && (
        <div className="absolute inset-0 z-9999 transform-[translateZ(0)]">
          <StreamOverlay />
        </div>
      )}
      <PresenterSlot />
      <div
        className={cn(
          'absolute inset-0 z-10000 h-full w-full bg-black transition-opacity duration-300 ease-out',
          useProfileWallpaper ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        {profileBackgroundSrc && (
          <img src={profileBackgroundSrc} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div
        className={cn(
          'absolute inset-0 z-10000 h-full w-full bg-black transition-opacity duration-300 ease-out',
          isBlackoutActive ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
    </div>
  );
}
