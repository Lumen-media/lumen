import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounceCallback, useEventListener, useInterval } from 'usehooks-ts';
import { LyricPresentation } from '@/components/lyric-presentation';
import { Videoplayer } from '@/components/ui/videoplayer';
import { useProfiles } from '@/hooks/use-profiles';
import { cn } from '@/lib/utils';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';
import { usePlayerStore } from '@/stores/player-store';
import { useProfileStore } from '@/stores/profile-store';

function StreamOverlay() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const pc = new RTCPeerConnection();
    const ws = new WebSocket('ws://localhost:8080');
    let closed = false;
    let signalingMode: 'mobile_preview' | 'mobile' = 'mobile_preview';
    let subscribed = false;
    const videoStream = new MediaStream();

    const attachVideo = (retries = 10) => {
      if (closed) return;
      const video = videoRef.current;
      if (!video) {
        if (retries > 0) window.setTimeout(() => attachVideo(retries - 1), 30);
        return;
      }
      if (video.srcObject !== videoStream) video.srcObject = videoStream;
      video.play().catch(() => { });
    };

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        videoStream.getVideoTracks().forEach((t) => {
          videoStream.removeTrack(t);
        });
        videoStream.addTrack(event.track);
        attachVideo();
        if (event.track.muted) event.track.onunmute = () => attachVideo();
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send({
        event: 'webrtc_ice_candidate',
        stream_type: signalingMode,
        candidate: event.candidate,
      });
    };

    ws.onopen = () => {
      if (closed) return;
      subscribed = true;
      send({ event: 'subscribe_stream', stream_type: 'mobile_preview' });
    };

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data as string);

        if (payload.event === 'mobile_offer') {
          signalingMode = 'mobile';
          if (subscribed) {
            send({ event: 'unsubscribe_stream', stream_type: 'mobile_preview' });
            subscribed = false;
          }
          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ event: 'mobile_answer', sdp: answer.sdp });
          return;
        }

        if (payload.event === 'stream_offer' && payload.stream_type === 'mobile_preview') {
          signalingMode = 'mobile_preview';
          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ event: 'webrtc_answer', stream_type: 'mobile_preview', sdp: answer.sdp });
          return;
        }

        if (
          payload.event === 'stream_ice_candidate' &&
          (payload.stream_type === 'mobile_preview' || payload.stream_type === 'mobile')
        ) {
          await pc.addIceCandidate(payload.candidate);
        }
      } catch { }
    };

    return () => {
      closed = true;
      if (subscribed) send({ event: 'unsubscribe_stream', stream_type: 'mobile_preview' });
      ws.close();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

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

    if (path.startsWith('http') || path.startsWith('#') || path.startsWith('blob:')) {
      setSrc(path);
      return;
    }

    let url: string;
    readFile(path)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes]));
        setSrc(url);
      })
      .catch(() => setSrc(undefined));

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
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
  const [mode, setMode] = useState<'video' | 'lyric'>('video');
  const [lyricPath, setLyricPath] = useState('');
  const [lyricStartIndex, setLyricStartIndex] = useState(0);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | undefined>();
  const [streamOverlayActive, setStreamOverlayActive] = useState(false);
  const [isBlackoutActive, setIsBlackoutActive] = useState(false);
  const [useProfileWallpaper, setUseProfileWallpaper] = useState(false);
  const [hideLyrics, setHideLyrics] = useState(false);

  useEffect(() => {
    if (!imagePath) {
      setImageSrc(undefined);
      return;
    }
    let url: string;
    readFile(imagePath)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes]));
        setImageSrc(url);
      })
      .catch(() => setImageSrc(undefined));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
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
    }).catch(() => { });
  }, [hideLyrics, isBlackoutActive, useProfileWallpaper]);

  const clearPresentedContent = useCallback(() => {
    setMode('video');
    setLyricPath('');
    setLyricStartIndex(0);
    setImagePath(null);
    setImageSrc(undefined);
    resetPresenterDisplayModes();
    useModuleStore.getState().clearPresenter();
    invoke('push_stream_blank').catch(() => { });
    emit('module:presenter-clear').catch(() => { });
    emit('stage-backdrop-change', {
      active: false,
      source: null,
      mediaType: null,
      id: null,
      name: null,
    }).catch(() => { });
  }, [resetPresenterDisplayModes]);

  const saveCurrentPosition = useCallback(async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { invoke } = await import('@tauri-apps/api/core');

      const window = getCurrentWebviewWindow();
      if (window) {
        const position = await window.innerPosition();

        await invoke('save_window_position', {
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
    clearPresentedContent();

    const hasBaseMedia = Boolean(usePlayerStore.getState().currentFilePath);
    if (!hasBaseMedia) {
      void closeWindow();
    }
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
      emit('module:presenter-window-closed').catch(() => { });
      emit('stage-backdrop-change', {
        active: false,
        source: null,
        mediaType: null,
        id: null,
        name: null,
      }).catch(() => { });
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
      .then(() => emit('module:presenter-ready').catch(() => { }))
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
      }).catch(() => { });
    });

    return () => {
      unlistenProject.then((f) => f());
      unlistenClear.then((f) => f());
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key || event.code;

      if (key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
      }

      if (key === 'F8') {
        event.preventDefault();
        setIsBlackoutActive(false);
        setUseProfileWallpaper((active) => !active);
      }

      if (key === 'F9') {
        event.preventDefault();
        setIsBlackoutActive(false);
        setHideLyrics((active) => !active);
      }

      if (key === 'F10') {
        event.preventDefault();
        setIsBlackoutActive((active) => {
          const next = !active;
          if (next) invoke('push_stream_blank').catch(() => { });
          return next;
        });
      }

      if (key === 'Escape') {
        event.preventDefault();
        const hasPresentedContent =
          mode === 'lyric' || imagePath || useModuleStore.getState().presenterViewId !== null;

        if (hasPresentedContent) {
          exitPresentedContent();
        } else {
          void closeWindow();
        }
      }
    },
    [closeWindow, exitPresentedContent, imagePath, mode, toggleFullscreen]
  );

  useEventListener('keydown', handleKeyDown);

  useEffect(() => {
    const unlistenLyric = listen<{ url: string }>('load-lyric', (event) => {
      resetPresenterDisplayModes();
      setMode('lyric');
      setLyricPath(event.payload.url);
      setImagePath(null);
      emit('stage-backdrop-change', { active: true, source: 'lyrics', mediaType: 'lyrics' }).catch(
        () => { }
      );
    });

    const unlistenStartSlide = listen<{ startIndex: number }>('lyric-start-slide', (event) => {
      setLyricStartIndex(event.payload.startIndex);
    });

    const unlistenLoadUrl = listen('load-url', () => {
      resetPresenterDisplayModes();
      setMode('video');
      invoke('push_stream_blank').catch(() => { });
      emit('stage-backdrop-change', { active: true, source: 'player', mediaType: 'video' }).catch(
        () => { }
      );
    });

    const unlistenLoadImage = listen<{ url: string }>('load-image', (event) => {
      resetPresenterDisplayModes();
      setImagePath(event.payload.url);
      setMode('video');
      emit('stage-backdrop-change', { active: true, source: 'media', mediaType: 'image' }).catch(
        () => { }
      );
    });

    const unlistenStreamOverlay = listen<{ active: boolean }>('stream-overlay-toggle', (event) => {
      setStreamOverlayActive(event.payload.active);
    });

    const unlistenBlackout = listen('presenter:blackout-toggle', () => {
      setIsBlackoutActive((active) => {
        const next = !active;
        if (next) invoke('push_stream_blank').catch(() => { });
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
    ]).then(() => emit('media-window-ready').catch(() => { }));

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
    };
  }, [exitPresentedContent, resetPresenterDisplayModes]);

  useInterval(
    () => {
      void debouncedSavePosition();
    },
    isFullscreen ? null : 1000
  );

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      <Videoplayer className="h-full w-full" url="" autoplay muted={false} interactive={false} />
      {imageSrc && mode !== 'lyric' && (
        <div className="absolute inset-0 z-10 w-dvw h-dvh bg-black">
          <img src={imageSrc} alt="" className="w-full h-full object-contain" />
        </div>
      )}
      {mode === 'lyric' && lyricPath && (
        <div className="absolute inset-0 z-10">
          <LyricPresentation
            filePath={lyricPath}
            startIndex={lyricStartIndex}
            hideLyrics={hideLyrics}
            useProfileWallpaper={useProfileWallpaper}
            blackoutActive={isBlackoutActive}
          />
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
