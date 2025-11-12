# Text Slide Components

This directory contains components for creating and displaying text slides in the Media Presentation System.

## Components

### TextSlideEditor

A rich text editing interface for creating and editing text slides.

**Features:**
- Text content editing with textarea
- Font size control (24px minimum for readability)
- Font color picker with hex input
- Background color picker with hex input
- Text alignment controls (left, center, right)
- Live preview of the text slide

**Props:**
```typescript
interface TextSlideEditorProps {
  mediaId: string;
  content: string;
  metadata: TextSlideMetadata;
  onUpdate: (content: string, metadata: TextSlideMetadata) => void;
}
```

**Usage:**
```tsx
import { TextSlideEditor } from "@/components/text-slide-editor";

<TextSlideEditor
  mediaId="slide-1"
  content="Welcome!"
  metadata={{
    content: "Welcome!",
    fontSize: 48,
    fontColor: "#FFFFFF",
    backgroundColor: "#1E40AF",
    alignment: "center"
  }}
  onUpdate={(content, metadata) => {
    // Handle updates
  }}
/>
```

### TextSlideViewer

Displays text slides in presentation mode for the secondary screen.

**Features:**
- Fullscreen display optimized for secondary screen
- Renders text with applied formatting
- Ensures minimum font size of 24px for readability
- No controls or UI elements (display-only mode)

**Props:**
```typescript
interface TextSlideViewerProps {
  content: string;
  metadata: TextSlideMetadata;
  isControlView?: boolean;
  className?: string;
}
```

**Usage:**
```tsx
import { TextSlideViewer } from "@/components/text-slide-viewer";

// For secondary screen (fullscreen)
<TextSlideViewer
  content="Welcome to our presentation!"
  metadata={{
    content: "Welcome to our presentation!",
    fontSize: 48,
    fontColor: "#FFFFFF",
    backgroundColor: "#1E40AF",
    alignment: "center"
  }}
  isControlView={false}
/>

// For control view (with padding)
<TextSlideViewer
  content="Welcome to our presentation!"
  metadata={metadata}
  isControlView={true}
/>
```

## Integration with Media Store

These components are designed to work with the `useMediaStore` hook:

```tsx
import { useMediaStore } from "@/store/mediaStore";
import { TextSlideEditor } from "@/components/text-slide-editor";
import { isTextSlideMetadata } from "@/types/media";

function MyComponent() {
  const mediaItem = useMediaStore((state) => 
    state.getMediaItemById("slide-id")
  );
  const updateMediaItem = useMediaStore((state) => state.updateMediaItem);

  if (!mediaItem || !isTextSlideMetadata(mediaItem.metadata)) {
    return null;
  }

  return (
    <TextSlideEditor
      mediaId={mediaItem.id}
      content={mediaItem.metadata.content}
      metadata={mediaItem.metadata}
      onUpdate={(content, metadata) => {
        updateMediaItem(mediaItem.id, {
          metadata: { ...metadata, content }
        });
      }}
    />
  );
}
```

## Requirements Satisfied

- **Requirement 2.1**: Text editor interface for creating text slide content ✓
- **Requirement 2.2**: Display text content on secondary screen ✓
- **Requirement 2.3**: Preview and editing controls on primary screen ✓
- **Requirement 2.4**: Basic text formatting (font size, color, alignment) ✓
- **Requirement 2.5**: Minimum font size of 24px for readability ✓

## Example

See `example.tsx` for a complete working example demonstrating both components side-by-side.
