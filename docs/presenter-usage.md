# Presentation (PPT/PPTX) — Usage Guide

## Overview

Lumen can open and present PowerPoint (.ppt / .pptx) files directly on the media window using a combination of `pptx-browser` (canvas rendering) and `reveal.js` (slide deck navigation).

## How to use

### Importing a presentation

**Via Media Panel:**
1. Go to the **Media Panel** (left sidebar).
2. Click **Presentation** in the file categories.
3. Drag and drop `.ppt`/`.pptx` files into the folder, or click the **+** button and select files via the OS file picker.

**Via Presentation Tab:**
1. Click the **Presentation** tab in the top navigation bar.
2. Click **Import** to open the OS file picker and select one or more `.ppt`/`.pptx` files.

### Starting a presentation

**From the Media Panel:**
- Double-click a presentation file in the Presentation category list.

**From the Presentation Tab:**
- Click on any file in the list. The media window will open in fullscreen and display the slides.

### Controlling the presentation

Once a presentation is running, you can control it from the **Presenter Controls** bar at the bottom of the main window:

| Action | Input |
|--------|-------|
| Next slide | Right Arrow, Down Arrow, Page Down |
| Previous slide | Left Arrow, Up Arrow, Page Up |
| First slide | Home |
| Last slide | End |
| Toggle wallpaper | F8 |
| Toggle lyrics overlay | F9 |
| Black screen | F10 |
| Exit presentation | Escape |

You can also click on any slide thumbnail in the Presenter Controls to jump directly to that slide.

### Search

The text content of each slide is automatically extracted and indexed when a presentation file is imported. You can search for presentations by their content using the search bar in the Media Panel or the global search.

### Presentation Tab

The Presentation tab (top navigation) works in two modes:

**When no presentation is active:**
- Shows a list of all imported `.ppt`/`.pptx` files.
- Click **Import** to add new files.
- Click a file to open it in the media window.

**When a presentation is active:**
- Shows the file name and current slide position.
- Displays a scrollable strip of slide thumbnails.
- Click any thumbnail to jump to that slide.
- Click **End presentation** to stop and close the media window.

## Notes

- The `presentation` folder is created automatically in the media directory (`media/presentation/`).
- Supported formats: `.ppt`, `.pptx`.
- Thumbnails are generated live by rendering each slide to a canvas. No disk cache is used.
- Text content is extracted at import time via a Rust command and stored in the database for search.
- Closing and reopening the app re-syncs the file list automatically.
