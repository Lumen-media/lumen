/// <reference types="vite/client" />

declare const __BUILD_DATE__: string;

declare module 'pptx-browser' {
  export class PptxRenderer {
    slideCount: number;
    load(source: ArrayBuffer | Uint8Array, onProgress?: (progress: number) => void): Promise<void>;
    renderSlide(slideIndex: number, canvas: HTMLCanvasElement, width?: number): Promise<void>;
    renderAllSlides(width?: number): Promise<HTMLCanvasElement[]>;
    allToSvg(): Promise<string[]>;
    toSvg(slideIndex: number): Promise<string>;
    destroy(): void;
  }
}
