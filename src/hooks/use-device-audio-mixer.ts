import { useEffect, useRef } from 'react';

interface AudioMixerDevice {
  device_id: string;
}

interface AudioConnection {
  ws: WebSocket;
  pc: RTCPeerConnection;
  stream: MediaStream;
  gain: GainNode;
}

const WS_URL = 'ws://localhost:8080';

export function useDeviceAudioMixer(
  devices: AudioMixerDevice[],
  masterVolume: number,
  deviceVolumes: Record<string, number>,
) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const connectionsRef = useRef<Map<string, AudioConnection>>(new Map());

  useEffect(() => {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    audioContextRef.current = ctx;
    masterGainRef.current = master;
    ctx.resume().catch(() => {});

    const resume = () => {
      ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resume);

    return () => {
      window.removeEventListener('pointerdown', resume);
      for (const connection of connectionsRef.current.values()) {
        connection.ws.close();
        connection.pc.close();
      }
      connectionsRef.current.clear();
      ctx.close().catch(() => {});
      audioContextRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!masterGainRef.current || !audioContextRef.current) return;
    const time = audioContextRef.current.currentTime;
    masterGainRef.current.gain.setTargetAtTime(masterVolume / 100, time, 0.01);
  }, [masterVolume]);

  useEffect(() => {
    if (!audioContextRef.current) return;
    const time = audioContextRef.current.currentTime;
    for (const [deviceId, connection] of connectionsRef.current) {
      connection.gain.gain.setTargetAtTime((deviceVolumes[deviceId] ?? 100) / 100, time, 0.01);
    }
  }, [deviceVolumes]);

  useEffect(() => {
    const deviceIds = new Set(devices.map((device) => device.device_id));

    for (const [deviceId, connection] of connectionsRef.current) {
      if (!deviceIds.has(deviceId)) {
        connection.ws.close();
        connection.pc.close();
        connectionsRef.current.delete(deviceId);
      }
    }

    if (devices.length === 0) {
      return;
    }

    const ctx = audioContextRef.current;
    if (!ctx || !masterGainRef.current) {
      return;
    }

    for (const device of devices) {
      if (connectionsRef.current.has(device.device_id)) {
        continue;
      }

      const stream = new MediaStream();
      const gain = ctx.createGain();
      gain.gain.value = (deviceVolumes[device.device_id] ?? 100) / 100;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(gain);
      gain.connect(masterGainRef.current);

      const pc = new RTCPeerConnection();
      const ws = new WebSocket(WS_URL);
      let closed = false;

      const send = (payload: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      };

      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          stream.addTrack(event.track);
        }
      };

      ws.onopen = () => {
        if (closed) return;
        send({
          event: 'subscribe_stream',
          stream_type: `mobile_audio:${device.device_id}`,
        });
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data as string);
          const expectedType = `mobile_audio:${device.device_id}`;

          if (payload.event === 'stream_offer' && payload.stream_type === expectedType) {
            await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ event: 'webrtc_answer', stream_type: expectedType, sdp: answer.sdp });
            return;
          }

          if (
            payload.event === 'stream_ice_candidate' &&
            payload.stream_type === expectedType
          ) {
            await pc.addIceCandidate(payload.candidate);
          }
        } catch {
          // ignore malformed mixer signaling payloads
        }
      };

      ws.onclose = () => {
        closed = true;
      };

      connectionsRef.current.set(device.device_id, { ws, pc, stream, gain });
    }
  }, [devices, deviceVolumes]);
}