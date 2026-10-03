/* Floating remote: sends commands to the studio window and mirrors its state. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (...cmd) => api.sendCommand(cmd);

  paintIcons();
  const layoutButtons = LAYOUTS.map((l) => {
    const b = document.createElement('button');
    b.innerHTML = `<svg viewBox="0 0 48 30">${l.icon}</svg>`;
    b.title = l.name; b.setAttribute('aria-label', l.name);
    b.onclick = () => send('layout', l.id);
    $('layouts').appendChild(b);
    return b;
  });

  $('close').onclick = () => api.closeRemote();
  $('mute').onclick = () => send('mute');
  $('react').onclick = () => send('react', '👏');
  $('timer').onclick = () => send('timer');
  $('zoom').onclick = () => send('zoom');
  $('share').onclick = () => send('share');
  $('stopShare').onclick = () => send('stopShare');

  let wasMuted = null;
  api.onState((s) => {
    $('preview').src = s.preview;
    $('sourceName').textContent = s.source || 'Choose a screen';
    $('stopShare').hidden = !s.source;
    $('zoom').classList.toggle('active', s.zoom);
    $('timer').classList.toggle('active', s.timer);
    $('mute').classList.toggle('active', !s.muted);
    if (s.muted !== wasMuted) { $('mute').firstElementChild.innerHTML = ICONS[s.muted ? 'micOff' : 'mic']; wasMuted = s.muted; }
    layoutButtons.forEach((b, i) => b.classList.toggle('active', LAYOUTS[i].id === s.layout));
  });
})();
