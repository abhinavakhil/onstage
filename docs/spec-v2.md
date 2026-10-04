# Onstage — Product specification v2

**Audience:** Claude Code (or any engineer) working in the `onstage` repository.
**Goal of this document:** describe, screen by screen, what Onstage must do, so that work can start without further clarification. Every section has: what the user sees, what the app must do, where it lives in the code, and acceptance criteria.

The reference screenshots in `docs/images/` are from Boom (boomvideo.app) on macOS. They define the *flow and behaviour* we want. They do **not** define our visual design: Onstage keeps its own brand (forest green `#2f4b32`, lime `#c5f08e`, off-white `#fafafb`, Poppins display + DM Sans body, see `landing/styles.css`). Never copy Boom's name, logo, colours, wallpaper images or GIFs.

Part A covers the studio flow (what Boom does today, adapted to Onstage).
Part B adds **Meetings**: Onstage appears inside Google Meet / Zoom / Teams as a camera, and records, transcribes and summarises the meeting the way Granola does, with no bot joining the call.
Part C is the implementation plan, in order, with acceptance criteria.
Part D lists what was deliberately deferred.

---

## 0. How to work from this document

1. Read §1 (what already exists) before touching code. Most of Part A already exists in some form; do not rebuild it, extend it.
2. Work phase by phase in Part C. Each phase is shippable on its own.
3. Keep the principles in §2. If a decision is not covered here, choose the option that keeps everything on the user's computer and needs no account.
4. When a screenshot shows a Boom-specific thing (Boom Pro, Connect Boom, GIPHY, Apple Weather), the Onstage equivalent is named in the same section.
5. Platform rule: **Windows is the primary target today** (an installer ships). macOS must build and run; macOS-only native pieces (virtual camera extension, system audio) are explicitly marked and are the only parts that need a Mac to test.
6. **Packaging rule:** `package.json` › `build.files` whitelists `main.js`, `preload.js`, `vcam.js` and `renderer/**` only. Every new main-process file or folder (`settings.js`, `meetings/`) must be added there, and native binaries (`native/whisper/`) to `extraResources`. Each phase is tested in the built installer (`npm run dist:win`), not only with `npm start`.

---

## 1. What exists in the repository today

| Path | What it is | Notes for new work |
| --- | --- | --- |
| `main.js` (280 lines) | Windows, permissions, `desktopCapturer` sources, recording file writes, video library index, global shortcuts (`Ctrl Alt 1–6 / Z / X / R / T / E / C`), floating remote window, theme | Add new IPC channels here. Keep the pattern: `ipcMain.handle('domain:verb', …)`. |
| `preload.js` | `window.api` bridge: `listSources, selectSource, openScreenSettings, cursor, onCamLive, sendFrame, setTheme, recStart/recChunk/recFinish, reveal, videos.*, toggleRemote, sendState, sendCommand, onState, onCommand, onRemoteOpen` | Extend `window.api`; never enable `nodeIntegration`. |
| `renderer/app.js` (1424 lines) | The studio: state object `S`, compositor that draws background + content + camera + overlays to a 1920×1080 canvas, layouts, Cinematic Zoom, backgrounds, logo, name tag, reactions, GIFs, timer, themes, recorder (MediaRecorder → IPC chunks), library/player/trim/export, device picker | All new stage features are drawn by this compositor. **`S` is not persisted today**: only `theme` and `giphyKey` are in `localStorage`; the logo is an in-memory image. |
| `renderer/index.html` | Studio markup. Rail tabs (`railTabs`), left panel, stage, toolbar, library player, modals (`picker`, `exportModal`) | Element ids are referenced in this doc by name. CSP `connect-src` allows only GIPHY. |
| `renderer/segmenter.js` + `renderer/vendor/mediapipe` | Person segmentation for virtual backgrounds / blur, on device | Reuse for anything that needs a person mask. |
| `renderer/remote.html`, `remote.js` | Floating remote window, opened by hand from the rail: stage preview, layouts, mute, reaction, timer, zoom, screen share | Becomes the in-call panel that opens by itself in a meeting (§B3). |
| `vcam.js`, `native/vcam/` | **Onstage Camera, Windows only**: feeds RGBA frames into the UnityCapture DirectShow driver via shared memory. Call apps list it as a camera. Main sends `vcam:live` when a call app opens the camera. | macOS equivalent is missing: see §B2. |
| `landing/` | Website (static HTML/CSS) | Update after Meetings ships. |
| `build/` | Icons, NSIS script, macOS entitlements | macOS needs more entitlements for Meetings: see §B2/§B4. |

Existing rail tabs (left edge of the studio): **Present, Videos, Camera, Themes, React, Timer, Settings**, with **Remote** at the bottom. Boom's rail is the same shape, which confirms the structure; we add **Meetings** (Part B).

An existing floating toolbar above the stage (`toolbar`, built from `TOOLS` in `app.js`) has: Reactions, Background, Name tag, Cinematic Zoom, Camera shape.

