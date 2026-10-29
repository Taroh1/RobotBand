import { ROLES, padInfo, decodeMidi, createCommand as createRoleCommand, programmerMode } from './engine.js';
import { ROBOTS, robotForRole, rolesForRobot } from './robots.js';
import { DemoAudio } from './audio.js';
import { pickMidiPort, midiPacketInfo } from './midi-ports.js';
import { LoopRecorder } from './looper.js';
import { LoopTransport } from './transport.js';
import { createStarterSong } from './starter-song.js';

const $ = id => document.getElementById(id);
const audio = new DemoAudio();
const roleById = Object.fromEntries(ROLES.map(role => [role.id, role]));
function createCommand(input) {
  const command = createRoleCommand(input);
  return command ? { ...command, role: command.robot, robot_id: robotForRole(command.robot)?.id ?? null } : null;
}
const held = new Map(), pads = new Map(), robotTimers = new Map();
const commands = [], triggerTimes = new Map();
const sessionStart = performance.now();
let count = 0, queue = Promise.resolve(), pending = 0, generation = 0;
let midi = null, selectedInput = null, selectedOutput = null, programmedOutput = null;
let noticeTimer;
let midiCount = 0, bindRevision = 0;
let browserStream;
const recorder = new LoopRecorder();
const loopActive = new Map(), loopTimers = new Set();
const roleEpochs = new Map();
const trackCells = new Map();
const transport = new LoopTransport({ now: () => audio.currentTime, onStep: scheduleStep });
let loopInterval = null, loopEpoch = 0, clickEnabled = false, undoSong = null;
const songStorageKey = 'robot-band-song-v1';

const noteName = pitch => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const bpm = () => {
  const value = Number($('bpm').value);
  return Number.isFinite(value) ? Math.max(40, Math.min(240, value || 120)) : 120;
};
const velocity = () => Number($('velocity').value);
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 4200);
}

function robotSvg(role) {
  const instrument = {
    drums: '<ellipse cx="70" cy="101" rx="29" ry="7" fill="#262f26" stroke="currentColor"/><path d="M42 98v17m56-17v17" stroke="currentColor"/><path d="M29 80l17 16m65-16L94 96" stroke="currentColor" stroke-width="2"/>',
    guitar: '<ellipse cx="83" cy="93" rx="16" ry="20" fill="#29332b" stroke="currentColor" transform="rotate(35 83 93)"/><path d="M86 87l22-27" stroke="currentColor" stroke-width="5"/><circle cx="81" cy="94" r="5" fill="#111a15"/>',
    keyboard: '<path d="M30 91h80v15H30z" fill="#b7c5b0" stroke="currentColor"/><path d="M40 91v13m10-13v13m10-13v13m10-13v13m10-13v13m10-13v13m10-13v13" stroke="#263427"/><path d="M38 106l-4 13m68-13l4 13" stroke="currentColor"/>',
    vocals: '<path d="M100 72v43m-9 2h18" stroke="currentColor" stroke-width="2"/><rect x="96" y="61" width="8" height="16" rx="4" fill="#26352b" stroke="currentColor"/><path d="M110 60q10 9 0 18m5-22q15 14 0 26" fill="none" stroke="currentColor" opacity=".35"/>'
  }[role];
  return `<svg class="robot-svg" viewBox="0 0 140 130" aria-hidden="true" style="color:var(--role-color)"><ellipse cx="70" cy="120" rx="34" ry="5" fill="#101911"/><g class="body"><path d="M59 95l-4 22h12l3-19 3 19h12l-4-22" fill="#657365" stroke="#9aaa94"/><rect x="46" y="56" width="48" height="42" rx="12" fill="#657564" stroke="#a0b299"/><rect x="61" y="68" width="18" height="13" rx="3" fill="#26362a"/><circle cx="70" cy="74" r="3" fill="currentColor"/><g class="arm-left"><path d="M45 65L34 83l10 10" fill="none" stroke="#8b9c83" stroke-width="9" stroke-linecap="round"/><circle cx="44" cy="93" r="5" fill="#c4d0b6"/></g><g class="arm-right"><path d="M95 65l12 18-10 10" fill="none" stroke="#8b9c83" stroke-width="9" stroke-linecap="round"/><circle cx="97" cy="93" r="5" fill="#c4d0b6"/></g><path d="M70 16v9" stroke="#c4d0b6" stroke-width="2"/><circle cx="70" cy="14" r="3" fill="currentColor"/><rect x="46" y="26" width="48" height="31" rx="10" fill="#a0b298"/><rect x="51" y="33" width="38" height="15" rx="5" fill="#1c2d22"/><g class="eyes"><rect x="57" y="37" width="6" height="5" rx="2"/><rect x="77" y="37" width="6" height="5" rx="2"/></g><path d="M64 51h12" stroke="#4e654d" stroke-width="2"/></g>${instrument}</svg>`;
}

