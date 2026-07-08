import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  CircleDot,
  Monitor,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Square,
  Volume2,
  Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useStreamingStore } from '@/stores/streaming-store';

export const Route = createFileRoute('/_layout/live')({
  component: RouteComponent,
});

type VideoOrientation = 'portrait' | 'landscape';

const normalizeVideoOrientation = (value: unknown): VideoOrientation | null => {
  if (value === 'portrait' || value === 'landscape') {
    return value;
  }

  return null;
};

function RouteComponent() {
  const { init, config, mobileStreams, updateConfig, setContentProtection, pushBlank } =
    useStreamingStore();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [videoTrackActive, setVideoTrackActive] = useState(false);
  const [audioTrackActive, setAudioTrackActive] = useState(false);
  const [previewConnected, setPreviewConnected] = useState(false);
  const [videoOrientation, setVideoOrientation] = useState<VideoOrientation | null>(null);
  const [streamOverlayActive, setStreamOverlayActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoStreamRef = useRef<MediaStream | null>(null);
  const previewAudioStreamRef = useRef<MediaStream | null>(null);
  const videoOrientationRef = useRef<VideoOrientation | null>(null);
  const signalingModeRef = useRef<'mobile_preview' | 'mobile'>('mobile_preview');
  const previewSubscriptionRef = useRef(false);

  useEffect(() => {
    init().catch(() => {});
  }, [init]);

  const devices = useMemo(() => Object.values(mobileStreams), [mobileStreams]);

  useEffect(() => {
    if (devices.length === 0) {
      setSelectedDeviceId(null);
      return;
    }

    if (!selectedDeviceId || !mobileStreams[selectedDeviceId]) {
      setSelectedDeviceId(devices[0].device_id);
    }
  }, [devices, mobileStreams, selectedDeviceId]);

  useEffect(() => {
    invoke('set_mobile_preview_device', { deviceId: selectedDeviceId ?? null }).catch(() => {});
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!streamOverlayActive) return;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setVideoTrackActive(false);
    setAudioTrackActive(false);
    setPreviewConnected(false);
  }, [streamOverlayActive]);

  const selectedDevice = selectedDeviceId ? mobileStreams[selectedDeviceId] : null;

  useEffect(() => {
    const deviceOrientation = normalizeVideoOrientation(selectedDevice?.video_orientation);
    if (deviceOrientation) {
      setVideoOrientation(deviceOrientation);
    }
  }, [selectedDevice?.video_orientation]);

  useEffect(() => {
    videoOrientationRef.current = videoOrientation;
  }, [videoOrientation]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const syncOrientationFromVideo = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoOrientation(video.videoHeight > video.videoWidth ? 'portrait' : 'landscape');
      }
    };

    video.addEventListener('loadedmetadata', syncOrientationFromVideo);
    video.addEventListener('resize', syncOrientationFromVideo);

    return () => {
      video.removeEventListener('loadedmetadata', syncOrientationFromVideo);
      video.removeEventListener('resize', syncOrientationFromVideo);
    };
  }, []);

  useEffect(() => {
    if (streamOverlayActive) return;

    const pc = new RTCPeerConnection();
    const ws = new WebSocket('ws://localhost:8080');
    let closed = false;

    const attachVideoElement = (stream: MediaStream, retries = 10) => {
      if (closed) return;
      const video = videoRef.current;
      if (!video) {
        if (retries > 0) window.setTimeout(() => attachVideoElement(stream, retries - 1), 30);
        return;
      }
      if (video.srcObject !== stream) video.srcObject = stream;
      video.play().catch(() => {});
    };

    const attachAudioElement = (stream: MediaStream, retries = 10) => {
      if (closed) return;
      const audio = audioRef.current;
      if (!audio) {
        if (retries > 0) window.setTimeout(() => attachAudioElement(stream, retries - 1), 30);
        return;
      }
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.play().catch(() => {});
    };

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        if (!previewVideoStreamRef.current) previewVideoStreamRef.current = new MediaStream();
        const previewVideoStream = previewVideoStreamRef.current;
        previewVideoStream
          .getVideoTracks()
          .forEach((track) => { previewVideoStream.removeTrack(track); });
        previewVideoStream.addTrack(event.track);

        const attachVideoTrack = () => {
          setVideoTrackActive(true);
          attachVideoElement(previewVideoStream);
        };

        attachVideoTrack();
        if (event.track.muted) event.track.onunmute = attachVideoTrack;
        event.track.onmute = () => setVideoTrackActive(false);
        event.track.onended = () => setVideoTrackActive(false);
      }

      if (event.track.kind === 'audio') {
        if (!previewAudioStreamRef.current) previewAudioStreamRef.current = new MediaStream();
        const previewAudioStream = previewAudioStreamRef.current;
        previewAudioStream
          .getAudioTracks()
          .forEach((track) => { previewAudioStream.removeTrack(track); });
        previewAudioStream.addTrack(event.track);

        const attachAudioTrack = () => {
          setAudioTrackActive(true);
          attachAudioElement(previewAudioStream);
        };

        attachAudioTrack();
        if (event.track.muted) event.track.onunmute = attachAudioTrack;
        event.track.onmute = () => setAudioTrackActive(false);
        event.track.onended = () => setAudioTrackActive(false);
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send({
        event: 'webrtc_ice_candidate',
        stream_type: signalingModeRef.current,
        video_orientation: videoOrientationRef.current,
        candidate: event.candidate,
      });
    };

    ws.onopen = () => {
      if (closed) return;
      setPreviewConnected(true);
      previewSubscriptionRef.current = true;
      send({ event: 'subscribe_stream', stream_type: 'mobile_preview' });
    };

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        const payloadOrientation = normalizeVideoOrientation(payload.video_orientation);

        if (payloadOrientation) {
          setVideoOrientation(payloadOrientation);
        }

        if (payload.event === 'mobile_offer') {
          signalingModeRef.current = 'mobile';

          if (previewSubscriptionRef.current) {
            send({ event: 'unsubscribe_stream', stream_type: 'mobile_preview' });
            previewSubscriptionRef.current = false;
          }

          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({
            event: 'mobile_answer',
            sdp: answer.sdp,
          });
          return;
        }

        if (payload.event === 'stream_offer' && payload.stream_type === 'mobile_preview') {
          signalingModeRef.current = 'mobile_preview';
          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({
            event: 'webrtc_answer',
            stream_type: 'mobile_preview',
            sdp: answer.sdp,
          });
          return;
        }

        if (
          payload.event === 'stream_ice_candidate' &&
          (payload.stream_type === 'mobile_preview' || payload.stream_type === 'mobile')
        ) {
          await pc.addIceCandidate(payload.candidate);
        }
      } catch {
        // ignore malformed preview signaling payloads
      }
    };

    ws.onclose = () => {
      setPreviewConnected(false);
    };

    return () => {
      closed = true;
      setPreviewConnected(false);

      if (previewSubscriptionRef.current) {
        send({ event: 'unsubscribe_stream', stream_type: 'mobile_preview' });
      }

      previewSubscriptionRef.current = false;
      ws.close();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      previewVideoStreamRef.current = null;
      previewAudioStreamRef.current = null;
      signalingModeRef.current = 'mobile_preview';
      setVideoTrackActive(false);
      setAudioTrackActive(false);
      setVideoOrientation(null);
    };
  }, [streamOverlayActive]);

  const previewLabel = selectedDevice
    ? selectedDevice.device_name
    : 'Stage Display A';
  const previewSurfaceClass =
    videoOrientation === 'portrait' ? 'mx-auto aspect-[9/16] h-full max-w-full' : 'h-full w-full';

  const toggleStreamOverlay = async () => {
    const next = !streamOverlayActive;

    let win = await WebviewWindow.getByLabel('media-window');
    if (!win) {
      await invoke('create_window', { label: 'media-window', title: 'Media Player' }).catch(
        () => {}
      );
      await new Promise((r) => setTimeout(r, 1500));
      win = await WebviewWindow.getByLabel('media-window');
    }

    if (win) {
      const visible = await win.isVisible().catch(() => false);
      if (!visible) await win.show().catch(() => {});
    }

    await invoke('set_stream_overlay', { active: next }).catch(() => {});
    setStreamOverlayActive(next);
  };

  const togglePreview = async () => {
    await updateConfig({ preview_enabled: !config.preview_enabled });
  };

  const toggleProtection = async () => {
    const next = !config.content_protection;
    await Promise.all([updateConfig({ content_protection: next }), setContentProtection(next)]);
  };

  return (
    <CardContent className="flex-1 flex flex-col gap-3.5 px-0 h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Live</h1>

        <div className="flex flex-wrap gap-3">
          <Button
            variant={streamOverlayActive ? 'default' : 'secondary'}
            className="h-auto rounded-xl px-4 py-3"
            onClick={() => {
              void toggleStreamOverlay();
            }}
          >
            <Monitor className="size-5" />
            Display
          </Button>
          <Button
            variant="secondary"
            className="h-auto rounded-xl px-4 py-3"
            onClick={() => {
              void toggleProtection();
            }}
          >
            <SlidersHorizontal className="size-5" />
            Audio
          </Button>
          <Button
            className="h-auto rounded-xl px-4 py-3"
            onClick={() => {
              void pushBlank();
            }}
          >
            <Settings2 className="size-5" />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-3">
        <Card className="flex-1/4">
          <CardHeader className="p-0 flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Connected devices</CardTitle>
              <CardDescription className="mt-1 max-w-xs">
                Select a source to preview its live transmission
              </CardDescription>
            </div>
            <Badge className="rounded-full bg-primary/80">{devices.length} online</Badge>
          </CardHeader>

          <ScrollArea className="mt-6 flex-1">
            <div className="space-y-4 pr-4">
              {devices.length === 0 ? (
                <Empty className="rounded-[1.5rem] border border-white/10 bg-white/5">
                  <EmptyDescription>No active mobile device</EmptyDescription>
                </Empty>
              ) : (
                devices.map((device) => {
                  const active = selectedDeviceId === device.device_id;
                  const badgeLabel =
                    device.has_video && device.has_audio
                      ? 'Live'
                      : device.has_video
                        ? 'Preview'
                        : 'Audio';
                  const signalLabel =
                    device.has_video && device.has_audio
                      ? 'Strong'
                      : device.has_video
                        ? 'Stable'
                        : 'On';

                  return (
                    <button
                      key={device.device_id}
                      type="button"
                      onClick={() => setSelectedDeviceId(device.device_id)}
                      className={cn(
                        'w-full rounded-[1.5rem] border px-4 py-5 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/20'
                          : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex size-18 shrink-0 items-center justify-center rounded-[1.25rem] bg-white/6">
                          {device.has_audio && !device.has_video ? (
                            <Volume2 className="size-7 text-foreground/85" />
                          ) : (
                            <Smartphone className="size-7 text-foreground/85" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <p className="truncate text-xl font-semibold text-foreground">
                              {device.device_name}
                            </p>
                            <Badge
                              className={cn(
                                'rounded-full px-3 py-1 text-sm',
                                badgeLabel === 'Live'
                                  ? 'bg-primary/15 text-primary'
                                  : badgeLabel === 'Audio'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-white/8 text-slate-200'
                              )}
                            >
                              {badgeLabel}
                            </Badge>
                          </div>
                          <p className="mt-2 truncate text-sm text-muted-foreground">
                            {device.has_video ? 'Video source' : 'Audio monitor'} •{' '}
                            {device.has_audio ? 'Audio enabled' : 'Preview only'}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                          <Wifi className="size-4" />
                          <span>{signalLabel}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Card>

        <Card className="flex-1/2">
          <CardHeader className="p-0 flex-row items-start justify-between gap-4">
            <div>
              <CardDescription>Transmission preview</CardDescription>
              <CardTitle className="mt-1">{previewLabel}</CardTitle>
              <CardDescription className="mt-1">
                {selectedDevice
                  ? `${selectedDevice.has_video ? 'Video' : 'Audio'} • ${selectedDevice.has_audio ? 'Audio enabled' : 'Preview only'}`
                  : 'Select a connected device'}
              </CardDescription>
            </div>
            <Badge className="rounded-full px-4">{previewConnected ? 'Live' : 'Idle'}</Badge>
          </CardHeader>

          <div className="relative flex min-h-[20rem] flex-1 items-center justify-center overflow-hidden rounded-[1.75rem] border border-primary/20 p-4">
            <div
              className={cn(
                'relative flex items-center justify-center overflow-hidden rounded-[1.35rem] border border-white/6 bg-black/35',
                previewSurfaceClass
              )}
            >
              <div className="absolute left-6 top-6 z-10 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100/90">
                Live output
              </div>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full max-h-full max-w-full object-contain"
              />
              {!videoTrackActive && (
                <Empty className="absolute inset-0 rounded-none bg-slate-950/72 px-6 gap-3">
                  <EmptyMedia>
                    {selectedDevice ? (
                      <CircleDot className="size-8 text-primary" />
                    ) : (
                      <Smartphone className="size-8 text-primary" />
                    )}
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle className="text-xl font-semibold text-foreground">
                      {selectedDevice ? 'Preview ready' : 'No device selected'}
                    </EmptyTitle>
                    <EmptyDescription className="text-sm">
                      {selectedDevice
                        ? 'Waiting for live frames from the selected source'
                        : 'Choose one of the connected devices on the left'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>

          {/* biome-ignore lint/a11y/useMediaCaption: live monitor audio preview without media file captions */}
          <audio ref={audioRef} autoPlay controls className="sr-only" />

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button
              variant="outline"
              className="py-6 min-w-52 bg-transparent hover:bg-primary/5 rounded-2xl"
              onClick={() => {
                void toggleProtection();
              }}
            >
              <Volume2 className="size-5" />
              {audioTrackActive ? 'Mute Audio' : 'Audio Idle'}
            </Button>
            <Button
              variant="outline"
              className="py-6 min-w-52 bg-transparent hover:bg-primary/5 rounded-2xl"
              onClick={() => {
                void togglePreview();
              }}
            >
              <Square className="size-5" />
              {config.preview_enabled ? 'Mute Video' : 'Enable Video'}
            </Button>
          </div>
        </Card>
      </div>
    </CardContent>
  );
}