---

## 2. Principles

1. **Nothing leaves the computer** unless the user explicitly turns on a feature that needs the network (weather widget, GIPHY, AI notes). Each such feature is off by default and labelled. Recording, segmentation, transcription are local.
2. **No account required** to use the studio. Meetings AI notes may need a key, entered in Settings.
3. **The stage is the product.** Every overlay (logo, name tag, widgets, stickers) is drawn by the compositor so it appears identically in the recording, in Go live, and in the Onstage Camera.
4. **Live first.** Everything is a switch the user can flip while presenting or in a call; nothing requires post-editing.
5. **Keyboard and remote parity.** Anything in the toolbar has a shortcut and a remote button.
6. **No bot joins the call.** Meetings are captured from the user's own machine (audio + optional video), exactly like Granola. Other participants never see "Onstage Notetaker" in the participant list.
7. **Network calls happen in the main process.** The renderer CSP stays strict (GIPHY only). Weather and LLM requests go through IPC to `main.js`. API keys are stored with `safeStorage` in `userData`, never in `localStorage` (move the GIPHY key there too).

---

# Part A — Studio flow (reference: Boom, adapted to Onstage)

## A1. First run: permissions

![Permissions](images/01-permissions.jpg)

**What the user sees:** a single onboarding window, step 1 of 2 (dots at the bottom). Title "Grant permissions", one row per permission with a state button: `Enable access` → OS prompt → `✓ Access enabled` (green outline).

