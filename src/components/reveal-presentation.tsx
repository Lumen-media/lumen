import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { Deck, Slide, type RevealApi } from '@revealjs/react';
import { PptxRenderer } from 'pptx-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/black.css';

interface RevealPresentationProps {
  filePath: string;
}

interface SlideImage {
  index: number;
  dataUrl: string;
}

const SLIDE_WIDTH = 1920;
const THUMB_WIDTH = 320;

async function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to create blob from canvas'));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/jpeg');
  });
}

export function RevealPresentation({ filePath }: RevealPresentationProps) {
  const deckRef = useRef<RevealApi | null>(null);
  const [slideImages, setSlideImages] = useState<SlideImage[]>([]);
  const rendererRef = useRef<PptxRenderer | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const revokeAll = useCallback(() => {
    for (const url of blobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    blobUrlsRef.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const renderer = new PptxRenderer();
    rendererRef.current = renderer;

    async function load() {
      try {
        const bytes = await readFile(filePath);
        await renderer.load(bytes.buffer, (progress) => {
          if (progress < 1) return;
        });

        const count = renderer.slideCount;

        const canvases = await renderer.renderAllSlides(SLIDE_WIDTH);
        if (cancelled) return;

        const images: SlideImage[] = [];
        const thumbs: Array<{ index: number; dataUrl: string; label: string }> = [];

        for (let i = 0; i < canvases.length; i++) {
          const dataUrl = await canvasToBlobUrl(canvases[i]);
          blobUrlsRef.current.push(dataUrl);
          images.push({ index: i, dataUrl });
        }

        if (cancelled) return;
        setSlideImages(images);

        const thumbCanvases = count > 1 ? await renderer.renderAllSlides(THUMB_WIDTH) : canvases;
        for (let i = 0; i < thumbCanvases.length; i++) {
          if (cancelled) return;
          const thumbUrl = thumbCanvases[i].toDataURL('image/jpeg', 0.7);
          thumbs.push({
            index: i,
            dataUrl: thumbUrl,
            label: `Slide ${i + 1}`,
          });
        }

        if (!cancelled) {
          emit('presentation:thumbnails-ready', { thumbs }).catch(() => {});
          emit('presentation:slide-changed', {
            currentSlide: 0,
            totalSlides: count,
          }).catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load presentation');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      revokeAll();
      renderer.destroy();
    };
  }, [filePath, revokeAll]);

  useEffect(() => {
    const unlisten = listen<{ index: number }>('presentation:set-slide', (event) => {
      deckRef.current?.slide(event.payload.index);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSlideChange = useCallback(
    (event: { indexh: number }) => {
      const total = slideImages.length;
      emit('presentation:slide-changed', {
        currentSlide: event.indexh,
        totalSlides: total,
      }).catch(() => {});
    },
    [slideImages.length]
  );

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-white">
        <p className="text-lg text-red-400">{error}</p>
      </div>
    );
  }

  if (slideImages.length === 0) {
    return <div className="h-full w-full bg-black" />;
  }

  return (
    <div className="h-full w-full bg-black">
      <Deck
        deckRef={deckRef}
        onSlideChange={handleSlideChange}
        config={{
          width: SLIDE_WIDTH,
          height: 1080,
          transition: 'slide',
          backgroundTransition: 'fade',
          controls: false,
          keyboard: false,
          touch: false,
          hash: false,
          loop: false,
          autoSlide: 0,
        }}
      >
        {slideImages.map((slide, index) => (
          <Slide
            key={`slide-${index}`}
            backgroundImage={slide.dataUrl}
            backgroundSize="contain"
            backgroundColor="#000"
          />
        ))}
      </Deck>
    </div>
  );
}
