/* Onstage Camera: feeds stage frames to the UnityCapture DirectShow driver (native/vcam), which
   call apps list as a camera. The driver creates a named mutex, two events and a shared memory
   block when an app opens the camera; we attach to those and copy RGBA frames in.
   Layout and names come from UnityCapture's Source/shared.inl. Windows only. */
const SYNCHRONIZE = 0x00100000, EVENT_MODIFY_STATE = 0x0002, FILE_MAP_WRITE = 0x0002;
const WAIT_OBJECT_0 = 0, WAIT_ABANDONED = 0x80;
const HEADER_BYTES = 32;            // maxSize, width, height, stride, format, resizemode, mirrormode, timeout
const IDLE_MS = 3000;               // no app asked for a frame this long: treat the camera as closed

let k = null;                       // kernel32 functions, loaded on first use
function kernel() {
  if (k) return k;
  const koffi = require('koffi');
  const lib = koffi.load('kernel32.dll');
  k = {
    OpenMutexA: lib.func('uintptr_t __stdcall OpenMutexA(uint32_t access, int inherit, const char *name)'),
    CreateEventA: lib.func('uintptr_t __stdcall CreateEventA(void *attrs, int manual, int initial, const char *name)'),
    OpenEventA: lib.func('uintptr_t __stdcall OpenEventA(uint32_t access, int inherit, const char *name)'),
    OpenFileMappingA: lib.func('uintptr_t __stdcall OpenFileMappingA(uint32_t access, int inherit, const char *name)'),
    MapViewOfFile: lib.func('uintptr_t __stdcall MapViewOfFile(uintptr_t mapping, uint32_t access, uint32_t offHigh, uint32_t offLow, size_t bytes)'),
    UnmapViewOfFile: lib.func('int __stdcall UnmapViewOfFile(uintptr_t view)'),
    CloseHandle: lib.func('int __stdcall CloseHandle(uintptr_t handle)'),
    WaitForSingleObject: lib.func('uint32_t __stdcall WaitForSingleObject(uintptr_t handle, uint32_t ms)'),
    ReleaseMutex: lib.func('int __stdcall ReleaseMutex(uintptr_t handle)'),
    SetEvent: lib.func('int __stdcall SetEvent(uintptr_t handle)'),
    write: lib.func('__stdcall', 'RtlMoveMemory', 'void', ['uintptr_t', 'void *', 'size_t']),
    read: lib.func('__stdcall', 'RtlMoveMemory', 'void', ['void *', 'uintptr_t', 'size_t']),
  };
  return k;
}

let link = null;                    // { mutex, want, sent, mapping, view, maxSize } while attached
let lastWanted = 0;

// The handshake takes two steps. The driver makes the mutex, then waits for our "want" event before
// it makes the "sent" event and the memory block. So we open the mutex, create "want" and keep both
// (`half`) until the driver has finished its side.
let half = null;                    // { mutex, want, since }

function detach() {
  if (!link && !half) return;
  for (const h of link ? [link.mapping, link.sent, link.want, link.mutex] : half ? [half.want, half.mutex] : []) k.CloseHandle(h);
  if (link) k.UnmapViewOfFile(link.view);
  link = half = null;
}

// Attaches if an app currently has the camera open. Returns whether we are attached.
function attach() {
  if (process.platform !== 'win32') return false;
  if (link) {
    if (Date.now() - lastWanted < IDLE_MS) return true;
    detach();                       // the app closed the camera; our handles alone were keeping the objects alive
  }
  const K = kernel();
  if (half && Date.now() - half.since > IDLE_MS) detach();   // driver never answered: the app is gone
  if (!half) {
    const mutex = K.OpenMutexA(SYNCHRONIZE, 0, 'UnityCapture_Mutx');
    if (!mutex) return false;
    const want = K.CreateEventA(null, 0, 0, 'UnityCapture_Want');
    if (!want) { K.CloseHandle(mutex); return false; }
    half = { mutex, want, since: Date.now() };
  }
  const sent = K.OpenEventA(EVENT_MODIFY_STATE, 0, 'UnityCapture_Sent');
  const mapping = sent ? K.OpenFileMappingA(FILE_MAP_WRITE, 0, 'UnityCapture_Data') : 0;
  const view = mapping ? K.MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 0) : 0;
  if (!view) {
    for (const h of [mapping, sent]) if (h) K.CloseHandle(h);
    return false;
  }
  const head = Buffer.alloc(4);
  K.read(head, view, 4);
  link = { ...half, sent, mapping, view, maxSize: head.readUInt32LE(0) };
  half = null;
  lastWanted = Date.now();
  return true;
}

// rgba: Buffer of width * height * 4 bytes, bottom row first (the driver flips it, as Unity textures are bottom-up).
function send(rgba, width, height) {
  if (!link || rgba.length > link.maxSize) return false;
  const lock = k.WaitForSingleObject(link.mutex, 100);
  if (lock !== WAIT_OBJECT_0 && lock !== WAIT_ABANDONED) return false;
  const head = Buffer.alloc(HEADER_BYTES - 4);
  [width, height, width, 0 /* 8-bit RGBA */, 1 /* driver scales to what the app asked for */, 0, 1000].forEach((v, i) => head.writeInt32LE(v, i * 4));
  const base = BigInt(link.view);
  k.write(base + 4n, head, head.length);
  k.write(base + BigInt(HEADER_BYTES), rgba, rgba.length);
  k.ReleaseMutex(link.mutex);
  k.SetEvent(link.sent);
  if (k.WaitForSingleObject(link.want, 0) === WAIT_OBJECT_0) lastWanted = Date.now();
  return true;
}

module.exports = { attach, send, detach };
