/* Icons and layout thumbnails shared by the studio window and the floating remote. */
(() => {
  'use strict';

  const person = (cx, by, s) =>
    `<circle cx="${cx}" cy="${by - 12.5 * s}" r="${4.2 * s}" class="fg"/><path d="M${cx - 9 * s} ${by}a${9 * s} ${8 * s} 0 0 1 ${18 * s} 0z" class="fg"/>`;
  const dots = (x, y) => `<path d="M${x} ${y}h1.4m1.4 0h1.4m1.4 0h1.4" class="dots"/>`;
  const card = (x, y, w, h, body = '') => `<svg x="${x}" y="${y}" width="${w}" height="${h}"><rect width="${w}" height="${h}" class="bg"/>${body}</svg>`;

  window.LAYOUTS = [
    { id: 'camera', name: 'Camera only',    icon: card(0, 0, 48, 30, person(24, 30, 1.25)) },
    { id: 'away',   name: 'Camera off',     icon: card(0, 0, 48, 30, `<g opacity=".35">${person(24, 30, 1.25)}</g><path d="M0 0 48 30" class="slash"/>`) },
    { id: 'screen', name: 'Screen only',    icon: card(0, 0, 48, 30, dots(4, 4.5)) },
    { id: 'side',   name: 'Side by side',   icon: card(0, 0, 15, 30, person(7.5, 30, 0.72)) + card(17, 0, 31, 30, dots(3.5, 4.5)) },
    { id: 'split',  name: 'Split',          icon: card(0, 0, 23, 30, person(11.5, 30, 0.95)) + card(25, 0, 23, 30, dots(3.5, 4.5)) },
    { id: 'bubble', name: 'Picture in picture', icon: card(0, 0, 48, 30, dots(4, 4.5)) + `<rect x="3.5" y="15.5" width="11" height="11" rx="1.5" class="pip"/><svg x="3.5" y="15.5" width="11" height="11">${person(5.5, 11, 0.42)}</svg>` },
  ];

  const stroke = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  window.ICONS = {
    present: stroke('<rect x="3" y="5" width="18" height="12" rx="2"/><circle cx="15.5" cy="10" r="1.6"/><path d="M12.5 14.5c.7-1.5 5.3-1.5 6 0M8 21h8"/>'),
    videos: stroke('<rect x="3" y="9" width="14" height="11" rx="2"/><path d="M7 5.5h11.5a2 2 0 0 1 2 2V16M8.5 12.5v4l3.5-2z"/>'),
    camera: stroke('<rect x="3" y="7" width="12" height="10" rx="2"/><path d="m15 11 6-3v8l-6-3z"/>'),
    themes: stroke('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/>'),
    react: stroke('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 10h.01M15 10h.01"/>'),
    timer: stroke('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 3h5"/>'),
    settings: stroke('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    mic: stroke('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>'),
    micOff: stroke('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M4 3l16 18"/>'),
    zoom: stroke('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M11 8.5v5M8.5 11h5"/>'),
    swap: stroke('<rect x="3" y="4" width="9" height="7" rx="1.5"/><rect x="12" y="13" width="9" height="7" rx="1.5"/><path d="M16 5h2.5a1.5 1.5 0 0 1 1.5 1.5V10M8 19H5.5A1.5 1.5 0 0 1 4 17.5V14"/>'),
    stop: stroke('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9.5 9.5 5 5m0-5-5 5"/>'),
    star: stroke('<circle cx="12" cy="12" r="9"/><path d="m12 7.5 1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/>'),
    background: stroke('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.3h18M3 14.7h18M9 4v16M15 4v16"/>'),
    tag: stroke('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="1.8"/><path d="M5.5 16c.6-1.8 5.4-1.8 6 0M14 10h4M14 14h4"/>'),
    pointer: stroke('<path d="M20 4 4 10.5l6.5 3 3 6.5z"/>'),
    shape: stroke('<circle cx="9" cy="9" r="5.5"/><rect x="11" y="11" width="9.5" height="9.5" rx="2"/>'),
    record: stroke('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
    restart: stroke('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 3.5v3.5H8"/>'),
    trim: stroke('<rect x="8" y="6" width="8" height="12" rx="1"/><path d="M3 12h2M19 12h2M5 9v6M19 9v6"/>'),
    export: stroke('<path d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5M5 15v4h14v-4"/>'),
    search: stroke('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    remote: stroke('<rect x="7" y="3" width="10" height="18" rx="3"/><circle cx="12" cy="8" r="1.8"/><path d="M12 13v.01M12 16.5v.01"/>'),
    slides: stroke('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>'),
    chevron: stroke('<path d="m7 10 5 5 5-5"/>'),
    pause: stroke('<path d="M9 6v12M15 6v12"/>'),
    close: stroke('<path d="m6 6 12 12M18 6 6 18"/>'),
  };

  // Appearance: chosen in Settings, shared by both windows through localStorage.
  window.THEMES = [
    { id: 'light', name: 'Light', bar: '#f2f5f3', symbol: '#14201a' },
    { id: 'slate', name: 'Slate', bar: '#14171c', symbol: '#eef1f5' },
    { id: 'navy', name: 'Navy', bar: '#0c1424', symbol: '#eef2fb' },
  ];
  window.currentTheme = () => THEMES.find((t) => t.id === localStorage.getItem('theme')) || THEMES[0];
  const applyTheme = () => { document.documentElement.dataset.theme = currentTheme().id; };
  applyTheme();
  window.addEventListener('storage', applyTheme);

  // <i data-icon="mic"></i> anywhere in the markup becomes the icon.
  window.paintIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
})();
