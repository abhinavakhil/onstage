/* Onstage studio: composites background + shared content + camera + overlays onto one
   1920x1080 canvas, and records that canvas together with microphone audio. */
(() => {
  'use strict';

  const api = window.api || null;          // absent when the page is opened in a plain browser
  const $ = (id) => document.getElementById(id);
  const W = 1920, H = 1080, FPS = 30;

  const canvas = $('stage');
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------- state
  const GRADIENTS = [
    ['#f3efe6', '#cfe8d8', '#e9dcc3'], ['#3b6cff', '#ff9ec7', '#5b4ff5'], ['#ff5f6d', '#ffc371', '#ff8a5c'],
    ['#fde68a', '#a7f3d0', '#93c5fd'], ['#06b6d4', '#3b82f6', '#1e1b4b'], ['#3a1c71', '#d76d77', '#ffaf7b'],
    ['#10b981', '#0e7490', '#134e4a'], ['#1e293b', '#0f172a', '#020617'],
  ];
  const SHAPES = [{ id: 'rounded', name: 'Square' }, { id: 'circle', name: 'Circle' }, { id: 'wide', name: 'Wide' }];
  const EMOJI = ['👍', '👏', '🎉', '❤️', '😂', '🔥', '💡', '🙌', '🤯', '👀', '✅', '🚀'];
  const TABS = [
    { id: 'present', name: 'Present' }, { id: 'videos', name: 'Videos' }, { id: 'camera', name: 'Camera' },
    { id: 'themes', name: 'Themes' }, { id: 'react', name: 'React' }, { id: 'timer', name: 'Timer' },
    { id: 'settings', name: 'Settings', sep: true },
  ];
  const ZOOM = 2;                   // Cinematic Zoom magnification

  const S = {
    layout: 'side',
    shape: 'rounded',
    camSize: 0.26,                  // fraction of stage height
    camPos: { x: 0.13, y: 0.8 },    // centre of the movable element, normalised
    mirror: true,
    cam: { zoom: 1, panX: 0, panY: 0, exposure: 0, temp: 0, tint: 0, sat: 0 },
    fx: { bg: 'none', image: null, gradient: 0, smooth: false, light: false },   // camera effects that need the person mask
    frame: 'none',                  // device frame around the shared content: none | phone | tablet | browser
    stickers: [],                   // [{ gif, t0 }]
    bg: { type: 'gradient', index: 0, color: '#1f2937', image: null },
    padding: 0.05,
    radius: 24,
    logo: null,
    content: 'none',                // 'none' | 'screen' | 'slides'
    sourceName: '',
    displayId: null,                // set when a whole screen is shared, so zoom can follow the mouse
    slides: [],                     // [{ canvas, thumb }]
    slideIdx: 0,
    tag: { on: false, name: '', title: '' },
    caption: '',
    reactions: [],                  // [{ emoji, x, t0 }]
    confetti: [],                   // [{ x, y, vx, vy, color, spin }]
    zoom: { on: true, active: false, k: 1, x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 },
    timer: { total: 300000, left: 300000, running: false, doneAt: 0 },
    muted: false,
    countdown: true,
    movable: null,                  // rect of the draggable element in the last frame
    contentRect: null,              // where the shared content was drawn in the last frame
  };

  const camVideo = document.createElement('video');
  const screenVideo = document.createElement('video');
  for (const v of [camVideo, screenVideo]) { v.muted = true; v.playsInline = true; v.autoplay = true; }

  let camStream = null, micStream = null, screenStream = null;

  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------- drawing helpers
  const inset = (r, p) => ({ x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p });
  const fit = (r, aspect) => {
    let w = r.w, h = w / aspect;
    if (h > r.h) { h = r.h; w = h * aspect; }
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
  };
  const pathRound = (r, radius) => {
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
  };
  const shadowed = (r, radius, fill) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = fill;
    pathRound(r, radius);
    ctx.fill();
    ctx.restore();
  };
  // Draw `src` (sw x sh) so it covers rect r. zoom > 1 crops tighter; pan (-1..1) slides the crop.
  const drawCover = (src, sw, sh, r, mirror, zoom = 1, panX = 0, panY = 0) => {
    const scale = Math.max(r.w / sw, r.h / sh) * zoom;
    const cw = r.w / scale, ch = r.h / scale;
    const sx = (sw - cw) / 2 * (1 + (mirror ? -panX : panX)), sy = (sh - ch) / 2 * (1 + panY);
    if (mirror) {
      ctx.save();
      ctx.translate(r.x + r.w, r.y);
      ctx.scale(-1, 1);
      ctx.drawImage(src, sx, sy, cw, ch, 0, 0, r.w, r.h);
      ctx.restore();
    } else {
      ctx.drawImage(src, sx, sy, cw, ch, r.x, r.y, r.w, r.h);
    }
  };
  const wash = (r, color, amount, mode) => {
    if (!amount) return;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = Math.min(1, amount);
    ctx.fillStyle = color;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  };

  const camReady = () => camStream && camVideo.videoWidth > 0;
  const contentSource = () => {
    if (S.content === 'screen' && screenVideo.videoWidth > 0) {
      return { el: screenVideo, w: screenVideo.videoWidth, h: screenVideo.videoHeight };
    }
    if (S.content === 'slides' && S.slides[S.slideIdx]) {
      const c = S.slides[S.slideIdx].canvas;
      return { el: c, w: c.width, h: c.height };
    }
    return null;
  };

  function drawBackground() {
    const full = { x: 0, y: 0, w: W, h: H };
    if (S.bg.type === 'image' && S.bg.image) {
      drawCover(S.bg.image, S.bg.image.width, S.bg.image.height, full, false);
    } else if (S.bg.type === 'color') {
      ctx.fillStyle = S.bg.color;
      ctx.fillRect(0, 0, W, H);
    } else {
      // base colour plus two soft blobs, for the mesh-gradient look
      const [a, b, c] = GRADIENTS[S.bg.index];
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, W, H);
      for (const [color, x, y, rad] of [[b, W * 0.82, H * 0.12, W * 0.6], [c, W * 0.25, H * 1.05, W * 0.55], [b, W * 0.55, H * 0.95, W * 0.3]]) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, color); g.addColorStop(1, color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  function drawContent(area, exact) {
    const src = contentSource();
    const aspect = src ? src.w / src.h : 16 / 9;
    let r, radius = S.radius, clip = null;
    if (S.frame === 'browser') {
      const bar = Math.round(area.h * 0.055);
      r = fit({ x: area.x, y: area.y + bar, w: area.w, h: area.h - bar }, aspect);
      const body = { x: r.x, y: r.y - bar, w: r.w, h: r.h + bar };
      shadowed(body, S.radius, '#23232a');
      ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(body.x + bar * (0.55 + i * 0.5), body.y + bar / 2, bar * 0.14, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      ctx.beginPath(); ctx.roundRect(body.x + body.w * 0.25, body.y + bar * 0.22, body.w * 0.5, bar * 0.56, bar * 0.28); ctx.fill();
      clip = body;                 // content shares the window's rounded bottom corners
    } else if (S.frame !== 'none') {
      const phone = S.frame === 'phone';
      const bezel = Math.min(area.w, area.h) * (phone ? 0.022 : 0.03);
      r = fit(inset(area, bezel), aspect);
      const body = inset(r, -bezel);
      const bodyRadius = Math.min(r.w, r.h) * (phone ? 0.13 : 0.06) + bezel;
      shadowed(body, bodyRadius, '#0b0b0d');
      ctx.save();
      pathRound(inset(body, 1.5), bodyRadius);
      ctx.lineWidth = 3; ctx.strokeStyle = '#4a4a52'; ctx.stroke();
      ctx.restore();
      radius = bodyRadius - bezel;
    } else {
      r = exact ? area : fit(area, aspect);
      shadowed(r, radius, src ? '#000' : 'rgba(15,17,21,.55)');
    }
    ctx.save();
    pathRound(clip || r, radius);
    ctx.clip();
    if (!src && S.frame !== 'none') { ctx.fillStyle = '#16161b'; ctx.fillRect(r.x, r.y, r.w, r.h); }
    if (src) {
      // Cinematic Zoom: crop the source around the (eased) focus point.
      const k = S.zoom.k;
      const cw = src.w / k, ch = src.h / k;
      const sx = clamp(S.zoom.x * src.w - cw / 2, 0, src.w - cw), sy = clamp(S.zoom.y * src.h - ch / 2, 0, src.h - ch);
      ctx.drawImage(src.el, sx, sy, cw, ch, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = `500 ${Math.round(Math.max(18, r.h * 0.055))}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Choose a screen or load slides', r.x + r.w / 2, r.y + r.h / 2);
    }
    ctx.restore();
    S.contentRect = r;
    return r;
  }

  // Branded holding screen shown instead of the camera.
  function drawAway(r) {
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, '#f1fbe3'); g.addColorStop(1, '#cfeeb0');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const name = (S.tag.name || 'Back soon').toUpperCase();
    const size = Math.min(r.h * 0.2, r.w * 0.13);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0b0b0f';
    ctx.font = `800 ${size}px "Arial Narrow", "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(name, r.x + r.w / 2, r.y + r.h / 2 - (S.tag.title ? size * 0.3 : 0), r.w * 0.86);
    if (S.tag.title) {
      ctx.font = `600 ${size * 0.36}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(S.tag.title.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2 + size * 0.55, r.w * 0.86);
    }
  }

  // Camera with its effects applied: person cut out with the segmentation mask, then put back
  // over a blurred / replaced / dimmed background. Returns the plain video when no effect is on.
  const fxCanvas = document.createElement('canvas'), fxCtx = fxCanvas.getContext('2d');
  const personCanvas = document.createElement('canvas'), personCtx = personCanvas.getContext('2d');
  function cameraFrame() {
    const fx = S.fx;
    if (fx.bg === 'none' && !fx.smooth && !fx.light) return camVideo;
    const mask = window.personMask && personMask(camVideo, performance.now());
    if (!mask) return camVideo;
    const w = camVideo.videoWidth, h = camVideo.videoHeight;
    for (const c of [fxCanvas, personCanvas]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

    const light = fx.light ? 'brightness(1.12) contrast(1.05) saturate(1.06) ' : '';
    personCtx.globalCompositeOperation = 'copy';
    personCtx.filter = light || 'none';
    personCtx.drawImage(camVideo, 0, 0, w, h);
    personCtx.globalCompositeOperation = 'source-over';
    if (fx.smooth) {
      // ponytail: softens the whole person, not just skin; needs face landmarks to target skin only
      personCtx.filter = light + 'blur(5px)';
      personCtx.globalAlpha = 0.5;
      personCtx.drawImage(camVideo, 0, 0, w, h);
      personCtx.globalAlpha = 1;
    }
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.filter = 'blur(4px)';               // feather the mask edge
    personCtx.drawImage(mask, 0, 0, w, h);
    personCtx.filter = 'none';

    if (fx.bg === 'blur') {
      fxCtx.filter = 'blur(22px)';
      fxCtx.drawImage(camVideo, -40, -40, w + 80, h + 80);
    } else if (fx.bg === 'image' && fx.image) {
      const k = Math.max(w / fx.image.width, h / fx.image.height);
      const iw = fx.image.width * k, ih = fx.image.height * k;
      fxCtx.save();
      if (S.mirror) { fxCtx.translate(w, 0); fxCtx.scale(-1, 1); }   // un-flip, the camera is mirrored later
      fxCtx.drawImage(fx.image, (w - iw) / 2, (h - ih) / 2, iw, ih);
      fxCtx.restore();
    } else if (fx.bg === 'gradient') {
      const [a, b, c] = GRADIENTS[fx.gradient];
      const g = fxCtx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, a); g.addColorStop(0.6, b); g.addColorStop(1, c);
      fxCtx.fillStyle = g;
      fxCtx.fillRect(0, 0, w, h);
    } else {
      fxCtx.filter = fx.light ? 'brightness(.8)' : 'none';   // studio light: dim the room behind you
      fxCtx.drawImage(camVideo, 0, 0, w, h);
    }
    fxCtx.filter = 'none';
    fxCtx.drawImage(personCanvas, 0, 0);
    return fxCanvas;
  }

  function drawCamera(r, radius, away) {
    shadowed(r, radius, '#1b1e26');
    ctx.save();
    pathRound(r, radius);
    ctx.clip();
    if (away || !camReady()) {
      drawAway(r);
    } else {
      const c = S.cam, vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      ctx.filter = `brightness(${1 + c.exposure}) saturate(${1 + c.sat})`;
      drawCover(cameraFrame(), vw, vh, r, S.mirror, c.zoom, c.panX, c.panY);
      ctx.filter = 'none';
      wash(r, c.temp > 0 ? '#ff9a3c' : '#3c8cff', Math.abs(c.temp) * 0.5, 'soft-light');
      wash(r, c.tint > 0 ? '#ff3cd0' : '#3cff6e', Math.abs(c.tint) * 0.4, 'soft-light');
    }
    ctx.restore();
  }

  // Rect centred on camPos, kept fully on stage.
  function movableRect(w, h) {
    const m = 16;
    const cx = clamp(S.camPos.x * W, m + w / 2, W - m - w / 2);
    const cy = clamp(S.camPos.y * H, m + h / 2, H - m - h / 2);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function drawPill(text, x, y, align, color) {
    ctx.font = '600 40px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 56;
    const r = { x: align === 'center' ? x - w / 2 : x, y, w, h: 76 };
    shadowed(r, 38, color);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, r.x + w / 2, r.y + r.h / 2 + 2);
  }

  function drawOverlays(now) {
    // logo, top-right
    if (S.logo) {
      const h = 84, w = Math.min(420, h * S.logo.width / S.logo.height);
      ctx.drawImage(S.logo, W - 56 - w, 48, w, h);
    }
    // name tag, bottom-left
    if (S.tag.on && (S.tag.name || S.tag.title)) {
      const x = 64, pad = 22;
      ctx.font = '650 40px system-ui, sans-serif';
      const wName = S.tag.name ? ctx.measureText(S.tag.name).width : 0;
      ctx.font = '400 26px system-ui, sans-serif';
      const wTitle = S.tag.title ? ctx.measureText(S.tag.title).width : 0;
      const h = (S.tag.name ? 48 : 0) + (S.tag.title ? 36 : 0) + pad * 2 - 6;
      const w = Math.max(wName, wTitle) + pad * 2 + 22;
      // keep clear of a camera bubble parked bottom-left
      const m = S.movable, right = m && m.x + m.w / 2 < W / 2 && m.y + m.h > H - 80 - h;
      const r = { x: right ? W - x - w : x, y: H - 64 - h, w, h };
      shadowed(r, 16, 'rgba(15,17,21,.82)');
      ctx.fillStyle = '#c5f08e';
      ctx.beginPath(); ctx.roundRect(r.x + 14, r.y + 16, 6, r.h - 32, 3); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      let ty = r.y + pad - 2;
      if (S.tag.name) {
        ctx.fillStyle = '#fff'; ctx.font = '650 40px system-ui, sans-serif';
        ctx.fillText(S.tag.name, r.x + pad + 16, ty); ty += 48;
      }
      if (S.tag.title) {
        ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = '400 26px system-ui, sans-serif';
        ctx.fillText(S.tag.title, r.x + pad + 16, ty);
      }
    }
    // caption, top-centre
    if (S.caption) {
      ctx.font = '600 44px system-ui, sans-serif';
      const w = Math.min(W - 160, ctx.measureText(S.caption).width + 64);
      const r = { x: (W - w) / 2, y: 56, w, h: 84 };
      shadowed(r, 42, 'rgba(15,17,21,.82)');
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(S.caption, W / 2, r.y + r.h / 2 + 2, w - 48);
    }
    // timer, top-left
    const t = S.timer;
    if (t.running || (t.left < t.total && t.left > 0)) drawPill(fmt(t.left), 56, 52, 'left', t.left <= 10000 ? 'rgba(225,29,72,.92)' : 'rgba(15,17,21,.82)');
    else if (t.doneAt && now - t.doneAt < 5000) drawPill("Time's up", 56, 52, 'left', 'rgba(225,29,72,.92)');
    // GIFs and stickers: pop in on the right, play for a few seconds
    const STICKER_LIFE = 5000;
    S.stickers = S.stickers.filter((s) => now - s.t0 < STICKER_LIFE);
    S.stickers.forEach((s, i) => {
      const age = now - s.t0;
      const pop = Math.min(1, age / 220) * (age > STICKER_LIFE - 300 ? (STICKER_LIFE - age) / 300 : 1);
      let t = age % s.gif.total, frame = s.gif.frames[0];
      for (const f of s.gif.frames) { frame = f; if ((t -= f.dur) < 0) break; }
      const h = H * 0.34 * pop, w = h * frame.bmp.width / frame.bmp.height;
      const r = { x: W - 90 - w - i * 40, y: H * 0.3 - h / 2 + i * 40, w, h };
      ctx.save();
      ctx.globalAlpha = Math.max(0, pop);
      shadowed(r, 18, '#000');
      pathRound(r, 18); ctx.clip();
      ctx.drawImage(frame.bmp, r.x, r.y, r.w, r.h);
      ctx.restore();
    });
    // floating reactions
    const LIFE = 2600;
    S.reactions = S.reactions.filter((p) => now - p.t0 < LIFE);
    for (const p of S.reactions) {
      const k = (now - p.t0) / LIFE;
      ctx.save();
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `${110 + 30 * Math.sin(Math.min(1, k * 4) * Math.PI / 2)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, p.x + Math.sin(k * 7 + p.x) * 26, H - 120 - k * 620);
      ctx.restore();
    }
    // confetti
    S.confetti = S.confetti.filter((p) => p.y < H + 40);
    for (const p of S.confetti) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.45; p.spin += 0.2;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.fillRect(-9, -5, 18, 10);
      ctx.restore();
    }
  }

  function draw() {
    const now = performance.now();
    const pad = S.padding * W;
    const gap = Math.max(20, pad * 0.6);
    const area = inset({ x: 0, y: 0, w: W, h: H }, pad);
    S.movable = null;
    S.contentRect = null;

    // ease Cinematic Zoom towards its target
    const z = S.zoom;
    z.k += ((z.active ? ZOOM : 1) - z.k) * 0.12;
    z.x += (z.tx - z.x) * 0.12;
    z.y += (z.ty - z.y) * 0.12;

    ctx.clearRect(0, 0, W, H);
    drawBackground();

    switch (S.layout) {
      case 'bubble': {
        drawContent(area);
        const d = S.camSize * H;
        const r = movableRect(S.shape === 'wide' ? d * 1.5 : d, d);
        drawCamera(r, S.shape === 'circle' ? d : S.radius * 1.2);
        S.movable = r;
        break;
      }
      case 'side': {
        // portrait camera card on the left, content on the right
        const camW = area.w * 0.2;
        const c = drawContent({ x: area.x + camW + gap, y: area.y, w: area.w - camW - gap, h: area.h });
        const camH = Math.min(c.h * 0.72, camW * 1.5);
        drawCamera({ x: area.x, y: c.y + (c.h - camH) / 2, w: camW, h: camH }, S.radius);
        break;
      }
      case 'split': {
        const half = (area.w - gap) / 2;
        const c = drawContent({ x: area.x + half + gap, y: area.y, w: half, h: area.h });
        // camera column matches the content's height so the two line up
        drawCamera({ x: area.x, y: c.y, w: half, h: c.h }, S.radius);
        break;
      }
      case 'camera':
      case 'away':
        drawCamera(area, pad ? S.radius : 0, S.layout === 'away');
        break;
      default:
        drawContent(area);
    }
    drawOverlays(now);
  }

  // ---------------------------------------------------------------- media devices
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioDest = audioCtx.createMediaStreamDestination();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  let micNode = null, screenAudioNode = null;
  document.addEventListener('pointerdown', () => { if (audioCtx.state === 'suspended') audioCtx.resume(); });

  const stop = (stream) => stream && stream.getTracks().forEach((t) => t.stop());

  async function startCamera(deviceId) {
    stop(camStream); camStream = null;
    if (deviceId === 'off') return;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      camVideo.srcObject = camStream;
      await camVideo.play().catch(() => {});
    } catch (err) {
      toast('Could not start the camera: ' + err.message);
    }
  }

  async function startMic(deviceId) {
    stop(micStream); micStream = null;
    if (micNode) { micNode.disconnect(); micNode = null; }
    if (deviceId === 'off') return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true },
      });
      micStream.getAudioTracks().forEach((t) => { t.enabled = !S.muted; });
      micNode = audioCtx.createMediaStreamSource(micStream);
      micNode.connect(audioDest);
      micNode.connect(analyser);
    } catch (err) {
      toast('Could not start the microphone: ' + err.message);
    }
  }

  function setMuted(muted) {
    S.muted = muted;
    if (micStream) micStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setRecUI();
  }

  async function fillDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (select, kind, current, label) => {
      const list = devices.filter((d) => d.kind === kind);
      select.innerHTML = '';
      list.forEach((d, i) => select.add(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
      select.add(new Option(`No ${label.toLowerCase()}`, 'off'));
      const active = current && current.getTracks()[0] && current.getTracks()[0].getSettings().deviceId;
      select.value = current ? (active || select.options[0].value) : 'off';
    };
    fill($('camSelect'), 'videoinput', camStream, 'Camera');
    fill($('micSelect'), 'audioinput', micStream, 'Microphone');
  }

  // ---------------------------------------------------------------- screen sharing
  function stopScreen() {
    stop(screenStream); screenStream = null;
    if (screenAudioNode) { screenAudioNode.disconnect(); screenAudioNode = null; }
    screenVideo.srcObject = null;
    if (S.content === 'screen') S.content = 'none';
    updateContentUI();
  }

  async function captureScreen(source) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: !api || api.platform === 'win32',   // system audio is only available on Windows
      });
      stopScreen();
      screenStream = stream;
      screenVideo.srcObject = stream;
      await screenVideo.play().catch(() => {});
      if (stream.getAudioTracks().length) {
        screenAudioNode = audioCtx.createMediaStreamSource(stream);
        screenAudioNode.connect(audioDest);
      }
      stream.getVideoTracks()[0].addEventListener('ended', stopScreen);
      S.content = 'screen';
      S.sourceName = source ? source.name : stream.getVideoTracks()[0].label || 'Shared screen';
      S.displayId = source && source.kind === 'screen' ? source.displayId : null;
      S.zoom.active = false;
      updateContentUI();
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast('Could not share: ' + err.message);
    }
  }

  async function openPicker() {
    if (!api) return captureScreen();              // browsers show their own picker
    const { sources, screenAccess } = await api.listSources();
    const grid = $('pickerGrid'), note = $('pickerNote');
    grid.innerHTML = '';
    note.hidden = true;
    if (api.platform === 'darwin' && screenAccess !== 'granted') {
      note.hidden = false;
      note.innerHTML = 'macOS needs your permission to record the screen. Enable Onstage under Privacy &amp; Security &rarr; Screen Recording, then restart the app. ';
      const b = document.createElement('button');
      b.className = 'link'; b.textContent = 'Open settings';
      b.onclick = () => api.openScreenSettings();
      note.appendChild(b);
    }
    for (const s of sources) {
      const b = document.createElement('button');
      const thumb = s.thumb ? Object.assign(new Image(), { src: s.thumb, alt: '' }) : Object.assign(document.createElement('div'), { className: 'nothumb' });
      const label = document.createElement('span');
      label.textContent = (s.kind === 'screen' ? 'Screen: ' : '') + s.name;
      b.append(thumb, label);
      b.onclick = async () => {
        $('picker').hidden = true;
        await api.selectSource(s.id);
        captureScreen(s);
      };
      grid.appendChild(b);
    }
    $('picker').hidden = false;
  }

  // ---------------------------------------------------------------- slides
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  function makeSlide(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
    return { canvas: c, cx, done: () => {
      const t = document.createElement('canvas');
      t.height = 108; t.width = Math.round(108 * w / h);
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      return { canvas: c, thumb: t.toDataURL('image/jpeg', 0.7) };
    } };
  }

  async function loadSlides(files) {
    const slides = [];
    for (const file of files) {
      try {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
          for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(W / base.width, H * 1.5 / base.height) });
            const s = makeSlide(Math.round(viewport.width), Math.round(viewport.height));
            await page.render({ canvasContext: s.cx, viewport }).promise;
            slides.push(s.done());
          }
        } else if (file.type.startsWith('image/')) {
          const bmp = await createImageBitmap(file);
          const k = Math.min(1, 2560 / bmp.width);
          const s = makeSlide(Math.round(bmp.width * k), Math.round(bmp.height * k));
          s.cx.drawImage(bmp, 0, 0, s.canvas.width, s.canvas.height);
          slides.push(s.done());
        }
      } catch (err) {
        toast(`Could not open ${file.name}: ${err.message}`);
      }
    }
    if (!slides.length) return;
    if (S.content === 'screen') stopScreen();
    S.slides = slides;
    S.slideIdx = 0;
    S.content = 'slides';
    S.sourceName = files.length === 1 ? files[0].name : `${slides.length} slides`;
    S.displayId = null;
    S.zoom.active = false;
    updateContentUI();
  }

  function goSlide(i) {
    if (S.content !== 'slides') return;
    S.slideIdx = clamp(i, 0, S.slides.length - 1);
    updateContentUI();
  }

  function updateContentUI() {
    const strip = $('slideStrip');
    const isSlides = S.content === 'slides';
    $('slideNav').hidden = !isSlides;
    strip.hidden = !isSlides;
    $('clearContent').hidden = S.content === 'none';
    $('sourceName').textContent = S.content === 'none' ? 'Choose a screen or window' : S.sourceName;
    if (isSlides) {
      $('slideCount').textContent = `${S.slideIdx + 1} / ${S.slides.length}`;
      if (strip.childElementCount !== S.slides.length) {
        strip.innerHTML = '';
        S.slides.forEach((s, i) => {
          const img = Object.assign(new Image(), { src: s.thumb, alt: `Slide ${i + 1}` });
          img.onclick = () => goSlide(i);
          strip.appendChild(img);
        });
      }
      [...strip.children].forEach((el, i) => el.classList.toggle('active', i === S.slideIdx));
      strip.children[S.slideIdx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ---------------------------------------------------------------- recording
  const MIME = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  const EXT = MIME && MIME.startsWith('video/mp4') ? 'mp4' : 'webm';

  let recorder = null, recState = 'idle';       // idle | countdown | recording | paused | exporting
  let writeChain = Promise.resolve(), localChunks = [];
  let elapsed = 0, lastTick = 0, restarting = false;

  function setRecUI() {
    const live = recState === 'recording' || recState === 'paused';
    $('recBtn').classList.toggle('live', live);
    $('recBtn').disabled = recState === 'exporting';
    $('recLabel').textContent = live ? fmt(elapsed) : recState === 'countdown' ? 'Cancel' : 'New recording';
    $('recBtn').title = live ? 'Stop recording' : '';
    $('pauseBtn').hidden = !live;
    $('restartBtn').hidden = !live;
    $('pauseBtn').textContent = recState === 'paused' ? 'Resume' : 'Pause';
    $('status').hidden = !(S.muted || recState === 'paused');
    $('status').textContent = recState === 'paused' ? 'Paused' : 'Mic muted';
  }

  async function countdown() {
    const el = $('countdown');
    el.hidden = false;
    for (let n = 3; n >= 1; n--) {
      el.textContent = n;
      await new Promise((r) => setTimeout(r, 800));
      if (recState !== 'countdown') break;
    }
    el.hidden = true;
    return recState === 'countdown';
  }

  // Feeds recorder chunks to the main process (or keeps them in memory in a plain browser).
  function pipeChunks(rec) {
    localChunks = []; writeChain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      if (api) writeChain = writeChain.then(async () => api.recChunk(await e.data.arrayBuffer()));
      else localChunks.push(e.data);
    };
  }

  async function startRecording() {
    if (!MIME) return toast('Recording is not supported on this system.');
    setTab('present');
    recState = 'countdown'; setRecUI();
    if (S.countdown && !(await countdown())) return;

    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const stream = new MediaStream([
      ...canvas.captureStream(FPS).getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);
    recorder = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    if (api) await api.recStart(EXT);
    pipeChunks(recorder);
    recorder.onstop = finishRecording;
    recorder.onerror = (e) => toast('Recording error: ' + (e.error && e.error.message));
    recorder.start(1000);
    elapsed = 0; lastTick = performance.now();
    recState = 'recording'; setRecUI();
  }

  function snapshot(width) {
    const t = document.createElement('canvas');
    t.width = width; t.height = Math.round(width * H / W);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  }

  async function finishRecording() {
    recState = 'idle'; setRecUI();
    try {
      if (api) {
        await writeChain;
        if (restarting) {
          restarting = false;
          await api.recFinish({ discard: true });
          return startRecording();
        }
        const res = await api.recFinish({ duration: elapsed, thumb: snapshot(480) });
        if (res.saved) {
          await loadVideos(res.id);
          toast('Recording saved to Videos.', 'Open', () => setTab('videos'));
        }
      } else {
        const url = URL.createObjectURL(new Blob(localChunks, { type: MIME }));
        Object.assign(document.createElement('a'), { href: url, download: `onstage-recording.${EXT}` }).click();
        toast('Recording downloaded.');
      }
    } catch (err) {
      toast('Could not save the recording: ' + err.message);
    }
  }

  function toggleRecord() {
    if (recState === 'idle') startRecording();
    else if (recState === 'countdown') { recState = 'idle'; setRecUI(); }
    else if (recState !== 'exporting') recorder.stop();
  }

  function togglePause() {
    if (recState === 'recording') { recorder.pause(); recState = 'paused'; }
    else if (recState === 'paused') { recorder.resume(); recState = 'recording'; lastTick = performance.now(); }
    setRecUI();
  }

  // ---------------------------------------------------------------- video library
  let videos = [], currentVideo = null, quality = 'original';
  const QUALITIES = [
    { id: 'original', name: 'Original (1080p)', note: 'An exact copy, ready instantly', height: 1080 },
    { id: 'web', name: 'Web (720p)', note: 'For browser playback and quick sharing', height: 720 },
    { id: 'tiny', name: 'Tiny (480p)', note: 'For smallest file size and sharing as an attachment', height: 480 },
  ];
  const video = $('video');

  async function loadVideos(selectId) {
    if (!api) return;
    videos = await api.videos.list();
    renderVideoList();
    selectVideo(videos.find((v) => v.id === selectId) || videos.find((v) => currentVideo && v.id === currentVideo.id) || videos[0] || null);
  }

  function renderVideoList() {
    const q = $('videoSearch').value.trim().toLowerCase();
    const list = $('videoList');
    list.innerHTML = '';
    for (const v of videos.filter((x) => x.title.toLowerCase().includes(q))) {
      const b = document.createElement('button');
      b.className = 'video-item' + (currentVideo && currentVideo.id === v.id ? ' active' : '');
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (v.thumb) thumb.appendChild(Object.assign(new Image(), { src: v.thumb, alt: '' }));
      thumb.appendChild(Object.assign(document.createElement('span'), { className: 'dur', textContent: fmt(v.duration) }));
      b.append(thumb, Object.assign(document.createElement('span'), { textContent: v.title }),
        Object.assign(document.createElement('small'), { textContent: new Date(v.date).toLocaleDateString(undefined, { dateStyle: 'long' }) }));
      b.onclick = () => selectVideo(v);
      list.appendChild(b);
    }
    if (!list.childElementCount) list.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: videos.length ? 'No recordings match.' : 'Your recordings will appear here.' }));
  }

  function selectVideo(v) {
    currentVideo = v;
    $('playerEmpty').hidden = !!v;
    $('playerBody').hidden = !v;
    if (v) {
      if (video.dataset.id !== v.id) { video.src = v.url; video.dataset.id = v.id; }
      $('videoTitle').value = v.title;
      $('videoDate').textContent = new Date(v.date).toLocaleDateString(undefined, { dateStyle: 'long' });
      const secs = v.duration / 1000;
      for (const id of ['trimStart', 'trimEnd']) $(id).max = secs;
      $('trimStart').value = 0; $('trimEnd').value = secs;
      paintTrim();
      $('trimBar').hidden = true;
    } else {
      video.removeAttribute('src'); video.load(); delete video.dataset.id;
    }
    renderVideoList();
  }

  // MediaRecorder files carry no duration; seeking far ahead makes the browser work it out.
  video.addEventListener('loadedmetadata', () => {
    if (video.duration !== Infinity) return;
    video.currentTime = 1e9;
    video.addEventListener('seeked', () => { video.currentTime = 0; }, { once: true });
  });

  const trimRange = () => ({ start: +$('trimStart').value, end: +$('trimEnd').value });
  function paintTrim() {
    const { start, end } = trimRange();
    $('trimStartLabel').textContent = fmt(start * 1000);
    $('trimEndLabel').textContent = fmt(end * 1000);
  }

  function openExport() {
    if (!currentVideo) return;
    const { start, end } = trimRange();
    $('exportTitle').textContent = `Export “${currentVideo.title}”`;
    $('exportDuration').textContent = fmt((end - start) * 1000);
    paintExportNote();
    $('exportModal').hidden = false;
  }

  const needsReencode = () => {
    const { start, end } = trimRange();
    return quality !== 'original' || !$('exportAudio').checked || start > 0.05 || end < currentVideo.duration / 1000 - 0.05;
  };
  function paintExportNote() {
    $('exportNote').textContent = needsReencode()
      ? 'This export is re-recorded in real time, so it takes as long as the clip. Keep the app open until it finishes.'
      : '';
  }

  // Plays the clip into a smaller canvas and records that. Real time, but needs no encoder library.
  // ponytail: real-time re-encode; swap in ffmpeg if long exports become a problem.
  async function reencode(v, height, start, end, withAudio, onProgress) {
    const el = document.createElement('video');
    el.src = v.url;
    await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('The recording could not be opened.')); });
    const c = document.createElement('canvas');
    c.height = height; c.width = Math.round(height * 16 / 9);
    const cx = c.getContext('2d');
    const tracks = [...c.captureStream(FPS).getVideoTracks()];
    const node = audioCtx.createMediaElementSource(el);   // routed here only, so the export is silent to the user
    if (withAudio) {
      const dest = audioCtx.createMediaStreamDestination();
      node.connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    }
    const out = new MediaRecorder(new MediaStream(tracks), { mimeType: MIME, videoBitsPerSecond: height >= 1080 ? 8_000_000 : height >= 720 ? 3_500_000 : 1_500_000, audioBitsPerSecond: 128_000 });
    await api.recStart(EXT);
    pipeChunks(out);
    if (start > 0) {
      el.currentTime = start;
      await new Promise((res) => { el.onseeked = res; });
    }
    await audioCtx.resume();
    out.start(1000);
    await el.play();
    await new Promise((res) => {
      const tick = setInterval(() => {
        cx.drawImage(el, 0, 0, c.width, c.height);
        onProgress((el.currentTime - start) / (end - start));
        if (el.ended || el.currentTime >= end) { clearInterval(tick); res(); }
      }, 1000 / FPS);
    });
    el.pause();
    await new Promise((res) => { out.onstop = res; out.stop(); });
    node.disconnect();
    await writeChain;
    return api.recFinish({ exportAs: v.title });
  }

  async function startExport() {
    const v = currentVideo;
    if (recState !== 'idle') return toast('Finish the current recording before exporting.');
    const { start, end } = trimRange();
    const btn = $('exportStart');
    try {
      let res;
      if (!needsReencode()) {
        res = await api.videos.exportCopy(v.id);
      } else {
        recState = 'exporting'; setRecUI();
        btn.disabled = true;
        video.pause();
        const height = QUALITIES.find((q) => q.id === quality).height;
        res = await reencode(v, height, start, end, $('exportAudio').checked, (p) => { btn.textContent = `Exporting ${Math.round(clamp(p, 0, 1) * 100)}%`; });
      }
      $('exportModal').hidden = true;
      if (res.saved) toast('Export saved.', 'Show file', () => api.reveal(res.filePath));
      else if (res.tmpPath) toast('Not saved. A copy is kept at ' + res.tmpPath, 'Show file', () => api.reveal(res.tmpPath));
    } catch (err) {
      toast('Export failed: ' + err.message);
    } finally {
      if (recState === 'exporting') recState = 'idle';
      btn.disabled = false; btn.textContent = 'Start export';
      setRecUI();
    }
  }

  // ---------------------------------------------------------------- commands (buttons, hotkeys, remote)
  function setZoom(active, point) {
    if (active && !contentSource()) return toast('Share a screen or load slides to zoom.');
    S.zoom.active = active && S.zoom.on;
    if (S.zoom.active && point) { S.zoom.tx = point.x; S.zoom.ty = point.y; }
    repaint();
  }

  function react(emoji) { S.reactions.push({ emoji, x: W * (0.3 + Math.random() * 0.4), t0: performance.now() }); }

  function confetti() {
    const colors = ['#c5f08e', '#f43f5e', '#fbbf24', '#34d399', '#38bdf8', '#f472b6'];
    for (let i = 0; i < 160; i++) {
      S.confetti.push({ x: W / 2 + (Math.random() - 0.5) * 300, y: H * 0.45, vx: (Math.random() - 0.5) * 40, vy: -Math.random() * 30 - 6, spin: Math.random() * 6, color: colors[i % colors.length] });
    }
  }

  function toggleTimer() {
    const t = S.timer;
    if (!t.running && t.left <= 0) t.left = t.total;
    t.running = !t.running;
    t.last = performance.now();
    paintTimer();
  }

  function command([name, arg]) {
    switch (name) {
      case 'layout': S.layout = arg; break;
      case 'layoutIndex': S.layout = LAYOUTS[arg].id; break;
      case 'zoom': setZoom(!S.zoom.active); break;
      case 'mute': setMuted(!S.muted); break;
      case 'record': toggleRecord(); break;
      case 'react': react(arg); break;
      case 'timer': toggleTimer(); break;
      case 'confetti': confetti(); break;
      case 'share': setTab('present'); openPicker(); break;
      case 'stopShare': clearContent(); break;
    }
    repaint();
  }

  function clearContent() {
    if (S.content === 'screen') stopScreen();
    else { S.content = 'none'; S.slides = []; updateContentUI(); }
    S.zoom.active = false;
  }

  // ---------------------------------------------------------------- UI wiring
  let toastTimer = 0;
  function toast(message, actionLabel, action) {
    const el = $('toast');
    el.textContent = message;
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'link'; b.textContent = actionLabel; b.onclick = action;
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 9000 : 4500);
  }

  // Every group of choice buttons registers a painter, so state changed elsewhere
  // (toolbar, hotkey, remote) shows up everywhere.
  const painters = [];
  const repaint = () => painters.forEach((p) => p());
  function choice(container, items, render, isActive, onPick) {
    const buttons = items.map((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      render(b, item, i);
      b.onclick = () => { onPick(item, i); repaint(); };
      container.appendChild(b);
      return b;
    });
    painters.push(() => buttons.forEach((b, i) => b.classList.toggle('active', !!isActive(items[i], i))));
  }
  const layoutThumb = (b, l) => { b.innerHTML = `<svg viewBox="0 0 48 30">${l.icon}</svg>`; b.title = l.name; b.setAttribute('aria-label', l.name); };
  const swatch = (b, g, i) => { b.style.background = `linear-gradient(135deg, ${g[0]}, ${g[1]} 60%, ${g[2]})`; b.title = `Background ${i + 1}`; b.setAttribute('aria-label', b.title); };
  const pickGradient = (g, i) => { S.bg.type = 'gradient'; S.bg.index = i; };
  const isGradient = (g, i) => S.bg.type === 'gradient' && S.bg.index === i;
  const emojiButtons = (container) => EMOJI.forEach((emoji) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = emoji; b.setAttribute('aria-label', `React ${emoji}`);
    b.onclick = () => react(emoji);
    container.appendChild(b);
  });

  // rail + tabs
  let tab = 'present';
  function setTab(id) {
    tab = id;
    $('panelTitle').textContent = TABS.find((t) => t.id === id).name;
    document.querySelectorAll('.tab').forEach((el) => { el.hidden = el.dataset.tab !== id; });
    $('studio').hidden = id === 'videos';
    $('player').hidden = id !== 'videos';
    if (id !== 'videos') video.pause();
    repaint();
  }
  choice($('railTabs'), TABS,
    (b, t) => { b.className = 'rail-btn' + (t.sep ? ' sep' : ''); b.innerHTML = `<i data-icon="${t.id}"></i><span>${t.name}</span>`; },
    (t) => t.id === tab, (t) => setTab(t.id));

  choice($('layouts'), LAYOUTS, layoutThumb, (l) => l.id === S.layout, (l) => { S.layout = l.id; });
  choice($('shapes'), SHAPES, (b, s) => { b.textContent = s.name; }, (s) => s.id === S.shape, (s) => { S.shape = s.id; S.layout = 'bubble'; });
  choice($('backgrounds'), GRADIENTS, swatch, isGradient, pickGradient);
  emojiButtons($('reactions'));
  $('confettiBtn').onclick = confetti;
  choice($('frames'), [{ id: 'none', name: 'None' }, { id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }, { id: 'browser', name: 'Browser' }],
    (b, f) => { b.textContent = f.name; }, (f) => f.id === S.frame, (f) => { S.frame = f.id; });

  // virtual background
  choice($('fxModes'), [{ id: 'none', name: 'None' }, { id: 'blur', name: 'Blur' }, { id: 'image', name: 'Image' }],
    (b, m) => { b.textContent = m.name; }, (m) => m.id === S.fx.bg,
    (m) => { if (m.id === 'image' && !S.fx.image) $('fxImage').click(); else S.fx.bg = m.id; });
  choice($('fxGradients'), GRADIENTS, swatch, (g, i) => S.fx.bg === 'gradient' && S.fx.gradient === i, (g, i) => { S.fx.bg = 'gradient'; S.fx.gradient = i; });
  window.addEventListener('segmenter-error', () => {
    S.fx.bg = 'none'; S.fx.smooth = S.fx.light = false;
    document.querySelectorAll('[data-bind^="fx."]').forEach((el) => { el.checked = false; });
    repaint();
    toast('Camera effects could not start on this computer.');
  });

  // GIFs and stickers
  async function decodeGif(blob) {
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type || 'image/gif' });
    await decoder.tracks.ready;
    const count = Math.min(decoder.tracks.selectedTrack.frameCount, 150);   // cap memory on very long GIFs
    const frames = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      frames.push({ bmp: await createImageBitmap(image), dur: (image.duration || 100000) / 1000 });
      image.close();
    }
    return { frames, total: frames.reduce((n, f) => n + f.dur, 0) };
  }
  async function addGif(blob, show) {
    try {
      const gif = await decodeGif(blob);
      const b = document.createElement('button');
      b.type = 'button'; b.title = 'Show on stage';
      b.appendChild(Object.assign(new Image(), { src: URL.createObjectURL(blob), alt: 'GIF' }));
      b.onclick = () => S.stickers.push({ gif, t0: performance.now() });
      $('gifLibrary').prepend(b);
      $('gifHint').hidden = true;
      if (show) b.click();
    } catch (err) {
      toast('That image could not be opened: ' + err.message);
    }
  }
  $('gifInput').onchange = async (e) => { for (const f of e.target.files) await addGif(f); e.target.value = ''; };

  // GIPHY search, only when the user has added their own API key in Settings
  const giphyKey = () => localStorage.getItem('giphyKey') || '';
  const paintGiphy = () => { $('gifSearchRow').hidden = !giphyKey(); $('gifKeyHint').hidden = !!giphyKey(); };
  $('giphyKey').value = giphyKey();
  $('giphyKey').onchange = (e) => { localStorage.setItem('giphyKey', e.target.value.trim()); paintGiphy(); };
  paintGiphy();
  $('gifSearch').onkeydown = async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const box = $('gifResults');
    box.textContent = 'Searching…';
    try {
      const res = await fetch('https://api.giphy.com/v1/gifs/search?api_key=' + encodeURIComponent(giphyKey()) + '&q=' + encodeURIComponent(e.target.value.trim()) + '&limit=12&rating=g');
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'GIPHY rejected the API key.' : 'GIPHY returned ' + res.status + '.');
      const { data } = await res.json();
      box.textContent = data.length ? '' : 'No GIFs found.';
      for (const g of data) {
        const b = document.createElement('button');
        b.type = 'button'; b.title = g.title;
        b.appendChild(Object.assign(new Image(), { src: g.images.fixed_width_small.url, alt: g.title }));
        b.onclick = async () => addGif(await (await fetch(g.images.fixed_height.url)).blob(), true);
        box.appendChild(b);
      }
    } catch (err) {
      box.textContent = err.message;
    }
  };

  // Live window: a clean copy of the stage to share in Zoom, Meet or Teams
  let liveWindow = null;
  function toggleLive() {
    if (liveWindow && !liveWindow.closed) { liveWindow.close(); liveWindow = null; return repaint(); }
    liveWindow = window.open('', 'onstage-live');
    const doc = liveWindow.document;
    doc.title = 'Onstage Live';
    doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    const v = doc.createElement('video');
    v.muted = true; v.autoplay = true;
    v.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
    v.srcObject = canvas.captureStream(FPS);
    doc.body.appendChild(v);
    repaint();
  }
  $('liveBtn').onclick = toggleLive;
  painters.push(() => {
    const live = !!liveWindow && !liveWindow.closed;
    $('liveBtn').classList.toggle('on', live);
    $('liveLabel').textContent = live ? 'Live' : 'Go live';
  });
  setInterval(() => { if (liveWindow && liveWindow.closed) { liveWindow = null; repaint(); } }, 1000);

  // floating toolbar above the stage: quick access to the most used controls
  const TOOLS = [
    { icon: 'star', title: 'Reactions', build: (p) => { p.className += ' reactions'; emojiButtons(p); } },
    { icon: 'background', title: 'Background', build: (p) => { p.className += ' swatches'; choice(p, GRADIENTS, swatch, isGradient, pickGradient); } },
    { icon: 'tag', title: 'Name tag', isActive: () => S.tag.on, toggle: () => {
      S.tag.on = !S.tag.on; $('tagOn').checked = S.tag.on;
      if (S.tag.on && !S.tag.name) { setTab('themes'); toast('Add your name under Name tag.'); }
    } },
    { icon: 'pointer', title: 'Cinematic Zoom', isActive: () => S.zoom.active, toggle: () => setZoom(!S.zoom.active) },
    { icon: 'shape', title: 'Camera shape', build: (p) => { p.className += ' seg'; choice(p, SHAPES, (b, s) => { b.textContent = s.name; }, (s) => s.id === S.shape, (s) => { S.shape = s.id; S.layout = 'bubble'; }); } },
  ];
  const popovers = [];
  for (const tool of TOOLS) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = tool.title; b.setAttribute('aria-label', tool.title);
    b.innerHTML = `<i data-icon="${tool.icon}"></i>` + (tool.build ? '<i class="chev" data-icon="chevron"></i>' : '');
    $('toolbar').appendChild(b);
    if (tool.build) {
      const p = document.createElement('div');
      p.className = 'popover'; p.hidden = true;
      tool.build(p);
      $('toolbar').appendChild(p);
      popovers.push(p);
      b.onclick = (e) => { e.stopPropagation(); popovers.forEach((x) => { x.hidden = x !== p || !p.hidden; }); };
      p.onclick = (e) => e.stopPropagation();
    } else {
      b.onclick = () => { tool.toggle(); repaint(); };
      painters.push(() => b.classList.toggle('active', tool.isActive()));
    }
  }
  document.addEventListener('click', () => popovers.forEach((p) => { p.hidden = true; }));

  // <input data-bind="cam.zoom"> writes straight into S.cam.zoom
  document.querySelectorAll('[data-bind]').forEach((el) => {
    const keys = el.dataset.bind.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], S);
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      target[last] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value.trim();
      if (el.dataset.bind === 'tag.name' && S.tag.name && !S.tag.on) { S.tag.on = true; $('tagOn').checked = true; }
      if (el.dataset.bind === 'zoom.on' && !S.zoom.on) S.zoom.active = false;
      repaint();
    });
  });
  $('camReset').onclick = () => $('camControls').querySelectorAll('input').forEach((el) => { el.value = el.defaultValue; el.dispatchEvent(new Event('input')); });

  $('bgColor').oninput = (e) => { S.bg.type = 'color'; S.bg.color = e.target.value; repaint(); };
  const pickImage = (input, apply) => {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { apply(await createImageBitmap(file)); repaint(); }
      catch { toast('That image could not be opened.'); }
      e.target.value = '';
    };
  };
  pickImage($('bgInput'), (img) => { S.bg.image = img; S.bg.type = 'image'; });
  pickImage($('logoInput'), (img) => { S.logo = img; $('logoClear').hidden = false; });
  pickImage($('fxImage'), (img) => { S.fx.image = img; S.fx.bg = 'image'; });
  $('logoClear').onclick = () => { S.logo = null; $('logoClear').hidden = true; };

  // appearance
  function setTheme(theme) {
    localStorage.setItem('theme', theme.id);
    document.documentElement.dataset.theme = theme.id;
    if (api) api.setTheme(theme.bar, theme.symbol);   // window buttons sit on the top bar, so they follow the theme
  }
  choice($('themes'), THEMES, (b, t) => { b.textContent = t.name; }, (t) => t.id === currentTheme().id, setTheme);
  setTheme(currentTheme());

  // timer tab
  function paintTimer() {
    $('timerBig').textContent = fmt(S.timer.left);
    $('timerToggle').textContent = S.timer.running ? 'Pause timer' : 'Start timer';
  }
  function setTimerMinutes(min) {
    const m = clamp(Math.round(min) || 1, 1, 180);
    S.timer = { total: m * 60000, left: m * 60000, running: false, doneAt: 0 };
    $('timerMinutes').value = m;
    paintTimer(); repaint();
  }
  choice($('timerPresets'), [1, 5, 10, 15], (b, m) => { b.textContent = `${m} min`; }, (m) => S.timer.total === m * 60000, setTimerMinutes);
  $('timerMinutes').onchange = (e) => setTimerMinutes(+e.target.value);
  $('timerToggle').onclick = toggleTimer;
  $('timerReset').onclick = () => setTimerMinutes(S.timer.total / 60000);

  // present tab + top bar
  $('shareBtn').onclick = openPicker;
  $('pickerClose').onclick = () => { $('picker').hidden = true; };
  $('slidesBtn').onclick = () => $('slidesInput').click();
  $('slidesInput').onchange = (e) => { loadSlides([...e.target.files]); e.target.value = ''; };
  $('prevSlide').onclick = () => goSlide(S.slideIdx - 1);
  $('nextSlide').onclick = () => goSlide(S.slideIdx + 1);
  $('clearContent').onclick = clearContent;
  $('camSelect').onchange = (e) => startCamera(e.target.value);
  $('micSelect').onchange = (e) => startMic(e.target.value);
  $('recBtn').onclick = toggleRecord;
  $('pauseBtn').onclick = togglePause;
  $('restartBtn').onclick = () => { restarting = true; recorder.stop(); };

  // videos tab
  $('videoSearch').oninput = renderVideoList;
  $('videoTitle').onchange = async (e) => {
    const title = e.target.value.trim();
    if (!title || !currentVideo) return;
    await api.videos.rename(currentVideo.id, title);
    loadVideos(currentVideo.id);
  };
  $('trimBtn').onclick = () => { $('trimBar').hidden = !$('trimBar').hidden; };
  $('trimStart').oninput = () => { if (+$('trimStart').value > +$('trimEnd').value - 1) $('trimStart').value = Math.max(0, +$('trimEnd').value - 1); paintTrim(); video.currentTime = +$('trimStart').value; };
  $('trimEnd').oninput = () => { if (+$('trimEnd').value < +$('trimStart').value + 1) $('trimEnd').value = +$('trimStart').value + 1; paintTrim(); video.currentTime = +$('trimEnd').value; };
  $('exportBtn').onclick = openExport;
  $('exportClose').onclick = $('exportCancel').onclick = () => { if (recState !== 'exporting') $('exportModal').hidden = true; };
  $('exportStart').onclick = startExport;
  $('exportAudio').onchange = paintExportNote;
  choice($('qualities'), QUALITIES,
    (b, q) => { b.textContent = q.name; b.appendChild(Object.assign(document.createElement('small'), { textContent: q.note })); },
    (q) => q.id === quality, (q) => { quality = q.id; paintExportNote(); });
  $('revealBtn').onclick = () => api.reveal(currentVideo.file);
  $('deleteBtn').onclick = async () => {
    const v = currentVideo;
    await api.videos.remove(v.id);
    await loadVideos();
    toast(`“${v.title}” moved to the Recycle Bin.`);
  };

  // remote
  let remoteOpen = false;
  $('remoteBtn').onclick = async () => { if (api) remoteOpen = await api.toggleRemote(); repaint(); };
  painters.push(() => $('remoteBtn').classList.toggle('active', remoteOpen));
  if (api) {
    api.onCommand(command);
    api.onRemoteOpen((open) => { remoteOpen = open; repaint(); });
    setInterval(() => {
      if (!remoteOpen) return;
      api.sendState({ preview: snapshot(320), layout: S.layout, muted: S.muted, zoom: S.zoom.active, timer: S.timer.running,
        source: S.content === 'none' ? '' : S.sourceName });
    }, 200);
    // Cinematic Zoom follows the mouse while a whole screen is shared.
    setInterval(async () => {
      if (!S.zoom.active || !S.displayId) return;
      const p = await api.cursor();
      if (p.displayId === S.displayId) { S.zoom.tx = clamp(p.x, 0, 1); S.zoom.ty = clamp(p.y, 0, 1); }
    }, 60);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('picker').hidden = true; popovers.forEach((p) => { p.hidden = true; }); }
    if (e.target.matches('input, select') || tab === 'videos') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { goSlide(S.slideIdx + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { goSlide(S.slideIdx - 1); e.preventDefault(); }
  });

  // stage: drag / scroll the camera bubble, click the content to zoom
  const toStage = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) * W / b.width, y: (e.clientY - b.top) * H / b.height };
  };
  const inRect = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const hit = (p) => inRect(p, S.movable);
  const zoomable = (p) => S.zoom.on && !hit(p) && contentSource() && inRect(p, S.contentRect);
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toStage(e);
    if (!hit(p)) {
      if (zoomable(p)) {
        const r = S.contentRect;
        setZoom(!S.zoom.active, { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h });
      }
      return;
    }
    const m = S.movable;
    drag = { dx: p.x - (m.x + m.w / 2), dy: p.y - (m.y + m.h / 2) };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grabbing');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toStage(e);
    if (drag) { S.camPos = { x: (p.x - drag.dx) / W, y: (p.y - drag.dy) / H }; return; }
    canvas.classList.toggle('grab', !!hit(p));
    canvas.classList.toggle('zoomable', !!zoomable(p));
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('grabbing');
    // store the clamped position so the next drag starts where the element really is
    if (S.movable) S.camPos = { x: (S.movable.x + S.movable.w / 2) / W, y: (S.movable.y + S.movable.h / 2) / H };
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!hit(toStage(e))) return;
    e.preventDefault();
    S.camSize = clamp(S.camSize - Math.sign(e.deltaY) * 0.015, 0.1, 0.5);
    $('camSize').value = S.camSize;
  }, { passive: false });

  // ---------------------------------------------------------------- main loop
  // setInterval rather than requestAnimationFrame: rAF stops when the window is covered,
  // which would freeze the recording while the user works in another app.
  const levels = new Uint8Array(analyser.fftSize);
  setInterval(() => {
    draw();
    const now = performance.now();
    if (recState === 'recording') { elapsed += now - lastTick; lastTick = now; $('recLabel').textContent = fmt(elapsed); }
    const t = S.timer;
    if (t.running) {
      t.left -= now - t.last; t.last = now;
      if (t.left <= 0) { t.left = 0; t.running = false; t.doneAt = now; }
      paintTimer();
    }
    let peak = 0;
    if (micNode && !S.muted) {
      analyser.getByteTimeDomainData(levels);
      for (let i = 0; i < levels.length; i++) peak = Math.max(peak, Math.abs(levels[i] - 128));
    }
    $('micLevel').style.width = Math.min(100, peak * 1.6) + '%';
  }, 1000 / FPS);

  (async () => {
    paintIcons();
    setTab('present');
    setRecUI();
    paintTimer();
    updateContentUI();
    loadVideos();
    await startCamera();
    await startMic();
    await fillDevices().catch(() => {});
    navigator.mediaDevices.addEventListener('devicechange', () => fillDevices().catch(() => {}));
  })();
})();
