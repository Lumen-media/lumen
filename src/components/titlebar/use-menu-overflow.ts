import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useResizeObserver } from 'usehooks-ts';
import type { MenuDef } from './menu-registry';

const OVERFLOW_BTN_WIDTH = 44;

export function useMenuOverflow(menus: MenuDef[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(menus.length);

  const { width = 0 } = useResizeObserver({ ref: containerRef as RefObject<HTMLElement> });

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure || width === 0) return;

    const widths = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth);
    const total = widths.reduce((sum, w) => sum + w, 0);

    if (total <= width) {
      setVisibleCount(menus.length);
      return;
    }

    let used = 0;
    let count = 0;

    for (let i = 0; i < widths.length; i++) {
      if (used + widths[i] + OVERFLOW_BTN_WIDTH <= width) {
        used += widths[i];
        count = i + 1;
      } else {
        break;
      }
    }

    setVisibleCount(count);
  }, [width, menus.length]);

  return {
    containerRef,
    measureRef,
    visibleMenus: menus.slice(0, visibleCount),
    overflowMenus: menus.slice(visibleCount),
  };
}
