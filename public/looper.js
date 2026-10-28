import { padInfo, ROLES } from './engine.js';

export const MAX_LOOP_EVENTS = 512;
const VALID_BARS = [1, 2, 4, 8];
const ROLE_IDS = new Set(ROLES.map(role => role.id));

function integerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function validBars(value) {
  if (!VALID_BARS.includes(value)) throw new TypeError('bars must be 1, 2, 4 or 8');
  return value;
}

function validBpm(value) {
  if (!Number.isFinite(value) || value < 40 || value > 240) {
    throw new TypeError('bpm must be between 40 and 240');
  }
  return value;
}

// A small floating-point tolerance makes values such as 0.37499999999999994
// round identically to 0.375 at a sixteenth-note half-grid boundary.
function absoluteStep(beat, stepsPerBeat) {
  if (!Number.isFinite(beat)) throw new TypeError('beat must be finite');
  const scaled = beat * stepsPerBeat;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER - 1) {
    throw new TypeError('beat exceeds the supported timing range');
  }
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4);
  return Math.round(scaled + tolerance);
}

/** Quantize to the nearest grid step, with half steps rounded forward. */
export function quantizeBeat(beat, stepsPerBeat = 4, loopSteps = 32) {
  integerInRange(stepsPerBeat, 1, 16, 'stepsPerBeat');
  integerInRange(loopSteps, 1, 2048, 'loopSteps');
  const step = absoluteStep(beat, stepsPerBeat);
  return ((step % loopSteps) + loopSteps) % loopSteps;
}

function eventId(note, step) { return `pad-${note}-step-${step}`; }
function copyEvent(event) { return { ...event }; }
function sortEvents(events) { return events.sort((a, b) => a.step - b.step || a.note - b.note); }

function strictObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has missing or unsupported fields`);
  }
}

/**
 * Pure loop data model. Callers provide monotonically increasing absolute beats;
 * the browser scheduler owns the clock and audio/robot playback.
 */
export class LoopRecorder {
  #pending = new Map();

  constructor({ bars = 2, stepsPerBeat = 4, beatsPerBar = 4 } = {}) {
    this.bars = validBars(bars);
    this.stepsPerBeat = integerInRange(stepsPerBeat, 1, 16, 'stepsPerBeat');
    this.beatsPerBar = integerInRange(beatsPerBar, 1, 16, 'beatsPerBar');
    this.events = [];
    this.recording = false;
    this.muted = new Set();
  }

  get loopBeats() { return this.bars * this.beatsPerBar; }
  get steps() { return this.loopBeats * this.stepsPerBeat; }

  /** A length change ends recording; retained gates fit the new loop length. */
  setBars(bars) {
    validBars(bars);
    if (bars === this.bars) return;
    this.stopRecording();
    this.bars = bars;
    this.events = this.events.filter(event => event.step < this.steps)
      .map(event => ({ ...event, duration_steps: Math.min(event.duration_steps, this.steps) }));
  }

  startRecording({ overdub = false } = {}) {
    if (typeof overdub !== 'boolean') throw new TypeError('overdub must be boolean');
    this.#pending.clear();
    if (!overdub) this.events = [];
    this.recording = true;
  }

  /** Unreleased notes are deliberately discarded instead of inventing a gate. */
  stopRecording() {
    this.recording = false;
    this.#pending.clear();
  }

  noteOn({ note, velocity, role, beat } = {}) {
    if (!this.recording) return false;
    const pad = padInfo(note);
    if (!pad || (role !== undefined && role !== pad.role)
      || !Number.isInteger(velocity) || velocity < 1 || velocity > 127
      || !Number.isFinite(beat) || beat < 0 || this.#pending.has(note)) return false;
    let stepAbs;
    try { stepAbs = absoluteStep(beat, this.stepsPerBeat); } catch { return false; }
    this.#pending.set(note, {
      note, velocity, role: pad.role, beatAbs: beat,
      startStepAbs: stepAbs, startStep: quantizeBeat(beat, this.stepsPerBeat, this.steps),
    });
    return true;
  }

  /** Returns the completed event, or null when the input is ignored/full. */
  noteOff({ note, beat } = {}) {
    if (!this.recording) return null;
    const pending = this.#pending.get(note);
    if (!pending || !Number.isFinite(beat) || beat < pending.beatAbs) return null;
    let endStepAbs;
    try { endStepAbs = absoluteStep(beat, this.stepsPerBeat); } catch { return null; }
    this.#pending.delete(note);
    const existing = this.events.findIndex(event => event.note === note && event.step === pending.startStep);
    if (existing === -1 && this.events.length >= MAX_LOOP_EVENTS) return null;
    const event = {
      id: eventId(note, pending.startStep), note, velocity: pending.velocity,
      role: pending.role, step: pending.startStep,
      duration_steps: Math.max(1, Math.min(this.steps, endStepAbs - pending.startStepAbs)),
    };
    if (existing === -1) this.events.push(event);
    else this.events[existing] = event;
    sortEvents(this.events);
    return copyEvent(event);
  }

  clear(role) {
    if (role !== undefined && !ROLE_IDS.has(role)) throw new TypeError('Unknown role');
    if (role === undefined) {
      this.events = [];
      this.#pending.clear();
    } else {
      this.events = this.events.filter(event => event.role !== role);
      for (const [note, pending] of this.#pending) if (pending.role === role) this.#pending.delete(note);
    }
  }

  /** Returns true when the role is muted after the toggle. */
  toggleMute(role) {
    if (!ROLE_IDS.has(role)) throw new TypeError('Unknown role');
    if (this.muted.has(role)) this.muted.delete(role);
    else this.muted.add(role);
    return this.muted.has(role);
  }

  eventsAtStep(step) {
    integerInRange(step, 0, this.steps - 1, 'step');
    return this.events.filter(event => event.step === step && !this.muted.has(event.role)).map(copyEvent);
  }

  serialize({ bpm = 120 } = {}) {
    validBpm(bpm);
    return {
      schema_version: 1, bpm, bars: this.bars,
      steps_per_beat: this.stepsPerBeat, beats_per_bar: this.beatsPerBar,
      events: this.events.map(copyEvent), muted: [...this.muted].sort(),
    };
  }

  /** Validate everything before replacing any live state. Returns imported BPM. */
  load(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    strictObject(data, ['schema_version', 'bpm', 'bars', 'steps_per_beat', 'beats_per_bar', 'events', 'muted'], 'Loop');
    if (data.schema_version !== 1) throw new TypeError('Unsupported loop schema');
    const bpm = validBpm(data.bpm);
    const bars = validBars(data.bars);
    const stepsPerBeat = integerInRange(data.steps_per_beat, 1, 16, 'steps_per_beat');
    const beatsPerBar = integerInRange(data.beats_per_bar, 1, 16, 'beats_per_bar');
    const steps = bars * stepsPerBeat * beatsPerBar;
    if (!Array.isArray(data.events) || data.events.length > MAX_LOOP_EVENTS) throw new TypeError('Invalid event count');
    if (!Array.isArray(data.muted) || data.muted.length > ROLE_IDS.size
      || data.muted.some(role => !ROLE_IDS.has(role)) || new Set(data.muted).size !== data.muted.length) {
      throw new TypeError('Invalid muted roles');
    }
    const seen = new Set();
    const events = data.events.map(input => {
      strictObject(input, ['id', 'note', 'velocity', 'role', 'step', 'duration_steps'], 'Event');
      const pad = padInfo(input.note);
      if (!pad || input.role !== pad.role) throw new TypeError('Event role must match its grid pad');
      integerInRange(input.velocity, 1, 127, 'velocity');
      integerInRange(input.step, 0, steps - 1, 'step');
      integerInRange(input.duration_steps, 1, steps, 'duration_steps');
      const id = eventId(input.note, input.step);
      if (input.id !== id || seen.has(id)) throw new TypeError('Invalid or duplicate event id');
      seen.add(id);
      return { id, note: input.note, velocity: input.velocity, role: pad.role,
        step: input.step, duration_steps: input.duration_steps };
    });

    this.bars = bars;
    this.stepsPerBeat = stepsPerBeat;
    this.beatsPerBar = beatsPerBar;
    this.events = sortEvents(events);
    this.muted = new Set(data.muted);
    this.stopRecording();
    return bpm;
  }
}
