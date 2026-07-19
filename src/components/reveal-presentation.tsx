import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { animate } from 'animejs';
import { toJpeg } from 'html-to-image';
import { useEffect, useRef, useState } from 'react';

interface PptxPresentationProps {
  filePath: string;
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
        });

        if (cancelled) {
          viewer.destroy();
          return;
        }

        viewerRef.current = viewer;

        viewer.addEventListener('slidechange', (e: Event) => {
          const ce = e as CustomEvent<{ index: number }>;
          emit('presentation:slide-changed', {
            currentSlide: ce.detail?.index ?? 0,
            totalSlides: viewer.slideCount,
          }).catch(() => { });

          if (container) {
            animate(container, {
              opacity: [0.85, 1],
              scale: [0.98, 1],
              duration: 500,
              easing: 'easeOutCubic',
            });
          }
        });

        const count = viewer.slideCount;

        emit('presentation:slide-changed', {
          currentSlide: viewer.currentSlideIndex,
          totalSlides: count,
        }).catch(() => { });

        const placeholders: Array<{ index: number; dataUrl: string; label: string }> = [];
        for (let i = 0; i < count; i++) {
          placeholders.push({ index: i, dataUrl: '', label: `Slide ${i + 1}` });
        }
        emit('presentation:thumbnails-ready', { thumbs: placeholders }).catch(() => { });

        const thumbs: Array<{ index: number; dataUrl: string; label: string }> = [];
        for (let i = 0; i < count; i++) {
          const wrapper = document.createElement('div');
          wrapper.style.position = 'absolute';
          wrapper.style.left = '-9999px';
          wrapper.style.overflow = 'hidden';
          wrapper.style.width = '320px';
          document.body.appendChild(wrapper);

          const th = viewer.renderThumbnailToContainer(i, wrapper, { width: 320 });
          await th?.ready;

          let dataUrl = '';

          const el = th?.element;
          if (el) {
            try {
              dataUrl = await toJpeg(el, { quality: 0.7, pixelRatio: 2 });
            } catch {
              // thumbnail capture failed, skip
            }
          }

          th?.dispose();
          wrapper.remove();

          thumbs.push({
            index: i,
            dataUrl,
            label: `Slide ${i + 1}`,
          });
        }

        emit('presentation:thumbnails-ready', { thumbs }).catch(() => { });
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
