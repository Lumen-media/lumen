# Lumen

A desktop application focused on simplicity, visual sophistication, and operational efficiency for live presentations. Lumen helps operators control song lyrics, videos, and raffles through a floating-panel interface designed to reduce cognitive load during live events.

---

## Core Features

### Live Preview Panel
- Central real-time view of the content being projected
- Integrated playback controls (play, pause, progress bar) at the bottom

### Presentation Manager
- Left sidebar for navigating between event sections (e.g. Songs, Sermon, Announcements)
- Clean vertical list with indicative icons per item

### Media Library
- Right sidebar organized by tabs: Media, Lyrics, and Themes
- Quick access to background videos and images with duration indicators

### Lyrics Editor
- Text editor where each empty line automatically creates a new slide
- Grid preview panel to see how each verse will look on screen before going live
- Individual background customization per slide

### Raffle System
- Integrated modal tool for quick participant or item raffles during events

---

## What's Already Built

### Lyrics Management
- Create, edit, and save lyrics in markdown format with metadata (name, author, notes)
- Rich editor with bold, italic, underline, and text alignment support
- Lyrics divided into slides separated by line breaks
- Live slide preview while editing
- Slide thumbnails with visual sequence strip
- Auto-scroll to the selected slide

### Presentation
- Full-screen lyric display with responsive font sizing
- Per-slide or global background image support
- Unsplash integration for searching background images
- Local library of downloaded images
- Font, size, and alignment options per song

### Media Playback
- Audio and video playback
- Full controls: play/pause, next/previous, volume, seek
- Compact MiniPlayer always visible on the main screen
- Separate media window for display on a secondary screen

### Media Library
- Browse by type: lyrics, video, audio, text, images, other
- Search field to filter files
- Context menu with file actions (play, edit, delete, etc.)
- Metadata reading (title, artist, duration)
- Thumbnail previews for images and videos, generated once and cached on disk via a Rust backend (OS-native thumbnails on Windows and Linux; pure-Rust fallback via `image` + `symphonia` + `openh264`)

### Playback Queue
- Add, remove, and reorder items in the queue
- Mark items as played
- Shuffle the queue
- Queue persistence between sessions

### Media Window (Secondary Screen)
- Dedicated window for audience display
- Displays video and lyrics in sync
- Automatic secondary screen detection
- Fullscreen support

### Real-Time Communication
- WebSocket sync between the main window and the media window
- Remote lyric control (advance/go back slides) from the main window

### Settings & Persistence
- Local SQLite database for media and queue
- Restores last played media on startup
- Saves window position and state

---

## Interface Layout

The app uses a 3-panel resizable layout:

| Panel | Content |
|-------|---------|
| Left | Media library with search and filters |
| Center | Lyrics editor / Live preview |
| Right | Playback queue, notes, and themes |

The MiniPlayer with playback controls sits at the bottom of the center panel.

---

## Visual Identity

| Property | Value |
|----------|-------|
| Base background | `#020717` — used in gaps between panels and the header |
| Sidebars | `#0f182a` — dark teal for side menus and control bars |
| Center panel | `#0A1321` — slightly lighter to highlight the main workspace |
| Accent | Cyan / vibrant blue for action buttons and active states |
| Layout | 16:9 proportion, ideal for projection screens and modern monitors |
| Style | Rounded corners on all elements for a sophisticated, non-rigid look |

The "gaps" between panels intentionally reveal the dark base background, creating a layered depth effect.

---

## Lyrics File Format

Lyrics are saved as `.md` files with YAML frontmatter:

```markdown
---
name: Song Name
author: Artist
font: Inter
fontSize: 48
alignment: center
globalBackground: /path/to/image.jpg
---

First verse
Second line of the verse

Second verse
Second line of the second verse
```

Each block separated by a double blank line becomes an individual slide in the presentation.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Desktop Framework | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript |
| Build | Vite 7 + SWC |
| Routing | TanStack Router |
| State Management | Zustand |
| Styling | Tailwind CSS 4 |
| Text Editor | TipTap 3 |
| Video Player | React Player |
| Thumbnail Cache | Rust (`image`, `symphonia`, `openh264`, BLAKE3) |
| Database | SQLite (via Tauri plugin) |
| Real-Time Comms | WebSocket (Rust/Tokio) |
| Internationalization | i18next |
| Icons | Lucide React |
| Notifications | Sonner |

---

## Roadmap

- [ ] Full presentation mode with slide control
- [ ] Live broadcast mode
- [x] Custom visual themes
- [ ] Per-song notes
- [ ] Raffle system modal
- [ ] Presentation manager (event section navigation)
- [ ] More media search integrations
