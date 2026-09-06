import { createFileRoute } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  CircleDot,
  Monitor,
  Settings2,
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useDeviceAudioMixer } from '@/hooks/use-device-audio-mixer';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
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
  const {
    init,
    config,
    mobileStreams,
    updateConfig,
    masterVolume,
    deviceVolumes,
    setMasterVolume,
    setDeviceVolume,
  } = useStreamingStore();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [videoTrackActive, setVideoTrackActive] = useState(false);
  const [previewConnected, setPreviewConnected] = useState(false);
  const [videoOrientation, setVideoOrientation] = useState<VideoOrientation | null>(null);
  const [streamOverlayActive, setStreamOverlayActive] = useState(false);
  const [masterDrag, setMasterDrag] = useState<number | null>(null);
  const [deviceDrag, setDeviceDrag] = useState<Record<string, number>>({});

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoStreamRef = useRef<MediaStream | null>(null);
  const videoOrientationRef = useRef<VideoOrientation | null>(null);
  const signalingModeRef = useRef<'mobile_preview' | 'mobile'>('mobile_preview');
  const previewSubscriptionRef = useRef(false);

  useEffect(() => {
    init().catch(() => { });
  }, [init]);

  const devices = useMemo(() => Object.values(mobileStreams), [mobileStreams]);
  const hasDevices = devices.length > 0;

  useDeviceAudioMixer(devices, masterVolume, deviceVolumes);

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
    invoke('set_mobile_preview_device', { deviceId: selectedDeviceId ?? null }).catch(() => { });
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!streamOverlayActive) return;
    if (videoRef.current) videoRef.current.srcObject = null;
    setVideoTrackActive(false);
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
    if (!hasDevices) return;

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
      video.play().catch(() => { });
    };

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind !== 'video') {
        return;
      }
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
      previewVideoStreamRef.current = null;
      signalingModeRef.current = 'mobile_preview';
      setVideoTrackActive(false);
      setVideoOrientation(null);
    };
  }, [streamOverlayActive, hasDevices]);

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
        () => { }
      );
      await new Promise((r) => setTimeout(r, 1500));
      win = await WebviewWindow.getByLabel('media-window');
    }

    if (win) {
      const visible = await win.isVisible().catch(() => false);
      if (!visible) await win.show().catch(() => { });
    }

    await invoke('set_stream_overlay', { active: next }).catch(() => { });
    setStreamOverlayActive(next);
  };

  const togglePreview = async () => {
    await updateConfig({ preview_enabled: !config.preview_enabled });
  };

  const shownMasterVolume = masterDrag ?? masterVolume;

  const commitMasterVolume = (value: number) => {
    setMasterDrag(null);
    void setMasterVolume(value);
  };

  const shownDeviceVolume = (deviceId: string) =>
    deviceDrag[deviceId] ?? deviceVolumes[deviceId] ?? 100;

  const commitDeviceVolume = (deviceId: string, value: number) => {
    setDeviceDrag((current) => {
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
    void setDeviceVolume(deviceId, value);
  };

  const handleDeviceVolumeChange = (deviceId: string, value: number) => {
    setDeviceDrag((current) => ({ ...current, [deviceId]: value }));
  };

  return (
    <CardContent className="flex-1 flex flex-col gap-3 px-0 h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Live</h2>

        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={streamOverlayActive ? 'default' : 'secondary'}
            size="sm"
            onClick={() => {
              void toggleStreamOverlay();
            }}
          >
            <Monitor className="size-3.5" />
            Display
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="secondary" size="sm">
                  <Volume2 className="size-3.5" />
                  Audio
                </Button>
              }
            />
            <PopoverContent align="end" className="w-72">
              <PopoverHeader>
                <PopoverTitle>Audio mixer</PopoverTitle>
                <PopoverDescription>Master and per-device volume</PopoverDescription>
              </PopoverHeader>

              <div className="flex items-center gap-2">
                <Volume2 className="size-4 shrink-0 text-muted-foreground" />
                <Slider
                  value={[shownMasterVolume]}
                  onValueChange={([value]) => setMasterDrag(value)}
                  onValueCommit={([value]) => commitMasterVolume(value)}
                />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {shownMasterVolume}
                </span>
              </div>

              <Separator />

              {devices.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No device connected</p>
              ) : (
                <ScrollArea className="max-h-44">
                  <div className="flex flex-col gap-3 pr-2">
                    {devices.map((device) => (
                      <div key={device.device_id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {device.device_name}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {device.has_video ? 'Video source' : 'Audio monitor'}
                          </p>
                        </div>
                        <Slider
                          className="w-24 shrink-0"
                          value={[shownDeviceVolume(device.device_id)]}
                          onValueChange={([value]) =>
                            handleDeviceVolumeChange(device.device_id, value)
                          }
                          onValueCommit={([value]) =>
                            commitDeviceVolume(device.device_id, value)
                          }
                        />
                        <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {shownDeviceVolume(device.device_id)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              useSettingsStore.getState().open('advanced');
            }}
          >
            <Settings2 className="size-3.5" />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-3">
        <Card className="flex-1/4 bg-background/40">
          <CardHeader className="p-0 flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Connected devices</CardTitle>
              <CardDescription className="mt-1 max-w-xs">
                Select a source to preview its live transmission
              </CardDescription>
            </div>
            <Badge>{devices.length} online</Badge>
          </CardHeader>

          <ScrollArea className="mt-6 flex-1">
            <div className="space-y-4 pr-4">
              {devices.length === 0 ? (
                <Empty className="rounded-3xl border border-white/10 bg-white/5">
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
                    <Button
                      key={device.device_id}
                      variant="ghost"
                      onClick={() => setSelectedDeviceId(device.device_id)}
                      className={cn(
                        'justify-start h-auto w-full rounded-md p-3',
                        active && 'bg-primary/10 ring-1 ring-primary/20'
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {device.has_audio && !device.has_video ? (
                          <Volume2 className="size-4 text-muted-foreground shrink-0" />
                        ) : (
                          <Smartphone className="size-4 text-muted-foreground shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {device.device_name}
                            </p>
                            <Badge
                              className={cn(
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
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {device.has_video ? 'Video source' : 'Audio monitor'} •{' '}
                            {device.has_audio ? 'Audio enabled' : 'Preview only'}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Wifi className="size-3.5" />
                          <span>{signalLabel}</span>
                        </div>
                      </div>
                    </Button>
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
            <Badge variant={previewConnected ? 'default' : 'secondary'}>
              {previewConnected ? 'Live' : 'Idle'}
            </Badge>
          </CardHeader>

          <div className="relative flex min-h-80 flex-1 items-center justify-center overflow-hidden rounded-lg border border-primary/20 p-3">
            <div
              className={cn(
                'relative flex items-center justify-center overflow-hidden rounded-md border border-white/6 bg-black/35',
                previewSurfaceClass
              )}
            >
              <div className="absolute left-3 top-3 z-10 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100/90">
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

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button
              variant="outline"
              onClick={() => {
                void togglePreview();
              }}
            >
              <Square className="size-4" />
              {config.preview_enabled ? 'Mute Video' : 'Enable Video'}
            </Button>
          </div>
        </Card>
      </div>
    </CardContent>
  );
}
