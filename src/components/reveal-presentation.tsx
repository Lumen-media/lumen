import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { Deck, Slide } from '@revealjs/react';
import { PptxRenderer } from 'pptx-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RevealApi } from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/black.css';

interface RevealPresentationProps {
  filePath: string;
}

function svgToDataUrl(svg: string): string {
  const encoded = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

export function RevealPresentation({ filePath }: RevealPresentationProps) {
  const deckRef = useRef<RevealApi | null>(null);
  const [svgs, setSvgs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderer = new PptxRenderer();

    async function load() {
      try {
        const bytes = await readFile(filePath);
        await renderer.load(bytes.buffer, () => {});

        const count = renderer.slideCount;
        const allSvgs = await renderer.allToSvg();
        if (cancelled) return;

        setSvgs(allSvgs);

        const thumbs = allSvgs.map((svg, i) => ({
          index: i,
          dataUrl: svgToDataUrl(svg),
          label: `Slide ${i + 1}`,
        }));

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
      renderer.destroy();
    };
  }, [filePath]);

  useEffect(() => {
    const unlisten = listen<{ index: number }>('presentation:set-slide', (event) => {
      deckRef.current?.slide(event.payload.index);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSlideChange = useCallback(
    (event: Event) => {
      const slideEvent = event as unknown as { indexh: number; indexv?: number };
      emit('presentation:slide-changed', {
        currentSlide: slideEvent.indexh,
        totalSlides: svgs.length,
      }).catch(() => {});
    },
    [svgs.length]
  );

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-white">
        <p className="text-lg text-red-400">{error}</p>
      </div>
    );
  }

  if (svgs.length === 0) {
    return <div className="h-full w-full bg-black" />;
  }

  return (
    <div className="h-full w-full bg-black">
      <Deck
        deckRef={deckRef}
        onSlideChange={handleSlideChange}
        config={{
          width: 1920,
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
        {svgs.map((svg, index) => (
          <Slide key={`slide-${index}`} backgroundColor="#000">
            <div className="flex h-full w-full items-center justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
          </Slide>
        ))}
      </Deck>
    </div>
  );
}