for (const role of ROLES) {
  const legend = document.createElement('div');
  legend.style.setProperty('--role-color', role.color);
  legend.innerHTML = `<i></i>${role.label}`;
  $('legend').append(legend);
}
for (const [index, bot] of ROBOTS.entries()) {
  const roles = rolesForRobot(bot.id);
  const role = roleById[roles[0]] ?? ROLES[0];
  const card = document.createElement('article');
  card.className = 'robot-card';
  card.id = `robot-${bot.id}`;
  card.dataset.role = role.id;
  card.style.setProperty('--role-color', role.color);
  card.innerHTML = `<div class="robot-id">BOT / 0${index + 1}</div>${robotSvg(role.id)}<div class="robot-name">${roles.map(id => roleById[id].label).join(' + ') || bot.label}</div><div class="robot-action">idle</div><div class="level-track"><i></i></div><div class="robot-note">WARTET AUF PAD</div>`;
  $('robots').append(card);
}

for (let row = 7; row >= 0; row--) for (let column = 0; column < 8; column++) {
  const note = (row + 1) * 10 + column + 1;
  const info = padInfo(note), role = roleById[info.role];
  const label = info.label;
  const pad = document.createElement('button');
  pad.className = 'pad';
  pad.dataset.note = note;
  pad.style.setProperty('--role-color', role.color);
  pad.setAttribute('aria-label', `${role.label}: ${label}, Pad ${note}`);
  pad.setAttribute('aria-pressed', 'false');
  pad.innerHTML = `<span class="pad-number">${note}</span><span>${label}</span>`;
  pad.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pad.setPointerCapture(event.pointerId);
    press(note, velocity(), 'simulator');
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(name, () => release(note, 'simulator'));
  pad.addEventListener('keydown', event => {
    if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) { event.preventDefault(); press(note, velocity(), 'simulator'); }
  });
  pad.addEventListener('keyup', event => {
    if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); release(note, 'simulator'); }
  });
  pad.addEventListener('blur', () => release(note, 'simulator'));
  pads.set(note, pad);
  $('pad-grid').append(pad);
}

function setPad(note) {
  const active = [...held.values()].some(value => value.note === note) || [...loopActive.values()].includes(note);
  pads.get(note)?.classList.toggle('active', active);
  pads.get(note)?.setAttribute('aria-pressed', String(active));
  if (programmedOutput) {
    try { programmedOutput.send([0x90, note, active ? 3 : roleById[padInfo(note).role].palette]); }
    catch { /* Disconnect is handled by statechange. */ }
  }
}

function press(note, strength, source) {
  const key = `${source}:${note}`;
  if (held.has(key)) return;
  const command = createCommand({ note, velocity: strength, bpm: bpm(), source, now: performance.now() - sessionStart });
  if (!command) return;
  held.set(key, { note, source, command });
  setPad(note);
  audio.play(key, command, { duration: command.robot === 'drums' ? null : command.robot === 'guitar' ? 2 : 60 });
  if (recorder.recording && transport.playing) {
    recorder.noteOn({ note, velocity: strength, role: command.robot, beat: transport.beat });
  }
  count++;
  $('event-count').textContent = String(count).padStart(3, '0');
  $('command-preview').textContent = JSON.stringify(command, null, 2);
  const now = performance.now();
  if (command.robot_id && now - (triggerTimes.get(command.robot_id) ?? -Infinity) < 120) {
    logEvent(command, 'Bewegung begrenzt');
    return;
  }
  if (command.robot_id) triggerTimes.set(command.robot_id, now);
  enqueue({ note, velocity: strength, bpm: bpm(), type: 'on', source }, command);
}

function release(note, source) {
  const key = `${source}:${note}`, value = held.get(key);
  if (!value) return;
  held.delete(key);
  if (recorder.recording && ![...held.values()].some(value => value.note === note)) {
    const event = recorder.noteOff({ note, beat: transport.beat });
    if (event) { renderTracks(); saveSongLocal(); }
  }
  audio.stop(key);
  setPad(note);
  enqueue({ note, velocity: 0, bpm: bpm(), type: 'off', source }, null);
}

