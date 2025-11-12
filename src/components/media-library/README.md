# Media Library Component

A comprehensive media management UI for the Media Presentation System. Supports text slides, videos, and PowerPoint presentations.

## Features

- **Media List**: Display all media items with filtering and search
- **Import Dialogs**: Add new media items (text slides, videos, PPTX)
- **Media Actions**: Edit, delete, duplicate, and present media items
- **Context Menu**: Right-click for quick actions
- **PPTX Conversion**: Real-time conversion progress tracking

## Usage

### Basic Usage

```tsx
import { MediaLibrary } from "@/components/media-library";

function MyComponent() {
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);

  const handleMediaSelect = (media: MediaItem) => {
    setSelectedMediaId(media.id);
    console.log("Selected:", media);
  };

  const handleMediaEdit = (media: MediaItem) => {
    console.log("Edit:", media);
    // Open editor for the media item
  };

  const handleMediaPresent = (media: MediaItem) => {
    console.log("Present:", media);
    // Start presentation
  };

  return (
    <MediaLibrary
      selectedMediaId={selectedMediaId}
      onMediaSelect={handleMediaSelect}
      onMediaEdit={handleMediaEdit}
      onMediaPresent={handleMediaPresent}
    />
  );
}
```

### Using Individual Components

```tsx
import { MediaList, AddTextSlideDialog } from "@/components/media-library";

function CustomMediaPanel() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <Button onClick={() => setShowDialog(true)}>Add Text Slide</Button>
      
      <MediaList
        onMediaSelect={(media) => console.log(media)}
      />

      <AddTextSlideDialog
        open={showDialog}
        onOpenChange={setShowDialog}
      />
    </>
  );
}
```

## Components

### MediaLibrary

Main component that integrates all media library features.

**Props:**
- `onMediaSelect?: (media: MediaItem) => void` - Called when a media item is selected
- `onMediaEdit?: (media: MediaItem) => void` - Called when edit action is triggered
- `onMediaPresent?: (media: MediaItem) => void` - Called when present action is triggered
- `selectedMediaId?: string | null` - Currently selected media item ID

### MediaList

Displays a filterable, searchable list of media items.

**Props:**
- Same as MediaLibrary

**Features:**
- Search by title
- Filter by media type (all, text, video, pptx)
- Display thumbnails and metadata
- Show conversion status for PPTX files
- Context menu on right-click
- Action menu on each item

### AddTextSlideDialog

Dialog for creating new text slides.

**Props:**
- `open: boolean` - Dialog open state
- `onOpenChange: (open: boolean) => void` - Callback when dialog state changes

### AddVideoDialog

Dialog for importing video files.

**Props:**
- `open: boolean` - Dialog open state
- `onOpenChange: (open: boolean) => void` - Callback when dialog state changes

**Features:**
- File selection via Tauri command
- Auto-fill title from filename
- Validation for required fields
- Supported formats: MP4, AVI, MOV, WebM

### AddPptxDialog

Dialog for importing and converting PowerPoint files.

**Props:**
- `open: boolean` - Dialog open state
- `onOpenChange: (open: boolean) => void` - Callback when dialog state changes

**Features:**
- File selection via Tauri command
- Metadata extraction (slide count)
- Real-time conversion progress
- Error handling with retry option
- Auto-close on success

### MediaItemActions

Dropdown menu with actions for a media item.

**Props:**
- `media: MediaItem` - The media item
- `onEdit?: (media: MediaItem) => void` - Edit callback
- `onPresent?: (media: MediaItem) => void` - Present callback

**Actions:**
- Present
- Edit
- Duplicate
- Delete (with confirmation)

### MediaItemContextMenu

Context menu wrapper for media items (right-click).

**Props:**
- `media: MediaItem` - The media item
- `children: React.ReactNode` - Content to wrap
- `onEdit?: (media: MediaItem) => void` - Edit callback
- `onPresent?: (media: MediaItem) => void` - Present callback

## Integration with Media Store

All components use the Zustand media store for state management:

```tsx
import { useMediaStore } from "@/store/mediaStore";

// Add media item
const addMediaItem = useMediaStore((state) => state.addMediaItem);
addMediaItem({
  type: "text",
  title: "My Slide",
  metadata: { /* ... */ }
});

// Get all media items
const mediaItems = useMediaStore((state) => state.mediaItems);

// Delete media item
const deleteMediaItem = useMediaStore((state) => state.deleteMediaItem);
deleteMediaItem(mediaId);
```

## Tauri Commands Used

The media library integrates with these Tauri commands:

- `select_video_file()` - Opens file picker for video files
- `select_pptx_file()` - Opens file picker for PPTX files
- `get_pptx_metadata(filePath)` - Extracts PPTX metadata
- `convert_pptx_to_pdf(filePath)` - Converts PPTX to PDF

## Styling

Components use Tailwind CSS and shadcn/ui components. Customize by:

1. Modifying Tailwind classes
2. Updating theme colors in `tailwind.config.js`
3. Overriding component styles

## Requirements Covered

This implementation satisfies the following requirements:

- **1.1, 1.2, 1.4**: Media management and storage
- **1.2, 1.5**: Media type specification and validation
- **4.1, 4.2, 4.3**: PPTX file selection and validation
- **1.1, 1.2**: Media item actions (edit, delete, duplicate)
