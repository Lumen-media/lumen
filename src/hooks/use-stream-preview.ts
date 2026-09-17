import { useEffect, useRef, type RefObject } from 'react';
import { createStreamSocket } from '@/lib/stream-socket';

interface UseStreamPreviewOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
  subscribe?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onVideoTrack?: (stream: MediaStream) => void;
  onTrackActiveChange?: (active: boolean) => void;
  onMessage?: (payload: Record<string, unknown>) => void;
  iceCandidateExtra?: () => Record<string, unknown>;
}

export function useStreamPreview({
  videoRef,
  enabled = true,
  subscribe = true,
  onOpen,
  onClose,
  onVideoTrack,
  onTrackActiveChange,
  onMessage,
  iceCandidateExtra,
}: UseStreamPreviewOptions): void {
  const callbacksRef = useRef({
    onOpen,
    onClose,
    onVideoTrack,
    onTrackActiveChange,
    onMessage,
    iceCandidateExtra,
  });
  callbacksRef.current = {
    onOpen,
    onClose,
    onVideoTrack,
    onTrackActiveChange,
    onMessage,
    iceCandidateExtra,
  };

  useEffect(() => {
    if (!enabled) return;

    const pc = new RTCPeerConnection();
    const ws = createStreamSocket();
    let closed = false;
    let signalingMode: 'mobile_preview' | 'mobile' = 'mobile_preview';
    let subscribed = false;
    const stream = new MediaStream();

    const callbacks = () => callbacksRef.current;

    const attachVideo = (retries = 10) => {
      if (closed) return;
      const video = videoRef.current;
      if (!video) {
        if (retries > 0) window.setTimeout(() => attachVideo(retries - 1), 30);
        return;
      }
      if (video.srcObject !== stream) video.srcObject = stream;
      video.play().catch(() => {});
    };

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    pc.ontrack = (event) => {
      if (event.track.kind !== 'video') return;
      stream.getVideoTracks().forEach((track) => {
        stream.removeTrack(track);
      });
      stream.addTrack(event.track);
      callbacks().onVideoTrack?.(stream);
      attachVideo();
      if (event.track.muted) {
        event.track.onunmute = () => {
          attachVideo();
          callbacks().onTrackActiveChange?.(true);
        };
      }
      event.track.onmute = () => callbacks().onTrackActiveChange?.(false);
      event.track.onended = () => callbacks().onTrackActiveChange?.(false);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      send({
        event: 'webrtc_ice_candidate',
        stream_type: signalingMode,
        candidate: event.candidate,
        ...(callbacks().iceCandidateExtra?.() ?? {}),
      });
    };

    ws.onopen = () => {
      if (closed) return;
      callbacks().onOpen?.();
      if (subscribe) {
        subscribed = true;
        send({ event: 'subscribe_stream', stream_type: 'mobile_preview' });
      }
    };

    ws.onclose = () => {
      callbacks().onClose?.();
    };

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        callbacks().onMessage?.(payload);

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
      } catch {
        // ignore malformed preview signaling payloads
      }
    };

    return () => {
      closed = true;
      if (subscribed) {
        send({ event: 'unsubscribe_stream', stream_type: 'mobile_preview' });
      }
      ws.close();
      pc.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      callbacks().onClose?.();
    };
  }, [enabled, subscribe, videoRef]);
}