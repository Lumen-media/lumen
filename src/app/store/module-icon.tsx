import DOMPurify from 'dompurify';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { catalogAssetUrl } from '@/services/store-service';

const svgCache = new Map<string, string | null>();

function fetchSvgText(src: string): Promise<string | null> {
  const cached = svgCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  return fetch(src)
    .then((res) => (res.ok ? res.text() : null))
    .then((text) => {
      svgCache.set(src, text);
      return text;
    })
    .catch(() => {
      svgCache.set(src, null);
      return null;
    });
}

function SvgInline({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isStroke = /stroke(?:\s*[:=])/i.test(html);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = DOMPurify.sanitize(html, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
    }
  }, [html]);

  return (
    <span
      ref={ref}
      className={cn(
        'store-module-svg flex items-center justify-center [&_svg]:size-full',
        isStroke ? '[&_svg]:stroke-current' : '[&_svg]:fill-current',
        className
      )}
    />
  );
}

export function ModuleIcon({
  name,
  icon,
  boxClassName = 'size-10',
  iconClassName = 'size-6',
}: {
  name: string;
  icon?: string;
  boxClassName?: string;
  iconClassName?: string;
}) {
  const iconSrc = catalogAssetUrl(icon);
  const isSvg = !!iconSrc && /\.svg(\?|$)/i.test(iconSrc);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!isSvg || !iconSrc) return;
    let alive = true;
    fetchSvgText(iconSrc).then((text) => {
      if (alive) setSvg(text);
    });
    return () => {
      alive = false;
    };
  }, [isSvg, iconSrc]);

  let content: ReactNode;
  if (iconSrc && !isSvg) {
    content = <img src={iconSrc} alt="" className={cn(iconClassName, { 'size-auto': iconSrc })} />;
  } else if (iconSrc && isSvg && svg) {
    content = <SvgInline html={svg} className={iconClassName} />;
  } else {
    content = <span className="text-[11px] font-semibold">{name.slice(0, 2).toUpperCase()}</span>;
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300',
        {
          "border-none": !isSvg,
        },
        boxClassName,
      )}
    >
      {content}
    </div>
  );
}
