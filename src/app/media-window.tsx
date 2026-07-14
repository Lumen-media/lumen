import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounceCallback, useEventListener, useInterval } from 'usehooks-ts';
import { LyricPresentation } from '@/components/lyric-presentation';
import { Videoplayer } from '@/components/ui/videoplayer';
import { PresenterSlot } from '@/modules/components/PresenterSlot';
import { bootPresenterModules } from '@/modules/presenter-injector';
import { useModuleStore } from '@/modules/store';

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

const FULLSCREEN_SIZE_TOLERANCE = 2;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const Route = createFileRoute('/media-window')({
  component: MediaWindowComponent,
});

function MediaWindowComponent() {
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [mode, setMode] = useState<'video' | 'lyric'>('video');
  const [lyricPath, setLyricPath] = useState('');
  const [lyricStartIndex, setLyricStartIndex] = useState(0);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | undefined>();
  const [streamOverlayActive, setStreamOverlayActive] = useState(false);

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

  const ensureDefaultWindowMode = useCallback(async () => {
    try {
      const [{ getCurrentWebviewWindow }, { currentMonitor }] = await Promise.all([
        import('@tauri-apps/api/webviewWindow'),
        import('@tauri-apps/api/window'),
      ]);
      const appWindow = getCurrentWebviewWindow();

      if (appWindow) {
        const [fullscreen, size, monitor] = await Promise.all([
          appWindow.isFullscreen(),
          appWindow.innerSize().catch(() => null),
          currentMonitor().catch(() => null),
        ]);
        const hasFullscreenBounds =
          !size ||
          !monitor ||
          (Math.abs(size.width - monitor.size.width) <= FULLSCREEN_SIZE_TOLERANCE &&
            Math.abs(size.height - monitor.size.height) <= FULLSCREEN_SIZE_TOLERANCE);

        await setDecorations(false);

        if (fullscreen && !hasFullscreenBounds) {
          await appWindow.setFullscreen(false);
          await delay(80);
        }

        await appWindow.setFullscreen(true);
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

      if (key === 'Escape') {
        event.preventDefault();
        void closeWindow();
      }
    },
    [closeWindow, toggleFullscreen]
  );

  useEventListener('keydown', handleKeyDown);

  useEffect(() => {
    const unlistenLyric = listen<{ url: string }>('load-lyric', (event) => {
      setMode('lyric');
      setLyricPath(event.payload.url);
      setImagePath(null);
    });

    const unlistenStartSlide = listen<{ startIndex: number }>('lyric-start-slide', (event) => {
      setLyricStartIndex(event.payload.startIndex);
    });

    const unlistenLoadUrl = listen('load-url', () => {
      setMode('video');
      invoke('push_stream_blank').catch(() => { });
    });

    const unlistenLoadImage = listen<{ url: string }>('load-image', (event) => {
      setImagePath(event.payload.url);
      setMode('video');
    });

    const unlistenStreamOverlay = listen<{ active: boolean }>('stream-overlay-toggle', (event) => {
      setStreamOverlayActive(event.payload.active);
    });

    Promise.all([
      unlistenLyric,
      unlistenStartSlide,
      unlistenLoadUrl,
      unlistenLoadImage,
      unlistenStreamOverlay,
    ]).then(() => emit('media-window-ready').catch(() => { }));

    return () => {
      unlistenLyric.then((f) => f());
      unlistenStartSlide.then((f) => f());
      unlistenLoadUrl.then((f) => f());
      unlistenLoadImage.then((f) => f());
      unlistenStreamOverlay.then((f) => f());
    };
  }, []);

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
          <LyricPresentation filePath={lyricPath} startIndex={lyricStartIndex} />
        </div>
      )}
      {streamOverlayActive && (
        <div className="absolute inset-0 z-9999 transform-[translateZ(0)]">
          <StreamOverlay />
        </div>
      )}
      <PresenterSlot />
    </div>
  );
}
