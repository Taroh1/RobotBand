import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DemoAudio } from '../public/audio.js';
import { createCommand } from '../public/engine.js';
import { createStarterSong } from '../public/starter-song.js';

let importSequence = 0;
const storageKey = 'robot-band-song-v1';

// These are plain JS test doubles, not a browser implementation. They exercise
// application event wiring, persistence and cancellation without opening a GUI,
// creating an AudioContext, enumerating MIDI hardware or making network calls.
class FakeElement {
  constructor(tagName, allElements) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.selectors = new Map();
    this.className = '';
    this.value = '';
    this.textContent = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.contains(name);
        if (enabled) this.classList.add(name);
        else this.classList.remove(name);
        return enabled;
      },
    };
    this.allElements = allElements;
    allElements.push(this);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  get lastChild() { return this.children.at(-1); }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback); this.listeners.set(type, listeners);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback({ target: this, preventDefault() {}, ...event });
  }
  setPointerCapture() {}
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new FakeElement('span', this.allElements));
    return this.selectors.get(selector);
  }
  click() { return this.onclick?.({ target: this }); }
}

async function appHarness(t, savedSong) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const allElements = [];
  const document = new FakeElement('document', allElements);
  document.createElement = tag => new FakeElement(tag, allElements);
  document.getElementById = id => allElements.find(element => element.id === id) ?? null;
  document.hidden = false;
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const element = document.createElement(match[1]);
    element.id = match[3];
    element.value = /\bvalue="([^"]*)"/.exec(match[2])?.[1] ?? '';
    element.disabled = /\bdisabled\b/.test(match[2]);
    element.hidden = /\bhidden\b/.test(match[2]);
  }
  document.getElementById('loop-bars').value = '2';
  document.getElementById('background-play').checked = true;
  const window = new FakeElement('window', allElements);
  window.location = { reload() {} };
  const store = new Map(savedSong ? [[storageKey, JSON.stringify(savedSong)]] : []);
  const requests = [], audioCalls = [], stopped = [], blobs = [], eventSources = [];
  let audioNow = 0;
  let audioInstance;
  t.mock.method(DemoAudio.prototype, 'enable', async function () {
    audioInstance = this;
    this.context = { get currentTime() { return audioNow; }, state: 'running' };
    this.enabled = true;
    return true;
  });
  t.mock.method(DemoAudio.prototype, 'play', function (key, command, options = {}) {
    audioCalls.push({ key, command, options });
    if (!this.enabled) return false;
    this.voices.set(key, { sources: [] });
    return true;
  });
  t.mock.method(DemoAudio.prototype, 'stop', function (key, options) {
    stopped.push({ key, options }); this.voices.delete(key);
  });
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:fake-song'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const fetch = async (url, options = {}) => {
    const input = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, input });
    const data = url === '/api/command'
      ? { accepted: true, event: createCommand({ ...input, now: 1 }) }
      : url === '/api/stop' ? { events: [] } : { mode: 'simulation' };
    return { ok: true, status: 200, async json() { return data; } };
  };
  class FakeEventSource {
    constructor(url) { this.url = url; eventSources.push(this); }
    emit(command) { this.onmessage?.({ data: JSON.stringify(command) }); }
    close() { this.closed = true; }
  }
  const overrides = {
    document, window, fetch, EventSource: FakeEventSource,
    navigator: { sendBeacon() { return true; } },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  };
  const original = new Map(Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await import(`../public/app.js?integration=${++importSequence}`);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  await flush();
  return {
    element: id => document.getElementById(id),
    pad: note => document.getElementById('pad-grid').children.find(pad => pad.dataset.note === note),
    track: index => document.getElementById('loop-tracks').children[index],
    song: () => JSON.parse(store.get(storageKey)),
    requests, audioCalls, stopped, blobs, eventSources, flush,
    blur() { window.emit('blur'); },
    hide() { document.hidden = true; document.emit('visibilitychange'); },
    get audio() { return audioInstance; },
    setTime(value) { audioNow = value; },
    async advance(seconds) { audioNow += seconds; t.mock.timers.tick(Math.round(seconds * 1000)); await flush(); },
  };
}

