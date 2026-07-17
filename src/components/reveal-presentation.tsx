import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import { useEffect, useRef, useState } from 'react';

interface PptxPresentationProps {
  filePath: string;
}

function svgElementToDataUrl(el: SVGElement): string {
  const serialized = new XMLSerializer().serializeToString(el);
  const encoded = btoa(unescape(encodeURIComponent(serialized)));
  return `data:image/svg+xml;base64,${encoded}`;
}

export function PptxPresentation({ filePath }: PptxPresentationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    async function load() {
      try {
        const bytes = await readFile(filePath);
        if (cancelled) return;

        const viewer = await PptxViewer.open(bytes.buffer, container!, {
          renderMode: 'slide',
          fitMode: 'contain',
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          onSlideChange: (index: number) => {
            emit('presentation:slide-changed', {
              currentSlide: index,
              totalSlides: viewer.slideCount,
            }).catch(() => {});
          },
        });

        if (cancelled) {
          viewer.destroy();
          return;
        }

        viewerRef.current = viewer;

        const count = viewer.slideCount;

        const thumbs: Array<{ index: number; dataUrl: string; label: string }> = [];
        for (let i = 0; i < count; i++) {
          const wrapper = document.createElement('div');
          wrapper.style.width = '320px';
          wrapper.style.overflow = 'hidden';
          const th = viewer.renderThumbnailToContainer(i, wrapper, { width: 320 });
          await th?.ready;
          const svg = wrapper.querySelector('svg');
          if (svg) {
            thumbs.push({
              index: i,
              dataUrl: svgElementToDataUrl(svg),
              label: `Slide ${i + 1}`,
            });
          }
          th?.dispose();
        }

        emit('presentation:thumbnails-ready', { thumbs }).catch(() => {});
        emit('presentation:slide-changed', {
          currentSlide: 0,
          totalSlides: count,
        }).catch(() => {});
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    const unlisten = listen<{ index: number }>('presentation:set-slide', (event) => {
      viewerRef.current?.goToSlide(event.payload.index);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-white">
        <p className="text-lg text-red-400">{error}</p>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full bg-black" />;
}
