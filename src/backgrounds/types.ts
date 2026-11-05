import type { BACKGROUND_BUNDLE } from './generated/catalog';

/** Value a generator parameter can hold. */
export type ParamValue = number | boolean | string;

/** One effect as emitted by the Rust catalog. */
export type EffectRuntime = (typeof BACKGROUND_BUNDLE)['effects'][number];
/** One adjustable parameter of an effect. */
export type ParamSpec = EffectRuntime['params'][number];
/** One compiled shader pass of an effect. */
export type PassSpec = EffectRuntime['passes'][number];

/** Image, video or theme background (unchanged from the asset model). */
export type MediaBackground = {
  type: 'theme' | 'image' | 'video';
  src: string;
  name: string;
};

/** Procedural background reference. */
export type GeneratorBackground = {
  type: 'generator';
  effect: string;
  params: Record<string, ParamValue>;
  seed: number;
  name: string;
  preset?: string;
};

/** Anything the background layer can render. */
export type Background = MediaBackground | GeneratorBackground;