test('three physical robot cards coexist with four musical loop tracks and legend entries', async t => {
  const app = await appHarness(t);
  const cards = app.element('robots').children;
  assert.equal(cards.length, 3);
  assert.ok(cards.every(card => card.classList.contains('robot-card')));
  assert.deepEqual(cards.map(card => card.id), ['robot-bot-1', 'robot-bot-2', 'robot-bot-3']);
  assert.equal(app.element('robot-vocals'), null);
  assert.equal(app.element('loop-tracks').children.length, 4);
  assert.equal(app.element('legend').children.length, 4);
});

test('an unassigned vocal SSE event never creates or animates a fourth robot', async t => {
  const app = await appHarness(t);
  const stream = app.eventSources.find(source => source.url === '/api/stream');
  assert.ok(stream);
  const cards = [...app.element('robots').children];
  const before = cards.map(card => ({
    id: card.id, className: card.className, role: card.dataset.role,
    action: card.querySelector('.robot-action').textContent,
    duration: card.style['--duration'],
  }));
  stream.emit({
    ...createCommand({ note: 15, source: 'loop', now: 1 }),
    role: 'vocals', robot_id: null,
  });
  await app.flush();
  assert.equal(app.element('robots').children.length, 3);
  assert.equal(app.element('robot-vocals'), null);
  assert.ok(cards.every(card => !card.classList.contains('live')));
  assert.deepEqual(cards.map(card => ({
    id: card.id, className: card.className, role: card.dataset.role,
    action: card.querySelector('.robot-action').textContent,
    duration: card.style['--duration'],
  })), before);

  // The stream remains functional for an assigned role, proving the ignored
  // vocal trigger did not merely exercise a disconnected test double.
  stream.emit({
    ...createCommand({ note: 11, source: 'loop', now: 2 }),
    role: 'keyboard', robot_id: 'bot-3',
  });
  assert.ok(app.element('robot-bot-3').classList.contains('live'));
  assert.equal(app.element('robot-bot-3').querySelector('.robot-action').textContent, 'keys_low');
  assert.ok(!app.element('robot-bot-1').classList.contains('live'));
  assert.ok(!app.element('robot-bot-2').classList.contains('live'));
});

test('loops keep driving SimRobot across window changes; opting out and stop still cancel playback', async t => {
  const app = await appHarness(t);
  await app.element('song-example').onclick();
  app.blur();
  app.hide();
  await app.flush();
  assert.match(app.element('loop-play').textContent, /stoppen/);
  app.element('background-play').checked = false;
  app.blur();
  await app.flush();
  assert.match(app.element('loop-play').textContent, /starten/);
  assert.ok(app.requests.some(request => request.url === '/api/stop'));
});

test('example song enables audio, schedules playback and stops all future loop audio', async t => {
  const app = await appHarness(t);
  await app.element('song-example').onclick();
  await app.flush();
  assert.equal(app.element('audio').getAttribute('aria-pressed'), 'true');
  assert.match(app.element('loop-play').textContent, /stoppen/);
  assert.equal(app.song().events.length, createStarterSong().events.length);
  assert.ok(app.audioCalls.some(call => call.key.startsWith('loop:')));
  assert.ok(app.audio.voices.size > 0);
  await app.element('loop-play').onclick();
  await app.flush();
  assert.equal(app.audio.voices.size, 0);
  const callsAtStop = app.audioCalls.length;
  await app.advance(1);
  assert.equal(app.audioCalls.length, callsAtStop);
  assert.match(app.element('loop-play').textContent, /starten/);
  assert.ok(app.requests.some(request => request.url === '/api/stop'));
});

