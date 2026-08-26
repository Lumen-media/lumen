# Chat — Usage Guide

Private chat between the **operator** (desktop) and **paired devices** (remote controls via WebSocket). Not a public chat: only authenticated devices with the `chat` permission participate.

---

## Opening the Chat

- **Header button:** click the 💬 icon (or `Ctrl+Shift+C`).
- **Tab behavior:** the aside has 3 visible tabs: Queue, Notes, and a slot that switches between **Chat** and **Themes**.
  - Clicking the header button makes the slot **Chat** (selected).
  - Switching to Queue or Notes reverts the slot to **Themes**.
  - To return to chat, click the header button again.

> If chat is not enabled in settings, the header icon appears but does not open messages until activated.

---

## Sending Messages

1. Type in the text box at the bottom of the chat.
2. Press `Enter` to send, or `Shift+Enter` for a new line.
3. **Reply:** click the reply icon ↩ that appears when hovering over a message, or right-click → Reply.
4. **Limit:** 4000 characters per message. The counter appears in the bottom-right corner of the text box and turns red when exceeded.

---

## Sending Files

1. Click the 📎 (clip) icon next to the text box.
2. Select the file in the dialog.
3. Optionally add a caption in the text box.
4. **Limit:** 25 MB per file.
5. **Blocked types:** `.exe`, `.bat`, `.cmd`, `.com`, `.msi`, `.scr`, `.pif`, `.ps1`, `.vbs`, `.js`, `.hta`, `.cpl`, `.lnk`, `.inf`, `.reg`.

---

## Reacting to Messages

1. Hover over the message.
2. Emoji buttons appear below (or in the corner).
3. Click to add/remove the reaction (toggle — same emoji from same sender = removes it).

---

## Deleting Messages

1. Right-click the message → **Delete**.
2. The message is removed from the chat and history.
3. If the message had an attached file, the file is also removed from disk.

---

## YouTube Links

- **Markdown-formatted links** (`[text](url)`) with YouTube URLs are clickable and open a preview dialog (thumbnail, title, channel, duration).
- **In the dialog:**
  - **Play Now:** opens the media in Lumen's player.
  - **Add to Queue:** adds to the playback queue.
- **Links from other sites:** open in the default browser.
- **Raw URLs** (pasted as plain text, without markdown formatting) **are not clickable** — they are displayed as normal text.

---

## File Previews

### Images
- Thumbnail displayed in the message bubble.
- Click to open larger in a dialog.
- **Types:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`.

### PDFs
- First page thumbnail displayed in the bubble.
- Click opens Lumen's PDF viewer.

### Presentations (PPT/PPTX)
- First slide thumbnail generated automatically.
- Click opens in a dialog with a **Present** button → opens the presentation in a separate window.
- **Note:** generating PPT thumbnails is heavy (opens the file, renders the slide, captures the image). The result is cached — the second time the same file is viewed, it loads instantly.

---

## Read Receipts

- ✓ (single check) = message sent.
- ✓✓ (blue double check) = at least one device read the message.
- The indicator appears next to the timestamp, only for operator messages.

---

## Typing Indicator

When a device is typing, the device name + ellipsis animation appears at the bottom of the chat. The indicator automatically disappears after 3 seconds of inactivity.

---

## Notifications

Configurable in **Settings → Advanced → Chat → Notifications**:

| Mode | Behavior |
|---|---|
| **Off** | No notifications. |
| **In-App** | Toast inside the application. |
| **System** | Operating system notification. |

> A pulsing dot on the header icon indicates unread messages.

---

## Chat Settings

In **Settings → Advanced → Chat**:

| Setting | Description |
|---|---|
| **Enable Chat** | Turns chat on/off globally. When off, devices cannot send messages. |
| **Persist Messages** | When off, messages are deleted on app restart. When on, they survive restarts. |
| **History Limit** | How many messages to keep in memory (default: 200). |
| **Notifications** | Notification mode (Off / In-App / System). |
| **Per-Device Permissions** | In Devices, each device has a "Chat" flag to allow/deny chat access. |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+C` | Opens the chat (focuses the editor). |
| `Enter` | Sends the message. |
| `Shift+Enter` | New line in the text box. |