function enqueue(input, preview, valid = () => true) {
  if (pending > 32 && input.type === 'on') { logEvent(preview, 'Bridge ausgelastet'); return; }
  const epoch = generation;
  pending++;
  queue = queue.then(async () => {
    if (epoch !== generation || !valid()) return;
    const started = performance.now();
    const response = await fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    $('last-latency').textContent = Math.round(performance.now() - started);
    $('bridge-status').textContent = 'Bereit';
    if (result.accepted) {
      commands.push(result.event);
      if (commands.length > 2000) commands.shift();
      if (preview) logEvent(preview, result.delivery === 'audio_only' ? 'Audio · ohne Bot' : 'Bridge empfangen');
    } else if (preview) logEvent(preview, 'Bewegung begrenzt');
  }).catch(error => {
    $('bridge-status').textContent = 'Offline';
    if (preview) logEvent(preview, 'Nicht zugestellt');
    $('log-state').textContent = `Bridge: ${error.message}`;
  }).finally(() => { pending--; });
}

function logEvent(command, delivery) {
  if (!command) return;
  const li = document.createElement('li');
  li.style.setProperty('--role-color', roleById[command.robot].color);
  const secs = ((performance.now() - sessionStart) / 1000).toFixed(1).padStart(5, '0');
  li.innerHTML = `<span class="log-time">${secs}s</span><span class="log-role">${roleById[command.robot].label}</span><span class="log-message">${command.animation} · ${command.chord || noteName(command.pitch)}</span><span class="log-delivery">${delivery}</span>`;
  $('event-log').prepend(li);
  while ($('event-log').children.length > 24) $('event-log').lastChild.remove();
  $('log-state').textContent = 'LIVE · letzte 24 Trigger';
}

function botId(value) { return ROBOTS.some(bot => bot.id === value) ? value : robotForRole(value)?.id ?? null; }
function idleRobot(role) {
  const id = botId(role);
  if (!id) return;
  const card = $(`robot-${id}`);
  if (!card) return;
  card.classList.remove('live');
  card.querySelector('.robot-action').textContent = 'idle';
  card.querySelector('.level-track i').style.width = '0%';
  card.querySelector('.robot-note').textContent = 'WARTET AUF PAD';
}

browserStream = new EventSource('/api/stream');
browserStream.onmessage = message => {
    const command = JSON.parse(message.data);
    const role = roleById[command.role ?? command.robot];
    const robotId = command.robot_id;
    if (!robotId) return; // Musical roles may remain audio-only; no fourth robot.
    if (command.type === 'stop') {
      clearTimeout(robotTimers.get(robotId)); idleRobot(robotId); return;
    }
    if (!role) return;
    if (command.type === 'trigger') {
      const card = $(`robot-${robotId}`);
      if (!card) return;
      card.dataset.role = role.id;
      clearTimeout(robotTimers.get(robotId));
      card.classList.remove('live');
      void card.offsetWidth;
      card.style.setProperty('--duration', `${command.duration_ms}ms`);
      card.style.setProperty('--tone-shift', `${(command.pitch - 60) / 3}px`);
      card.style.setProperty('--stroke-angle', `${10 + command.intensity * 35}deg`);
      card.classList.add('live');
      card.querySelector('.robot-action').textContent = command.animation;
      card.querySelector('.level-track i').style.width = `${command.intensity * 100}%`;
      card.querySelector('.robot-note').textContent = `${command.chord || noteName(command.pitch)} · ${command.duration_ms} MS`;
      $('band-status').textContent = `${role.label} spielt ${command.chord || noteName(command.pitch)}.`;
      robotTimers.set(robotId, setTimeout(() => idleRobot(robotId), command.duration_ms));
    }
    // Release is scoped to a pad. One-shot animations expire independently.
};
browserStream.onerror = () => {
  $('bridge-status').textContent = 'Offline';
  for (const bot of ROBOTS) idleRobot(bot.id);
};