test('pad pointer gestures record gates, autosave and overdub the same loop slot', async t => {
  const app = await appHarness(t);
  await app.element('loop-record').onclick();
  assert.equal(app.element('loop-record').getAttribute('aria-pressed'), 'true');
  app.setTime(0.58); // Transport starts at audio time 0.08: beat 1 at 120 BPM.
  app.pad(11).emit('pointerdown', { button: 0, pointerId: 1 });
  app.setTime(0.83);
  app.pad(11).emit('pointerup', { pointerId: 1 });
  await app.flush();
  assert.deepEqual(app.song().events.map(({ note, step, duration_steps }) => ({ note, step, duration_steps })), [
    { note: 11, step: 4, duration_steps: 2 },
  ]);
  app.element('velocity').value = '60';
  app.setTime(4.58); // Same slot in the next two-bar loop.
  app.pad(11).emit('pointerdown', { button: 0, pointerId: 2 });
  app.setTime(4.83);
  app.pad(11).emit('pointerup', { pointerId: 2 });
  await app.flush();
  assert.equal(app.song().events.length, 1);
  assert.equal(app.song().events[0].velocity, 60);
  await app.element('loop-record').onclick();
  assert.equal(app.element('loop-record').getAttribute('aria-pressed'), 'false');
  assert.match(app.element('loop-play').textContent, /stoppen/);
  app.element('stop').onclick();
  await app.flush();
});

test('muting cancels lookahead audio and MIDI triggers; clear and undo retain the song', async t => {
  const app = await appHarness(t);
  await app.element('song-example').onclick();
  await app.flush();
  assert.ok([...app.audio.voices.keys()].some(key => key.startsWith('loop:keyboard:')));
  app.track(2).children[0].onclick(); // Keyboard mute.
  assert.deepEqual(app.song().muted, ['keyboard']);
  assert.ok(![...app.audio.voices.keys()].some(key => key.startsWith('loop:keyboard:')));
  await app.advance(0.08);
  assert.ok(!app.requests.some(request => request.input?.source === 'loop'
    && request.input?.type === 'on' && [11, 12, 13, 14].includes(request.input.note)));
  const mutedSong = app.song();
  app.element('loop-clear').onclick();
  await app.flush();
  assert.equal(app.song().events.length, 0);
  app.element('loop-undo').onclick();
  await app.flush();
  assert.deepEqual(app.song(), mutedSong);
  app.element('song-save').onclick();
  assert.deepEqual(JSON.parse(await app.blobs.at(-1).text()), mutedSong);
});

test('clearing a track cancels notes already scheduled in the audio lookahead', async t => {
  const app = await appHarness(t);
  await app.element('song-example').onclick();
  await app.flush();
  app.track(2).children[2].onclick(); // Clear keyboard before first scheduled attack.
  assert.ok(!app.song().events.some(event => event.role === 'keyboard'));
  assert.ok(![...app.audio.voices.keys()].some(key => key.startsWith('loop:keyboard:')));
  await app.advance(0.08);
  assert.ok(!app.requests.some(request => request.input?.source === 'loop'
    && request.input?.type === 'on' && [11, 12, 13, 14].includes(request.input.note)));
});

test('saved songs restore on startup and invalid imports preserve the saved song', async t => {
  const initial = createStarterSong({ bpm: 135 });
  const app = await appHarness(t, initial);
  assert.equal(app.element('bpm').value, 135);
  assert.match(app.element('loop-status').textContent, /letzter Song/);
  const invalid = { ...initial, events: [{ ...initial.events[0], note: 91 }] };
  app.element('song-file').files = [{ size: 100, async text() { return JSON.stringify(invalid); } }];
  await app.element('song-file').onchange();
  assert.deepEqual(app.song(), initial);
  assert.match(app.element('notice').textContent, /nicht geladen/);
  const replacement = createStarterSong({ bpm: 90 });
  app.element('song-file').files = [{ size: 100, async text() { return JSON.stringify(replacement); } }];
  await app.element('song-file').onchange();
  await app.flush();
  assert.deepEqual(app.song(), replacement);
  assert.equal(app.element('bpm').value, 90);
  assert.match(app.element('loop-play').textContent, /starten/);
});
