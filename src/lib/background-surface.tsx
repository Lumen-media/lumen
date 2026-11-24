// Copyright 2026 Gabriel Santos
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 — see LICENSE for the full text.
// If you modify this file, you must carry a prominent notice stating that you
// changed it (LICENSE section 4(b)).

import {
  GeneratorPoster,
  GeneratorSurface,
  generatorOf,
} from '@/backgrounds/components/GeneratorSurface';
import type { Background } from '@/backgrounds/types';
import { mediaSrcOf } from '@/backgrounds/uri';
import { cn } from '@/lib/utils';
import { lumenUrl } from '@/services/lumen-url';

/** A stored background, a media path/URL or a background ref. */
export type BackgroundValue =
  | string
  | { type?: string; src?: string; name?: string; thumb?: string }
  | null
  | undefined;

export interface BackgroundSurfaceProps {
  /** Background to draw: `lumen-bg://` URI, media path/URL or a background ref. */
  background: BackgroundValue;
  /**
   * `fill` (default) covers the surface and animates generators.
   * `thumbnail` keeps generated backgrounds on one cached frame and asks for
   * small media variants, for lists and previews.
   */
  variant?: 'fill' | 'thumbnail';
  /** Set `false` to draw a single cached frame instead of animating a generator. */
  animated?: boolean;
  /** Applied to the media element; layout classes go on the wrapper. */
  className?: string;
}

/**
 * Renders any stored background the way Lumen does: media from disk, generated
 * effects on a live shader surface (or one cached frame), and nothing when
 * there is no background. Fills its parent, so put it in a positioned box.
 *
 * Modules import this through `@lumen-media/module-sdk/ui`; the host serves it
 * from `/__lumen/ui.js`.
 */
export function BackgroundSurface({
  background,
  variant = 'fill',
  animated = true,
  className,
}: BackgroundSurfaceProps) {
  // `generatorOf` / `mediaSrcOf` decode module `SelectedBackground` objects
  // (generator kept as a `lumen-bg://` URI in `src`) through `parseBackground`.
  const value = background as string | Background | null | undefined;

  const generator = generatorOf(value);
  if (generator) {
    if (variant === 'thumbnail' || !animated) {
      return <GeneratorPoster value={generator} className={className} />;
    }
    return <GeneratorSurface value={generator} maxFps={30} className={className} />;
  }

  const src = mediaSrcOf(value);
  if (!src) return null;

  const type = typeof background === 'string' ? 'image' : background?.type;
  const resolved = variant === 'thumbnail' ? lumenUrl(src, { w: 400 }) : lumenUrl(src);

  if (type === 'video') {
    return (
      <video
        src={resolved}
        autoPlay
        loop
        muted
        className={cn('absolute inset-0 h-full w-full object-cover', className)}
      />
    );
  }

  return (
    <img
      src={resolved}
      alt=""
      className={cn('absolute inset-0 h-full w-full object-cover', className)}
    />
  );
}
