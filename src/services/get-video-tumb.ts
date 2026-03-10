export function extractVideoThumbnail(blobUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = blobUrl;
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = Math.min(2, video.duration * 0.1);
      },
      { once: true }
    );
    video.addEventListener(
      'seeked',
      () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 180;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch {
          resolve(null);
        }
      },
      { once: true }
    );
    video.addEventListener('error', () => resolve(null), { once: true });
  });
}