**Onstage must:**
- Show this window on first launch only (`settings.onboarded === false`), before the studio.
- **macOS:** rows **Camera**, **Microphone**, **Screen recording**. Camera and microphone call `systemPreferences.askForMediaAccess`; Screen recording opens System Settings (`system:openScreenSettings` already exists) and re-checks when the window regains focus. Remove the unconditional `askForMediaAccess` loop at startup in `main.js` when this lands.
- **Windows:** there is no prompt (the app's permission handler grants `media`). Skip step 1 entirely unless `systemPreferences.getMediaAccessStatus('camera' | 'microphone')` is `denied`; in that case show the row with a button that opens Windows Settings › Privacy › Camera/Microphone.
- Rows reflect the real status from `getMediaAccessStatus`.
- "Continue" is enabled when camera is granted (microphone optional, warn).

**Code:** new `renderer/onboarding.html` + `onboarding.js`, opened by `main.js` instead of `index.html` when not onboarded; store `onboarded` in `userData/settings.json` (create a small `settings.js` helper in main: `get(key, default)`, `set(key, value)`).

**Accept:** fresh install on macOS shows the window; granting permissions updates the row without restart; relaunch skips it. Fresh install on Windows goes straight to step 2.

## A2. Name and logo

![Name and logo](images/02-name-and-logo.jpg)

**What the user sees:** step 2 of 2. Left: a style dropdown ("Classic"), **Name**, **Role or company**, a drag-and-drop **Logo / Image** box ("Minimum 200 × 200"), primary button **Let's go**. Right: live camera preview with a camera picker at the top right and a friendly tip bubble.

**Onstage must:**
- Live preview from the selected camera (reuse `camSelect` logic from `app.js`; this screen can share `shared.js`).
- Name tag style dropdown: **Classic**, **Pill**, **Lower third**, **Minimal** (the same presets the studio's name tag editor offers, §A6).
- Name + role fill the name tag; logo drops into the logo overlay. Both are optional; "Let's go" always proceeds.
- Saves through the persistence added in Phase 1 (§A7): the name tag and logo overlays in the saved stage state, logo file copied to `userData/brand/logo.png`.

**Accept:** values entered here appear on the stage the first time the studio opens.

## A3. Welcome / tutorial

Deferred until a tutorial video exists (Part D).

## A4. The studio

![Studio](images/04-studio-logo-dropdown.jpg)

**Regions (left to right, top to bottom):**

1. **Rail** (`railTabs`): Present, Videos, Camera, Themes, React, Timer, **Meetings (new)**, Settings; Remote at the bottom.
2. **Panel** (`panelTitle` + contents): for Present: Camera and microphone pickers, Screen (`shareBtn`, `sourceName`), Layout grid (6 tiles, `layouts`), Cinematic Zoom toggle with its shortcut chip (`^⌘Z` on Mac, `Ctrl Alt Z` on Windows).
3. **Top bar:** right: **Go live** (secondary) and **New recording** (primary, red dot).
4. **Stage toolbar** (floating pill above the stage, `toolbar`): overlay dropdowns **Logo**, **Background**, **Name tag**, **Info widgets**, **Stickers**, then a divider, then the existing live-use buttons **Reactions** and **Cinematic Zoom**. The existing **Camera shape** button moves out (it is already in the Camera tab). A small coloured dot on a button means that overlay is currently on.
5. **Stage** (`stage` canvas): 16:9, rounded corners, shows exactly what the recording/camera outputs.

**Onstage must:** keep the existing structure and extend the existing toolbar. Backgrounds/logo/name tag stay in the panel tabs too; the toolbar is the fast path. Each toolbar dropdown is a popover anchored below its button; `Esc` closes (already the case).

## A5. Stage toolbar dropdowns

### A5.1 Logo

(Shown open in the screenshot above.) A drop zone "Drag and drop to upload a logo or image, minimum 200 × 200". After upload, the logo appears on the stage as a draggable overlay (§A7). The popover then shows the thumbnail, **Replace**, **Remove**, and a size slider.

Code: reuse `logoInput` / `logoClear`; the overlay becomes an entry in a new `S.overlays[]` array (§A7).

### A5.2 Background

![Background picker](images/05-background-picker.jpg)

Tabs **Wallpaper / Colour / Upload**.

**Onstage must:**
- Wallpaper: 24 gradients/abstracts generated in code (extend the existing `GRADIENTS`). No third-party wallpapers. Photographic rooms are deferred (Part D).
- Colour tab: the colour picker component from §A6 (swatches, SV box, hue, alpha, hex).
- Upload tab: image.
- This popover sets the **stage background** (`S.bg`) only. The camera's **virtual background** (`S.fx`) stays a separate control in the Camera tab; the two are independent, as today.

### A5.3 Name tag

![Name tag menu](images/06-nametag-menu.jpg)

Menu with checkable items: **Headline** (name), **Subheadline** (role), **Background** (the card fill). Editing the text happens in place on the stage (double-click the tag opens a DOM input positioned over it) or in the panel.

### A5.4 Info widgets

![Info widgets](images/07-info-widgets-menu.jpg)

**Location**, **Weather**, **Time**, **Background** (card fill on/off). Onstage uses the OS locale/timezone for time, a user-typed city in Settings for location (no geolocation prompt), and **Open-Meteo** (free, no key) for weather.

Weather is a network feature (§2.1): off by default, and turning it on shows "Sends your city to open-meteo.com". It needs two calls from the main process: Open-Meteo geocoding (city → coordinates, cached in settings) and the forecast (refresh every 30 min). Each widget is an overlay (§A7) rendered by the compositor with the name-tag style.

### A5.5 Stickers

![Stickers](images/08-stickers.jpg)

Search box, grid of animated stickers, "Powered by GIPHY". Onstage already has a GIF feature with a user-entered GIPHY key (`giphyKey`, `gifSearch`, `gifResults`). **Onstage must:** move it into this toolbar dropdown, use the GIPHY **Stickers** endpoint (transparent) in addition to GIFs, keep the key in Settings, and show an "Add your GIPHY key in Settings" state when absent.

**Behaviour change:** today a GIF pops in for 5 seconds and disappears. In v2 a clicked sticker becomes a persistent, looping overlay (§A7) until removed. The image blob is cached in `userData/stickers/<id>` so a saved sticker never refetches from GIPHY on launch.

## A6. Name tag editor

Selecting the name tag on the stage shows a second floating toolbar for that object:

| Control | Screenshot | Behaviour |
| --- | --- | --- |
| Fill colour | ![Fill](images/15-nametag-fill-color.jpg) | Colour picker: 10 preset swatches, saturation/value box, hue bar, alpha bar, hex field, opacity %. Applies live. |
| Border thickness | ![Border](images/16-nametag-border-thickness.jpg) | Slider 0–12 px. |
| Border colour | (ring icon) | Same colour picker. |
| Corner radius / shape | (corner icon) | Slider 0–40 px, plus presets Square, Rounded, Pill. |
| Text alignment | ![Align](images/17-nametag-alignment.jpg) | Left / Centre / Right, applies to both lines. |
| Hide background | ![Hide](images/18-nametag-hide-background.jpg) | Eye toggle: text only, no card. Other controls dim when hidden. |

Also: font picker (Poppins, DM Sans, Manrope, plus a serif such as Source Serif), text colour, and the four style presets from §A2. All settings persist per overlay in `S.overlays[i].style`.

**Fonts:** only `manrope.woff2` is bundled today and the compositor draws with `system-ui`. Poppins, DM Sans and the serif must be added to `renderer/vendor/fonts/` as woff2 (the CSP blocks remote fonts) and loaded with `document.fonts.load()` before the first frame that uses them.

**Code:** one reusable `ColourPicker` component (`renderer/ui/colour-picker.js`) used by name tag, border, background colour and stage border.

## A7. Overlays on the stage (logo, name tag, widgets, stickers)

![Selected logo](images/12-logo-overlay-selected.jpg)
![Moved to top right](images/13-logo-moved-top-right.jpg)
![Name tag moved](images/14-nametag-moved.jpg)

**Behaviour:**
- Click selects (outline in brand lime `#c5f08e`, four corner handles, a trash button under it). Drag moves; corner handles scale proportionally; `Delete`/`Backspace` removes; `Esc` deselects. Arrow keys nudge 1 px (10 with Shift).
- Snapping to stage edges and centre lines (8 px threshold) with a brief guide line.
- Overlays keep their position as a fraction of the stage (`x, y, w` in 0–1) so they survive layout and resolution changes.
- Selection brings to front.
- Overlays render in the recording, Go live window and Onstage Camera, never the selection chrome.

**Selection chrome is DOM, not canvas.** The stage canvas is the output (recording, Go live and camera all read it), so the outline, handles, trash button and snap guides are absolutely positioned elements in a layer above the canvas, never drawn by the compositor.

**Pointer order on the stage** (the canvas already handles camera-bubble drag and click-to-zoom): overlays (topmost first) → camera bubble → click-to-zoom on content.

**Name tag placement:** the current auto-dodge (the tag jumps right when the camera bubble is parked bottom-left) is removed; the tag stays where the user puts it.

**Data model** (in `S`):

```js
S.overlays = [
  { id, type: 'logo'|'tag'|'widget'|'sticker', x, y, w,
    visible: true, style: { fill, fillAlpha, border, borderColor, radius, align, font, textColor, hideBg },
    data: { src | name, title | kind: 'time'|'weather'|'location' | file } }
]
```

Existing logo and name tag code paths (`S.logo`, `S.tag`, `drawOverlays`) are replaced by this array. Caption, timer, reactions and confetti stay as they are.

**Persistence (new work; nothing is saved today, so there is nothing to migrate).** Save `S.overlays`, `S.bg`, `S.padding`, `S.radius` to `userData/stage.json` through a `stage:load` / `stage:save` IPC pair, debounced on change. Images (logo, uploaded background, stickers) are copied into `userData/brand/` and `userData/stickers/` and referenced by file name.

## A8. Screen picker

![Screen picker](images/19-screen-picker.jpg)

Body: **Displays** (thumbnail + name), a divider, then **Windows** (thumbnail + app icon + title). Footer: **Cancel**, **Select screen**.

**Onstage must:**
- Extend the existing `picker` modal: split `desktopCapturer` sources into Displays and Windows (the `kind` field already exists). Request `fetchWindowIcons: true` and show `appIcon` next to each window title.
- Single-select with a highlight; double-click selects immediately.

Per-app tabs, grouping by app, the Mobile device tab and "remember last choice" are deferred (Part D).

## A9. Screen recording permission (macOS)

![Screen recording permission](images/10-screen-recording-permission.jpg)

Shown when the picker is opened and `getMediaAccessStatus('screen') !== 'granted'`. Modal "Set up screen sharing" with a card: "Access screen recording — Onstage uses screen recording to overlay your camera with your screen content", **Ask for access** → `openScreenSettings`. Poll status every 2 s while the modal is open. When it turns `granted`, replace the card with "Restart Onstage to finish" and a **Restart** button (`app.relaunch()`): macOS normally needs a relaunch before a new screen-recording grant takes effect. Already partly exists in `pickerNote`; promote it to this modal.

## A10. Stage border

![Stage border](images/20-stage-border.jpg)

Toggle **Border** in the Background popover's header. When on, the stage gets a frame filled with the chosen background; the camera/content sits inside with rounded corners. This is the existing Themes **Padding** slider (`S.padding`, default 0.05): the toggle switches between 0 and the last non-zero value. The border is part of the composite.

## A11. Pricing and account

![Boom Pro](images/09-pro-pricing-reference.jpg)

Boom gates live presenting behind Pro. **Onstage decision for v2: everything is free; there is no Pro modal, no "Get Pro" pill and no "Connect" button.** No paywall flag is added now. If pricing is introduced, prefer a one-time licence (see landing page copy "Pay once. Keep it.").

## A12. Updates

![Update prompt](images/11-auto-update-prompt.jpg)

Use `electron-updater` with GitHub Releases. On second launch ask once: "Check for updates automatically?" with **Don't check / Check automatically** and a checkbox "Automatically download and install updates". Store in settings; manual "Check for updates" in Settings.

**Prerequisites (none exist today):**
- A `publish` block in `package.json` › `build` pointing at the GitHub repository (`abhinavakhil/onstage`, public, so `electron-updater` can read its Releases without a token). If the repo is ever made private, releases must move to a separate public repository.
- Windows: the installer is `nsis.perMachine: true`, so every update shows a UAC prompt. Either accept that or switch to per-user install.
- macOS: auto-update needs a `zip` target next to `dmg`, plus Developer ID signing and notarization.

## A13. Everything else that already exists and must keep working

Layouts (6), Cinematic Zoom following the cursor (`cursor:pos`), reactions and confetti, on-stage timer, caption, themes, device frames, video library with trim and export (1080p/720p/480p), floating remote, global shortcuts, Go live window, Onstage Camera on Windows, PDF/image slides. Any refactor in Part A must keep `npm start` working on Windows with these features unchanged.

---

# Part B — Meetings (Onstage inside Google Meet, Granola-style notes)

## B1. What the user gets

1. **The stage shows up in the call.** In Google Meet / Zoom / Teams the user picks **Onstage Camera** as their camera and the other participants see the composed stage (layout, background, name tag, logo, reactions). Works today on Windows; §B2 adds macOS.
2. **Onstage shows up in the meeting by itself.** When a call starts, Onstage's panel appears on top of the call: start notes, switch layouts, mute, react, jot a note. The user does not open the Onstage app (§B3).
3. **It records from the user's machine, not as a bot.** Microphone (you) + system audio (everyone else). Optionally the stage video too.
4. **Live transcript** with "You" vs "Others" separation, and a notes pad where the user types a few bullets during the call.
5. **When the call ends**, Onstage produces a meeting page: title, the user's raw notes turned into structured notes by an LLM (summary, decisions, action items, questions), the full transcript, and the recording if enabled. Export as Markdown, copy to clipboard, or save next to the video.

Granola's key insight, which we copy: the user's own quick notes are the skeleton; the transcript fills them in. We do not generate notes from the transcript alone unless the user wrote nothing.

## B2. Onstage Camera on macOS (virtual camera)

**Status:** Windows works via `vcam.js` + UnityCapture. macOS has nothing.

**Required:** a **CoreMediaIO Camera Extension** (system extension, Swift, macOS 12.3+). This is the only Apple-approved way to appear as a camera in Meet (Chrome), Zoom and Teams on current macOS; DAL plug-ins are deprecated and blocked by most apps.

**Implementation:**
- New target `native/vcam-mac/`: an Xcode project with a small host app (`OnstageCameraHost.app`) that **contains** the extension at `OnstageCameraHost.app/Contents/Library/SystemExtensions/OnstageCamera.systemextension`. The extension must live inside the app that submits the activation request. The host app is bundled inside `Onstage.app` (e.g. `Contents/Resources/`), and Onstage must be running from `/Applications` for activation to succeed.
- The extension exposes one 1920×1080 30 fps device named **"Onstage Camera"** with a source stream (what call apps read) and a **sink stream** (what we write to).
- Frame transport: camera extensions are sandboxed, so raw POSIX shared memory or Mach ports are not directly usable. The host app (or a small helper it ships) receives RGBA frames from the Electron main process over a local socket/pipe and pushes them into the extension's sink stream through the CoreMediaIO client API (the approach OBS uses).
- Frame orientation: on Windows the renderer flips the feed bottom-up for UnityCapture (`feedCtx.setTransform` in `app.js`). Make that flip conditional on `api.platform === 'win32'`; macOS gets top-down frames.
- Install flow: first time the user clicks **Enable Onstage Camera** in Settings, the app launches the host, which calls `OSSystemExtensionRequest.activationRequest`; macOS shows the approval in System Settings › Privacy & Security. Show a guide modal in the style of §A9.
- Entitlement `com.apple.developer.system-extension.install` plus a provisioning profile; Developer ID signing + notarization to run on other Macs (Apple Developer Program, USD 99/yr).
- `vcam.js` becomes a platform switch: `win32` → UnityCapture path (unchanged); `darwin` → send to the host helper. `vcam:live` on macOS comes from the helper reporting whether the source stream has a client.

**Accept:** in Chrome on macOS, open meet.google.com, choose "Onstage Camera", see the stage; switching layouts in Onstage updates the call within one frame.

## B3. In-call panel and meeting detection

**The rule:** when the user joins a call in Google Meet, Zoom or Teams, Onstage's controls appear on top of the call by themselves. The user never has to switch to, or even open, the Onstage studio window. This is how Granola behaves.

**What it is, precisely:** a small always-on-top Onstage window floating over the call. It is not drawn inside the Meet/Zoom/Teams interface (that would need a browser extension per browser plus a plug-in per desktop app; Granola does not do that either). To the user it reads as "the options are right there in the meeting".

### B3.1 Onstage runs in the background

For the panel to appear without opening the app, Onstage must already be running:

- **Tray icon** (`Tray` in `main.js`) with: Open studio, Start meeting notes, Show panel, Quit.
- **Closing the studio window hides it** instead of quitting. The studio window must stay alive while hidden: the compositor that feeds Onstage Camera, the recorder and the audio capture all live in that renderer (`backgroundThrottling: false` and the `setInterval` draw loop are already there for this reason). Quit only from the tray or `Ctrl Q`.
- **Start with the computer** (`app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })`), on by default, asked once in onboarding, switchable in Settings. Launched this way, the studio window is created hidden.
- The camera is opened only while something needs it (studio visible, Onstage Camera live, or recording), so the webcam light is not on all day. Today `startCamera()` runs unconditionally at startup; that changes.

### B3.2 The panel

One window (`renderer/remote.html`, which already has stage preview, layouts, mute, reaction, timer, zoom and screen share) with three states:

1. **Prompt** (on detection): "Google Meet call detected" with **Start notes** and **Not now**. If the call is not using Onstage Camera yet, a second line: "Pick *Onstage Camera* in the call's camera menu to show your stage." Collapses to the pill after 10 s without input.
2. **Pill** (collapsed, ~56 px): Onstage mark; while recording, a red dot and elapsed time. Click or hover expands. Drag to move; position is remembered.
3. **Expanded**: everything the user needs during the call, nothing that needs the studio:
   - stage preview, the six layouts, mute, Cinematic Zoom, reactions, timer, share screen (existing remote controls);
   - **Start notes / Stop** with elapsed time and REC state;
   - **Jot** field for one-line notes (appends to the notes pad, §B6);
   - the last two lines of the live transcript;
   - **Open Onstage** (shows the studio) and ⚙ (Settings › Meetings).

Placement: right edge, vertically centred, on the display that holds the meeting window (`screen.getDisplayMatching` on the window bounds when known, otherwise the display under the cursor). It never takes focus when it appears (`showInactive()`), so it does not steal typing from the call. It is excluded from Onstage's own screen capture (source names starting with "Onstage" are already filtered in `sources:list`).

When the call ends (both signals false for 15 s) recording stops, the panel shows "Notes saved · Open" for 10 s, then hides.

### B3.3 Detection

Two signals; either one shows the panel. Both together auto-start notes if the user enabled "Auto-record meetings" in Settings.

1. **Camera opened:** `vcam:live` turns true, i.e. a call app has opened Onstage Camera. This already exists in `main.js` and is the most reliable signal.
2. **Window title:** every 5 s list windows via `desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })` and look for titles matching `Meet - `, `Google Meet`, `Zoom Meeting`, `Microsoft Teams` + "Meeting". Known limit: a Meet tab only shows in the title while it is the active tab of its browser window.

Onstage does **not** listen to system audio in the background to detect meetings. Audio capture starts only when the user presses Record (or auto-record fires).

**Not now** snoozes the prompt until both signals have gone false; the pill stays available.

**Accept:** with the studio window closed (Onstage in the tray), join a Meet call in Chrome: the prompt appears over the call within 10 s without the studio opening; layouts can be switched, notes started, a line jotted and notes stopped entirely from the panel; the call keeps keyboard focus when the panel appears.

## B4. Capture

- **Microphone:** existing `micSelect` stream.
- **System audio (the other participants):**
  - Windows: `getDisplayMedia({ video: true, audio: true })`. The existing `setDisplayMediaRequestHandler` only attaches `audio: 'loopback'` alongside a video source, so the request must include video; the handler returns the first screen and the renderer stops and discards the video track immediately. Loopback captures all system output, including sounds Onstage itself plays: do not play library videos while a meeting records.
  - macOS: the installed Electron (33.4) documents `audio: 'loopback'` as Windows-only, so today this needs a **ScreenCaptureKit** Swift helper in `native/sckit-audio/` (launched by main, streams 48 kHz PCM over stdout; macOS 13+). Before writing it, check whether a newer Electron supports macOS loopback and upgrade instead if so. Either way it needs Screen Recording permission (§A9).
- **Two tracks, kept separate** for speaker labels: `mic.webm` and `system.webm` (Opus) for playback. No mixed file: the meeting page plays both tracks in sync.
- **PCM for transcription:** an `AudioWorklet` on each track downsamples to 16 kHz mono and sends Float32 chunks to main. whisper.cpp cannot read WebM/Opus and the project has no ffmpeg, so transcription uses this PCM, not the `.webm` files.
- **IPC:** new channels `meeting:start(id)`, `meeting:chunk(id, track, buffer)`, `meeting:pcm(id, track, buffer)`, `meeting:stop(id)` that append into the meeting folder. Do **not** reuse `rec:*`: it holds a single global stream and `rec:start` destroys one in progress, so a meeting and a normal recording would kill each other.
- **Video (optional, default off):** the stage composite, as a normal recording through `rec:*`, so the meeting also lands in the Videos library.
- Files: `userData/meetings/<id>/{mic.webm, system.webm, transcript.json, notes.md, meta.json}`.

**Known limits, stated in the UI:**
- **Speaker bleed.** Without headphones the microphone picks up the other participants from the speakers; Chromium's echo cancellation does not cancel audio played by another app. Mitigation: after transcription, drop a `you` segment when it overlaps a `others` segment in time and its text is mostly the same words. Show "Use headphones for the best transcript" on first recording.
- **Muting in the call app does not mute Onstage.** If the user mutes in Meet and speaks, Onstage still records and transcribes it under "You". The pill's mute indicator follows Onstage's own mute (`Ctrl Alt X`), which does stop the mic track.

## B5. Transcription

- **Local only in v2:** `whisper.cpp` via a prebuilt CLI binary per platform in `native/whisper/` (added to `extraResources`). Model: multilingual **`base`** (~140 MB), **downloaded on first use** to `userData/models/` with a progress bar; `small` downloadable from Settings. (`base.en` is English-only; use it only if every call is English.)
- Run on 20-second windows of each track's PCM for a live transcript; re-run the full audio at the end for a clean transcript.
- **Silence gate:** skip a window whose RMS is below a threshold. Whisper invents text on silence ("Thanks for watching").
- **Speaker labels:** everything from the mic track is **You**; everything from the system track is **Others**, after the bleed filter in §B4.
- Format: `transcript.json` = `[{ t0, t1, speaker: 'you'|'others', text }]`; render in the meeting page with timestamps that seek the recording. MediaRecorder WebM files carry no duration; reuse the seek-far-ahead workaround the video player already uses in `app.js`.

## B6. Notes

- **During the call:** Meetings tab shows the live transcript (left) and a notes pad (right, plain text/markdown). Shortcut `Ctrl Alt N` focuses the pad from any app; the pill has a "Jot" field for one-line notes.
- **After the call:** "Enhance notes" sends `{ user_notes, transcript, title, template }` to an LLM and receives structured notes. Providers: Anthropic (Claude), OpenAI, or a local Ollama endpoint; key in Settings (`safeStorage`), request made from the main process. If no provider is configured, show the raw notes + transcript and a one-line hint. Never send anything without an explicit click the first time (then a per-provider "always enhance" toggle).
- **Templates** (`renderer/meetings/templates/*.md`): General, 1:1, Customer call, Standup, Interview. A template is a system prompt + section headings.
- Output `notes.md` with sections: Summary, Key points, Decisions, Action items (`- [ ] owner: task`), Questions, plus the user's original notes preserved in a collapsed "Your notes" section.

## B7. Meeting page and library

Meetings tab in the rail → list (search, date groups) → meeting page:

- Header: title (editable), date/time, duration, source badge (Meet/Zoom/Teams/Manual).
- Tabs: **Notes** (rendered markdown, editable), **Transcript** (speaker-coloured, click to seek), **Recording** (if video), **Share**.
- Share: Copy as Markdown, Copy summary, Save `.md`, Export recording (reuses `exportModal`).
- Delete removes the folder.

The Meetings UI is its own script (`renderer/meetings/meetings.js`), not more code in `app.js`.

## B8. Settings › Meetings

Start Onstage with the computer (on) · Show the in-call panel when a meeting is detected (on) · Auto-record meetings (off) · Record video of the stage (off) · Transcription model: base / small · Notes AI: None / Anthropic / OpenAI / Ollama + key · Default template · Delete all meeting data.

## B9. Privacy and consent

- First recording shows a one-time notice: "You are responsible for telling participants that you record. Some regions require consent." with **I understand**.
- A clear **REC** state in the pill and the studio; the Onstage Camera feed can optionally show a small "Recording" badge (toggle in Settings, default on).
- No audio or transcript is uploaded. Enhance notes sends the transcript and notes text to the chosen provider; the Settings screen lists exactly what is sent.

---

# Part C — Implementation plan

Work top to bottom. Each phase ends with `npm start` working on Windows, the built installer working (`build.files` / `extraResources` updated), and the acceptance checks passing.

### Phase 1 — Overlay system and toolbar (Part A core)
Files: `renderer/app.js` (compositor, `S.overlays`), `renderer/index.html` (toolbar popovers, DOM selection layer), new `renderer/ui/colour-picker.js`, `main.js` + `preload.js` (`stage:load` / `stage:save`, image copies).
1. Introduce `S.overlays[]`, replace `S.logo` / `S.tag` with it; draw via one `drawOverlay()` in the compositor.
2. Persistence of stage state and images (§A7). New work, no migration.
3. DOM selection layer: select, drag, scale, delete, nudge, snap to edges/centre; pointer order against camera drag and click-to-zoom.
4. Toolbar: Logo, Background (wallpaper/colour/upload + Border toggle), Name tag menu, Info widgets, Stickers (move existing GIF code, persistent overlays); keep Reactions and Cinematic Zoom.
5. Name tag editor toolbar (§A6) with the shared colour picker; bundle fonts.
Accept: all §A5–A7, A10 behaviours; overlays appear in a recording, in Go live and in Onstage Camera without selection chrome; stage state survives a restart.

### Phase 2 — In-call panel, meeting capture and transcript (Windows)
Files: `main.js` (tray, hide-on-close, login item, detection), `renderer/remote.html/.js` (panel states), new `meetings/` folder in main process (`detect.js`, `capture.js`, `transcribe.js`, `store.js`), `renderer/meetings/` (tab UI), `native/whisper/`.
1. Background running: tray, hide instead of quit, start with the computer, camera only when needed (§B3.1).
2. Detection from `vcam:live` + window title; panel with prompt / pill / expanded states and the existing remote controls (§B3.2–B3.3).
3. Store + Meetings tab; **Start notes** from the panel, the tray and the tab.
4. Two-track capture (mic + loopback) through `meeting:*`, plus 16 kHz PCM taps.
5. Model download; final-pass transcript on stop, with silence gate and bleed filter.
6. Notes pad, Jot field in the panel, meeting page with Notes/Transcript tabs, Markdown export.
Accept: §B3 acceptance (whole flow from the panel with the studio closed); a 10-minute Meet call in Chrome produces a transcript with You/Others labels and a saved meeting; nothing is uploaded (verify with the network disconnected after the model is downloaded); a normal recording can run at the same time; Onstage Camera keeps delivering frames while the studio window is hidden.

### Phase 3 — Onboarding, picker, updates
Files: new `renderer/onboarding.html/.js`, `settings.js`, `main.js` (update check), `renderer/index.html` (picker groups, screen-permission modal).
1. Permissions + Name/logo (§A1–A2).
2. Screen picker Displays/Windows with app icons (§A8), macOS permission modal (§A9).
3. `electron-updater` prompt (§A12), after its prerequisites are in place.
Accept: fresh install flow end to end on Windows; macOS permission modal shows and offers Restart when granted.

### Phase 4 — Live transcript and AI notes
1. Live transcript on 20 s windows, shown in the Meetings tab and (last two lines) in the panel; `Ctrl Alt N`.
2. Auto-record meetings setting (§B3.3).
3. Enhance notes via Anthropic/OpenAI/Ollama with templates (§B6); consent notice (§B9).
Accept: transcript lines appear in the panel during a call; enhanced notes contain the user's bullets expanded with transcript detail; with Notes AI set to None the app makes no network calls.

### Phase 5 — macOS parity (needs a Mac + Apple Developer account)
1. System audio on macOS: ScreenCaptureKit helper, or an Electron upgrade if a newer version supports macOS loopback (§B4).
2. CoreMediaIO camera extension (§B2), signing + notarization, `dist:mac`.
Accept: §B2 acceptance in Chrome and Zoom on macOS 13+.

### Phase 6 — Landing page and docs
Update `landing/` with Meetings; add `docs/images/` screenshots of Onstage (replace the Boom references in this file with our own).

---

# Part D — Deferred (not in v2)

Each item was in an earlier draft and is cut until there is a concrete need.

| Item | Why deferred |
| --- | --- |
| `features.paid` flag | Nothing to gate; add it with the first paid feature. |
| `rotation` on overlays | No UI rotates anything. |
| Snap to other overlays; Bring forward / Send back menu | Edge and centre snap plus bring-to-front on select cover the common case. |
| Photographic room wallpapers (12, licensed) | Content sourcing and licence tracking; gradients + upload ship first. |
| Video backgrounds (MP4/WebM loop) | Compositor draws image backgrounds only today. |
| "Use my IP location" | Needs a third-party lookup service; typed city is enough. |
| A3 Welcome / tutorial modal | No tutorial video exists yet. Needs a `shell.openExternal` IPC with a URL allowlist when added. |
| Help button in the rail | No destination defined. |
| Picker: per-app tabs, grouping windows by app | Electron does not expose a window's owning process; title heuristics are unreliable. |
| Picker: Mobile device tab | A plugged-in iPhone appears to Chromium as its camera, not its screen. Screen capture needs a native CoreMediaIO helper. |
| Picker: remember last choice | Source ids are not stable across launches. |
| `mix.webm` | Derivable; the page plays both tracks. |
| Detection by process name | No Electron API to list processes. |
| Detection by background audio | Means listening to system audio all the time. |
| Google Calendar (event title, attendees) | `calendar.events.readonly` is a sensitive scope: needs a Google Cloud project and Google verification, or users see an "unverified app" warning. |
| Cloud transcription (OpenAI Whisper API, Deepgram) | Local whisper is the default and is enough to ship. |
| Separate "Others" speakers (diarization) | Too heavy to run locally. |
| User-authored note templates | Five built-ins first. |
| Meetings storage location setting | `userData/meetings` is fine until someone asks. |
| "Send to…" Notion/Slack | Out of scope. |

## Open decisions (choose when reached; defaults in bold)

- Whisper model: **multilingual `base`, downloaded on first use** vs `base.en`.
- Windows installer: **keep per-machine (UAC on each update)** vs per-user.
- Muted in the call app but speaking: **accept and document** vs try to gate "You".

## Glossary

- **Stage:** the 1920×1080 composite the user sees and everyone else receives.
- **Overlay:** any object drawn on top of the stage (logo, name tag, widget, sticker).
- **Onstage Camera:** the virtual camera device that carries the stage into call apps.
- **Meeting:** a captured call with audio tracks, transcript and notes.
- **In-call panel:** the always-on-top Onstage window that appears over a call by itself (§B3).
- **Pill:** the collapsed state of the in-call panel.
