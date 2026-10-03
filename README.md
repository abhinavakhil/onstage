<p align="center">
  <img src=".github/banner.svg" alt="Onstage: screen recordings that come out finished" width="100%">
</p>

<p align="center">
  <a href="https://abhinavakhil.github.io/onstage/"><b>Website</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/abhinavakhil/onstage/releases/latest/download/Onstage-Setup.exe"><b>Download for Windows</b></a>
</p>

Onstage puts your camera, your screen and your brand on one stage. Switch layouts and zoom in while
you talk, then stop recording and share the file. There is nothing to edit afterwards.

<p align="center">
  <img src="landing/assets/app-present.png" alt="The Onstage studio" width="88%">
</p>

## What it does

- **Six layouts** you can switch mid-sentence: camera, screen, side by side, split, picture in picture, camera-off screen
- **Cinematic Zoom** that follows your mouse on a shared screen
- **Virtual backgrounds**, skin smoothing and studio light, all processed on your computer
- **Your brand**: backgrounds, logo, name tag, device frames
- **Reactions, GIFs and an on-stage timer**
- **Go live**: a clean window of your stage to share in Zoom, Meet or Teams
- **Video library** with trim and export at 1080p, 720p or 480p
- **Floating remote** and global shortcuts (`Ctrl` `Alt` `1–6`, `Z`, `X`, `R`)

## Install

Download [Onstage-Setup.exe](https://github.com/abhinavakhil/onstage/releases/latest/download/Onstage-Setup.exe)
and run it. The installer is not code-signed yet, so Windows shows a "Windows protected your PC" notice:
choose **More info**, then **Run anyway**.

## Run from source

Needs [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm start
```

Build the installer with `npm run dist:win` (or `npm run dist:mac` on a Mac). It lands in `dist/`.

## Not in this version

- Onstage does not appear in the camera list of call apps; share the **Onstage Live** window instead
- No direct iPhone or iPad capture, and no Stream Deck plugin (the shortcuts work with its Hotkey action)
- macOS builds are untested

## Project layout

| Path | What it is |
| --- | --- |
| `main.js`, `preload.js` | Windows, permissions, screen sources, video library, global shortcuts |
| `renderer/` | The studio UI, the compositor and recorder (`app.js`), the floating remote |
| `renderer/vendor/` | pdf.js, the MediaPipe person-segmentation model, the Manrope font |
| `landing/` | The website |
