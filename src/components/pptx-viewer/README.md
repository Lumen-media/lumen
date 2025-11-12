# PPTX Viewer Component

A React component for displaying PowerPoint presentations (converted to PDF) with slide navigation and keyboard controls.

## Features

- **PDF Document Loading**: Lazy loads PDF documents from byte arrays
- **Slide Navigation**: Next/previous navigation with direct slide number input
- **Keyboard Shortcuts**: Arrow keys, Page Up/Down, Home, End, and Space bar
- **Slide Preloading**: Preloads adjacent slides for instant navigation (<100ms latency)
- **Dual Display Modes**: 
  - Control view with navigation controls
  - Display view for fullscreen presentation
- **Loading States**: Shows loading indicators during PDF initialization
- **Error Handling**: User-friendly error messages for loading failures
- **Responsive**: Automatically adjusts slide size based on container dimensions

## Usage

### Control View (Primary Screen)

```tsx
import { PptxViewer } from "@/components/pptx-viewer";
import { useMediaStore } from "@/store/mediaStore";

function PresentationControl() {
  const currentMedia = useMediaStore((state) => state.currentMedia);
  const currentSlide = useMediaStore((state) => state.currentSlideIndex);
  const goToSlide = useMediaStore((state) => state.goToSlide);

  if (currentMedia?.type !== "pptx") return null;

  return (
    <PptxViewer
      mediaId={currentMedia.id}
      metadata={currentMedia.metadata}
      currentSlide={currentSlide}
      onSlideChange={goToSlide}
      isControlView={true}
    />
  );
}
```

### Display View (Secondary Screen)

```tsx
import { PptxViewer } from "@/components/pptx-viewer";
import { useMediaStore } from "@/store/mediaStore";

function PresentationDisplay() {
  const currentMedia = useMediaStore((state) => state.currentMedia);
  const currentSlide = useMediaStore((state) => state.currentSlideIndex);
  const goToSlide = useMediaStore((state) => state.goToSlide);

  if (currentMedia?.type !== "pptx") return null;

  return (
    <PptxViewer
      mediaId={currentMedia.id}
      metadata={currentMedia.metadata}
      currentSlide={currentSlide}
      onSlideChange={goToSlide}
      isControlView={false}
      className="w-screen h-screen"
    />
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `mediaId` | `string` | Yes | Unique identifier for the media item |
| `metadata` | `PptxMetadata` | Yes | PPTX metadata including pdfBytes and slideCount |
| `currentSlide` | `number` | Yes | Current slide index (0-based) |
| `onSlideChange` | `(index: number) => void` | Yes | Callback when slide changes |
| `isControlView` | `boolean` | No | Show controls (default: false) |
| `className` | `string` | No | Additional CSS classes |

## Keyboard Shortcuts

- **Arrow Right / Page Down / Space**: Next slide
- **Arrow Left / Page Up**: Previous slide
- **Home**: First slide
- **End**: Last slide

## Performance

- **Slide Preloading**: Adjacent slides (previous and next) are preloaded in the background
- **Navigation Latency**: < 100ms for slide transitions
- **Memory Management**: Only current and adjacent slides are kept in memory
- **Responsive Sizing**: Automatically adjusts to container size

## Requirements Satisfied

- **7.1**: Uses react-pdf library to render PDF pages as individual slides
- **7.2**: Provides navigation controls for next/previous/specific slide
- **7.3**: Shows current slide number and total count
- **7.4**: Implements keyboard shortcuts for navigation
- **7.5**: Preloads adjacent slides for instant navigation
- **8.1**: Lazy loads PDF document from byte array with loading indicator
- **8.2**: Handles PDF loading errors with user-friendly messages
- **8.3**: Implements slide caching strategy with <100ms latency

## Dependencies

- `react-pdf`: PDF rendering library
- `pdfjs-dist`: PDF.js library for PDF parsing
- `lucide-react`: Icons for navigation controls