function panic(showNotice = false) {
  generation++;
  stopLoop();
  for (const value of held.values()) { audio.stop(`${value.source}:${value.note}`); }
  const notes = [...held.values()].map(value => value.note);
  held.clear();
  for (const note of notes) setPad(note);
  audio.stopAll();
  triggerTimes.clear();
  for (const bot of ROBOTS) { clearTimeout(robotTimers.get(bot.id)); idleRobot(bot.id); }
  $('band-status').textContent = 'Alle Demo-Bewegungen gestoppt.';
  queue = queue.then(async () => {
    const response = await fetch('/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true, signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('Stop nicht bestätigt');
    const result = await response.json();
    commands.push(...result.events);
  }).catch(() => { $('bridge-status').textContent = 'Stop unbestätigt'; });
  if (showNotice) notice('Demo gestoppt. Dies ist kein Hardware-Not-Aus.');
}

$('stop').onclick = () => panic(true);
document.addEventListener('keydown', event => { if (event.code === 'Escape') panic(true); });
function leavePerformanceWindow() {
  // Release manual gates, but allow a loop to drive SimRobot while its window
  // is in front. Page close, USB loss and explicit stop still stop everything.
  for (const { note, source } of [...held.values()]) release(note, source);
  if (!$('background-play').checked && transport.playing) panic();
}
window.addEventListener('blur', leavePerformanceWindow);
document.addEventListener('visibilitychange', () => { if (document.hidden) leavePerformanceWindow(); });
window.addEventListener('pagehide', () => {
  browserStream.close();
  navigator.sendBeacon('/api/stop', new Blob(['{}'], { type: 'application/json' }));
  restoreLiveMode();
});
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });

