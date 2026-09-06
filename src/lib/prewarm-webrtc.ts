let warmed = false;

export function prewarmWebRtc(): void {
  if (warmed) return;
  warmed = true;

  try {
    const pc = new RTCPeerConnection();
    pc.close();
  } catch {
    // noop
  }
}