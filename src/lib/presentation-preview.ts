export const PRESENTATION_PREVIEW_STORAGE_KEY = 'lumen:presentation-preview-file';
export const PRESENTATION_PREVIEW_EVENT = 'lumen:presentation-preview-selected';

export type PresentationPreviewEvent = CustomEvent<{ filePath: string }>;

export function selectPresentationPreview(filePath: string) {
  localStorage.setItem(PRESENTATION_PREVIEW_STORAGE_KEY, filePath);
  window.dispatchEvent(new CustomEvent(PRESENTATION_PREVIEW_EVENT, { detail: { filePath } }));
}

export function getPresentationPreviewPath(): string | null {
  return localStorage.getItem(PRESENTATION_PREVIEW_STORAGE_KEY);
}

export function clearPresentationPreview(): void {
  localStorage.removeItem(PRESENTATION_PREVIEW_STORAGE_KEY);
}