$('velocity').oninput = () => { $('velocity-label').textContent = velocity(); };
$('bpm').onchange = () => { $('bpm').value = bpm(); saveSongLocal(); };
$('audio').onclick = async () => {
  try {
    const enabled = await audio.toggle();
    $('audio').setAttribute('aria-pressed', String(enabled));
    $('audio').textContent = enabled ? '♪ Ton ausschalten' : '♪ Ton einschalten';
  } catch (error) { notice(`Audio nicht verfügbar: ${error.message}`); }
};
$('export').onclick = () => {
  const content = { schema_version: 1, mode: 'local_demo', exported_at: new Date().toISOString(),
    physical_robot_ack: false, events: commands, note: 'Maximal 2000 letzte empfangene Pad-Ereignisse. Keine Echtzeit-Wiedergabe.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'launchpad-robot-session.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// Music production: input is heard live; finalized notes repeat on a 16th grid.
async function enableAudio() {
  await audio.enable();
  $('audio').setAttribute('aria-pressed', 'true');
  $('audio').textContent = '♪ Ton ausschalten';
}

function rememberUndo() {
  undoSong = recorder.serialize({ bpm: bpm() });
  $('loop-undo').disabled = false;
}

function saveSongLocal() {
  try {
    localStorage.setItem(songStorageKey, JSON.stringify(recorder.serialize({ bpm: bpm() })));
    $('song-storage').textContent = 'Song in diesem Browser gespeichert · JSON für ein Backup nutzen.';
  } catch { $('song-storage').textContent = 'Browser-Speicher nicht verfügbar. Bitte Song-Datei speichern.'; }
}

function cancelRolePlayback(role) {
  roleEpochs.set(role, (roleEpochs.get(role) ?? 0) + 1);
  for (const [key, note] of [...loopActive]) if (padInfo(note).role === role) {
    audio.stop(key, { immediate: true }); loopActive.delete(key); setPad(note);
  }
  for (const key of [...audio.voices.keys()]) if (String(key).startsWith(`loop:${role}:`)) audio.stop(key, { immediate: true });
  clearTimeout(robotTimers.get(botId(role))); idleRobot(role);
}

function renderTracks() {
  trackCells.clear();
  $('loop-tracks').replaceChildren();
  for (const role of ROLES) {
    const events = recorder.events.filter(event => event.role === role.id);
    const row = document.createElement('div');
    row.className = `loop-track${recorder.muted.has(role.id) ? ' track-muted' : ''}`;
    row.style.setProperty('--role-color', role.color);
    row.style.minWidth = `${Math.max(520, recorder.steps * 14 + 165)}px`;
    const label = document.createElement('button');
    label.className = 'track-toggle';
    label.setAttribute('aria-pressed', String(recorder.muted.has(role.id)));
    label.setAttribute('aria-label', `${role.label} ${recorder.muted.has(role.id) ? 'einschalten' : 'stummschalten'}`);
    label.textContent = `${recorder.muted.has(role.id) ? '○' : '●'} ${role.label}`;
    label.onclick = () => {
      recorder.toggleMute(role.id);
      cancelRolePlayback(role.id);
      renderTracks(); saveSongLocal();
    };
    const grid = document.createElement('div');
    grid.className = 'track-steps';
    grid.style.gridTemplateColumns = `repeat(${recorder.steps}, minmax(8px, 1fr))`;
    const cells = [];
    for (let step = 0; step < recorder.steps; step++) {
      const cell = document.createElement('span');
      cell.className = `track-step${step % recorder.stepsPerBeat === 0 ? ' beat-start' : ''}${step % (recorder.stepsPerBeat * recorder.beatsPerBar) === 0 ? ' bar-start' : ''}`;
      const notes = events.filter(event => event.step === step);
      const sustaining = events.some(event => {
        const delta = (step - event.step + recorder.steps) % recorder.steps;
        return delta > 0 && delta < event.duration_steps;
      });
      if (notes.length) cell.classList.add('has-note');
      else if (sustaining) cell.classList.add('has-gate');
      cell.title = notes.length ? notes.map(event => padInfo(event.note).label).join(' + ') : `Schritt ${step + 1}`;
      cell.setAttribute('aria-hidden', 'true');
      grid.append(cell); cells.push(cell);
    }
    const clear = document.createElement('button');
    clear.className = 'track-clear'; clear.textContent = '×';
    clear.setAttribute('aria-label', `${role.label} Spur leeren`);
    clear.onclick = () => { rememberUndo(); recorder.clear(role.id); cancelRolePlayback(role.id); renderTracks(); saveSongLocal(); };
    row.append(label, grid, clear);
    $('loop-tracks').append(row); trackCells.set(role.id, cells);
  }
  $('loop-bars').value = recorder.bars;
}

function updateTransportUI() {
  $('loop-play').textContent = transport.playing ? '■ Loop stoppen' : '▶ Loop starten';
  $('loop-record').textContent = recorder.recording ? '● Aufnahme beenden' : '● Aufnehmen';
  $('loop-record').setAttribute('aria-pressed', String(recorder.recording));
  $('record-state').textContent = recorder.recording ? 'AUFNAHME / OVERDUB' : transport.playing ? 'LOOP LÄUFT' : 'BEREIT';
  $('record-state').classList.toggle('recording', recorder.recording);
  $('bpm').disabled = transport.playing;
  $('loop-bars').disabled = transport.playing;
}

function finishRecording() {
  if (!recorder.recording) return;
  for (const value of held.values()) recorder.noteOff({ note: value.note, beat: transport.beat });
  recorder.stopRecording();
  renderTracks(); saveSongLocal();
}

function stopLoop() {
  finishRecording();
  loopEpoch++;
  transport.stop();
  clearInterval(loopInterval); loopInterval = null;
  for (const timer of loopTimers) clearTimeout(timer);
  loopTimers.clear();
  for (const key of [...audio.voices.keys()]) if (String(key).startsWith('loop:') || String(key).startsWith('metronome:')) audio.stop(key, { immediate: true });
  const notes = [...loopActive.values()]; loopActive.clear();
  for (const note of notes) setPad(note);
  $('loop-position').textContent = '1.1';
  for (const cells of trackCells.values()) for (const cell of cells) cell.classList.remove('playhead');
  updateTransportUI();
}

function startLoop() {
  if (transport.playing) return;
  transport.stepsPerBeat = recorder.stepsPerBeat;
  transport.start(bpm());
  loopInterval = setInterval(() => {
    if (audio.context?.state !== 'running') { panic(); return; }
    transport.pump();
    const step = Math.floor(transport.beat * recorder.stepsPerBeat) % recorder.steps;
    const bar = Math.floor(step / (recorder.stepsPerBeat * recorder.beatsPerBar)) + 1;
    const beat = Math.floor(step / recorder.stepsPerBeat) % recorder.beatsPerBar + 1;
    $('loop-position').textContent = `${bar}.${beat}`;
    for (const cells of trackCells.values()) cells.forEach((cell, index) => cell.classList.toggle('playhead', index === step));
  }, 25);
  transport.pump(); updateTransportUI();
}

function later(callback, when) {
  const epoch = loopEpoch;
  const timer = setTimeout(() => {
    loopTimers.delete(timer);
    if (epoch === loopEpoch && transport.playing) callback();
  }, Math.max(0, (when - audio.currentTime) * 1000));
  loopTimers.add(timer);
}

function scheduleStep(absoluteStep, when) {
  const step = absoluteStep % recorder.steps;
  if (clickEnabled && step % recorder.stepsPerBeat === 0) {
    audio.tick(when, step % (recorder.stepsPerBeat * recorder.beatsPerBar) === 0);
  }
  for (const event of recorder.eventsAtStep(step)) {
    const command = createCommand({ note: event.note, velocity: event.velocity, bpm: transport.bpm, source: 'loop', now: performance.now() - sessionStart });
    const key = `loop:${event.role}:${absoluteStep}:${event.id}`;
    const duration = event.duration_steps * transport.stepDuration;
    const roleEpoch = roleEpochs.get(event.role) ?? 0;
    const valid = () => roleEpoch === (roleEpochs.get(event.role) ?? 0) && !recorder.muted.has(event.role)
      && recorder.events.some(current => current.id === event.id);
    audio.play(key, command, { when, duration: event.role === 'drums' ? null : duration });
    later(() => {
      if (!valid()) { audio.stop(key, { immediate: true }); return; }
      loopActive.set(key, event.note); setPad(event.note);
      $('command-preview').textContent = JSON.stringify(command, null, 2);
      enqueue({ note: event.note, velocity: event.velocity, bpm: transport.bpm, type: 'on', source: 'loop' }, command, valid);
    }, when);
    later(() => {
      const wasActive = loopActive.delete(key); setPad(event.note);
      if (wasActive) enqueue({ note: event.note, velocity: 0, bpm: transport.bpm, type: 'off', source: 'loop' }, null);
    }, when + duration);
  }
}

function loadSong(data) {
  const check = new LoopRecorder();
  const tempo = check.load(data);
  if (check.stepsPerBeat !== 4 || check.beatsPerBar !== 4) throw new Error('Die Oberfläche unterstützt 4/4 und ein 1/16-Raster.');
  rememberUndo(); panic();
  recorder.load(check.serialize({ bpm: tempo }));
  $('bpm').value = tempo;
  renderTracks(); saveSongLocal(); updateTransportUI();
}

$('loop-play').onclick = async () => {
  if (transport.playing) { panic(); return; }
  try { await enableAudio(); startLoop(); $('loop-status').textContent = 'Loop läuft. Mit Aufnehmen weitere Pads ergänzen.'; }
  catch (error) { notice(error.message); }
};
$('loop-record').onclick = async () => {
  if (recorder.recording) {
    finishRecording(); updateTransportUI();
    $('loop-status').textContent = 'Aufnahme beendet. Dein Loop spielt weiter.';
    return;
  }
  try {
    await enableAudio(); rememberUndo();
    recorder.startRecording({ overdub: true });
    if (!transport.playing) startLoop();
    for (const value of held.values()) recorder.noteOn({ note: value.note, velocity: value.command.velocity, beat: transport.beat });
    updateTransportUI();
    $('loop-status').textContent = 'Aufnahme läuft: Pads spielen und loslassen. Jeder neue Durchgang ergänzt den Loop.';
  } catch (error) { notice(error.message); }
};
$('metronome').onclick = () => {
  clickEnabled = !clickEnabled;
  $('metronome').textContent = clickEnabled ? '♩ Klick an' : '♩ Klick aus';
  $('metronome').setAttribute('aria-pressed', String(clickEnabled));
};
$('loop-bars').onchange = () => {
  rememberUndo(); recorder.setBars(Number($('loop-bars').value)); renderTracks(); saveSongLocal();
};
$('loop-clear').onclick = () => {
  rememberUndo(); panic(); recorder.clear(); recorder.muted.clear(); renderTracks(); saveSongLocal();
  $('loop-status').textContent = 'Spuren geleert. Mit Aufnehmen einen neuen Song beginnen.';
};
$('loop-undo').onclick = () => {
  if (!undoSong) return;
  const previous = undoSong; panic();
  const current = recorder.serialize({ bpm: bpm() });
  $('bpm').value = recorder.load(previous);
  undoSong = current; renderTracks(); saveSongLocal(); updateTransportUI();
};
const exampleSong = async () => {
  try {
    await enableAudio(); loadSong(createStarterSong()); startLoop();
    $('loop-status').textContent = 'Cm → Ab → Eb → Bb. Mit Aufnehmen eigene Pads ergänzen oder eine Rolle stummschalten.';
  } catch (error) { notice(error.message); }
};
$('demo').onclick = exampleSong;
$('song-example').onclick = exampleSong;
$('song-save').onclick = () => {
  finishRecording(); updateTransportUI();
  const url = URL.createObjectURL(new Blob([JSON.stringify(recorder.serialize({ bpm: bpm() }), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'robot-band-song.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('song-load').onclick = () => { panic(); $('song-file').click(); };
$('song-file').onchange = async () => {
  const file = $('song-file').files?.[0];
  if (!file) return;
  try {
    if (file.size > 256000) throw new Error('Song-Datei ist zu groß (maximal 256 KB).');
    loadSong(JSON.parse(await file.text()));
    $('loop-status').textContent = 'Song geladen. Loop starten zum Abspielen.';
  } catch (error) { notice(`Song nicht geladen: ${error.message}`); }
  finally { $('song-file').value = ''; }
};
try {
  const saved = localStorage.getItem(songStorageKey);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.steps_per_beat !== 4 || parsed.beats_per_bar !== 4) throw new Error('Unsupported grid');
    $('bpm').value = recorder.load(parsed);
    $('loop-status').textContent = 'Dein letzter Song ist wieder da. Loop starten oder weiter aufnehmen.';
  }
} catch { $('song-storage').textContent = 'Gespeicherter Song nicht verfügbar. Song-Datei laden oder neu aufnehmen.'; }
renderTracks(); updateTransportUI();

function restoreLiveMode() {
  if (!programmedOutput) return;
  try {
    for (const note of pads.keys()) programmedOutput.send([0x90, note, 0]);
    programmedOutput.send(programmerMode(false));
  } catch { /* A physically disconnected device cannot receive restoration. */ }
  programmedOutput = null;
}

function populateSelect(select, ports, preferredId) {
  const available = [...ports.values()].filter(port => port.state === 'connected');
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = ''; empty.textContent = 'MIDI-Port auswählen'; select.append(empty);
  for (const port of available) {
    const option = document.createElement('option');
    option.value = port.id; option.textContent = port.name || port.id; select.append(option);
  }
  const preferred = pickMidiPort(available, preferredId);
  if (preferred) select.value = preferred.id;
}

async function bindPorts() {
  if (!midi) return;
  const revision = ++bindRevision;
  if (selectedInput) selectedInput.onmidimessage = null;
  selectedInput = midi.inputs.get($('midi-input').value) || null;
  selectedOutput = midi.outputs.get($('midi-output').value) || null;
  if (!selectedInput || selectedInput.state !== 'connected') {
    $('midi-status').textContent = 'Kein MIDI-Eingang gefunden. USB prüfen oder Simulator nutzen.';
    $('input-badge').textContent = 'SIMULATOR';
    $('programmer').disabled = !selectedOutput;
    return;
  }
  try {
    const inputPort = selectedInput;
    await inputPort.open();
    if (revision !== bindRevision || selectedInput !== inputPort) return;
    inputPort.onmidimessage = event => {
      midiCount++;
      const packet = midiPacketInfo(event.data);
      $('midi-count').textContent = `${midiCount} MIDI-Nachrichten`;
      $('midi-packet').textContent = packet ? packet.statusHex : 'Unbekanntes Paket';
      const bytes = event.data;
      if (bytes.length === 9 && bytes[0] === 0xf0 && bytes[1] === 0 && bytes[2] === 32
        && bytes[3] === 41 && bytes[4] === 2 && [12, 13].includes(bytes[5]) && bytes[6] === 14 && bytes[8] === 247) {
        $('midi-status').textContent = bytes[7] === 1
          ? 'Launchpad bestätigt Programmer-Modus. Jetzt ein Pad drücken.'
          : 'Launchpad ist im Live-Modus. Bitte Programmer-Modus aktivieren.';
      }
      const input = decodeMidi(event.data);
      if (!input) {
        $('midi-hint').textContent = packet?.kind === 'note_on' || packet?.kind === 'note_off'
          ? `Note ${packet.note} liegt außerhalb des Pad-Rasters. Programmer-Modus aktivieren.`
          : packet?.kind === 'control' ? 'Randtaste empfangen. Für den Test ein großes Pad drücken.'
          : 'MIDI kommt an. Warte auf eine Pad-Note.';
        return;
      }
      if (input.type === 'pressure') return;
      $('input-badge').textContent = 'MIDI EMPFANGEN';
      $('midi-hint').textContent = `Pad ${input.note} · ${input.type === 'on' ? 'gedrückt' : 'losgelassen'} · Anschlag ${input.velocity}`;
      if (input.type === 'on') press(input.note, input.velocity, 'launchpad');
      else release(input.note, 'launchpad');
    };
    $('input-badge').textContent = 'PORT OFFEN';
    $('midi-status').textContent = `${selectedInput.name} geöffnet. Jetzt Programmer-Modus aktivieren und ein Pad drücken.`;
    $('programmer').disabled = !selectedOutput;
  } catch (error) { $('midi-status').textContent = `MIDI-Port nicht verfügbar: ${error.message}`; }
}

async function setMidi(access) {
  const inputId = selectedInput?.id, outputId = selectedOutput?.id;
  if (midi) midi.onstatechange = null;
  if (selectedInput) selectedInput.onmidimessage = null;
  midi = access;
  populateSelect($('midi-input'), midi.inputs, inputId);
  populateSelect($('midi-output'), midi.outputs, outputId);
  $('midi-controls').hidden = false;
  midi.onstatechange = async event => {
    if (event.port.state === 'disconnected') {
      if (event.port.id === selectedInput?.id || event.port.id === selectedOutput?.id) {
        panic(); restoreLiveMode(); notice('MIDI-Verbindung getrennt. Demo-Bewegungen gestoppt.');
      }
    }
    // Opening a port also emits statechange. Do not recursively rebind it.
    if (event.port.state !== 'disconnected' && event.port.connection !== 'closed') return;
    const previousInput = selectedInput?.id, previousOutput = selectedOutput?.id;
    populateSelect($('midi-input'), midi.inputs, previousInput);
    populateSelect($('midi-output'), midi.outputs, previousOutput);
    await bindPorts();
  };
  await bindPorts();
}

$('connect').onclick = async () => {
  if (!navigator.requestMIDIAccess) { notice('Web MIDI ist hier nicht verfügbar. Bitte die lokale URL in Chrome oder Edge öffnen.'); return; }
  $('connect').disabled = true;
  try {
    panic();
    const access = await navigator.requestMIDIAccess({ sysex: true });
    await setMidi(access);
    await activateProgrammer();
  } catch (error) {
    $('midi-status').textContent = `Launchpad-Start nicht vollständig: ${error.message}. Ports prüfen oder Programmer-Modus erneut aktivieren.`;
    if (!midi) {
      try { await setMidi(await navigator.requestMIDIAccess({ sysex: false })); }
      catch { $('midi-hint').textContent = 'Kein Browser-MIDI-Zugriff. In Chrome/Edge die MIDI-Berechtigung für diese lokale Seite prüfen.'; }
    }
  }
  finally { $('connect').disabled = false; }
};
async function activateProgrammer() {
  if (!selectedInput || !selectedOutput) throw new Error('MIDI-Eingang und -Ausgang auswählen');
  const output = selectedOutput;
  if (!/launchpad\s*x\b|\blpx\b|launchpad.*\bx\b/i.test(output.name || '')) throw new Error('Bitte den Launchpad-X-Ausgang auswählen');
  if (programmedOutput && programmedOutput !== output) restoreLiveMode();
  await output.open();
  output.send(programmerMode(true));
  programmedOutput = output;
  for (const note of pads.keys()) setPad(note);
  output.send([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0xf7]);
  $('midi-status').textContent = 'Programmer-Modus angefordert · vier Rollen eingefärbt. Jetzt ein Pad drücken.';
  $('midi-hint').textContent = 'Bleibt der Zähler bei 0: anderen MIDI-Eingang testen (MIDIIN2 / zweite Schnittstelle).';
}
$('programmer').onclick = async () => {
  try {
    const outputId = selectedOutput?.id;
    panic();
    const access = await navigator.requestMIDIAccess({ sysex: true });
    if (programmedOutput) restoreLiveMode();
    await setMidi(access);
    selectedOutput = access.outputs.get(outputId);
    if (!selectedOutput || selectedOutput.state !== 'connected') throw new Error('MIDI-Ausgang fehlt');
    $('midi-output').value = outputId;
    await activateProgrammer();
  } catch (error) { notice(`Pad-Farben nicht aktiviert: ${error.message}. Programmer-Modus am Gerät manuell wählen.`); }
};
$('midi-input').onchange = async () => { panic(); await bindPorts(); };
$('midi-output').onchange = async () => { panic(); restoreLiveMode(); await bindPorts(); };
$('disconnect').onclick = () => {
  panic(); restoreLiveMode();
  if (selectedInput) { selectedInput.onmidimessage = null; selectedInput.close().catch(() => {}); }
  if (midi) midi.onstatechange = null;
  midi = null; selectedInput = null; selectedOutput = null;
  $('midi-controls').hidden = true; $('programmer').disabled = true;
  $('input-badge').textContent = 'SIMULATOR';
  $('midi-status').textContent = 'MIDI getrennt. Simulator bereit. Bei USB-Verlust Live-Modus am Gerät wiederherstellen.';
};

async function checkBridge() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Bridge unavailable');
    const status = await response.json();
    $('bridge-status').textContent = 'Bereit';
    $('simrobot-status').textContent = status.simrobot?.connected ? 'SimRobot verbunden' : 'SimRobot nicht verbunden';
  } catch {
    $('bridge-status').textContent = 'Offline';
    $('simrobot-status').textContent = 'SimRobot nicht verbunden';
  }
}
checkBridge();
setInterval(checkBridge, 5000);
