/** Shared, hardware-independent Launchpad X mapping for the browser and bridge. */
export const ROLES = Object.freeze([
  Object.freeze({ id: 'drums', label: 'Schlagzeug', color: '#ffb454', palette: 9 }),
  Object.freeze({ id: 'guitar', label: 'Gitarre', color: '#fc7299', palette: 53 }),
  Object.freeze({ id: 'keyboard', label: 'Keyboard', color: '#63d9ff', palette: 45 }),
  Object.freeze({ id: 'vocals', label: 'Gesang', color: '#bb9aff', palette: 49 }),
]);

// The same 4x4 chord palette is available in each melodic quadrant. Pad index 0
// is its bottom-left corner. All voicings use the root as their lowest pitch.
const CHORDS = [
  { name: 'Cm', root: 0, intervals: [0, 3, 7] },
  { name: 'Ab', root: 8, intervals: [0, 4, 7] },
  { name: 'Eb', root: 3, intervals: [0, 4, 7] },
  { name: 'Bb', root: 10, intervals: [0, 4, 7] },
  { name: 'Fm', root: 5, intervals: [0, 3, 7] },
  { name: 'Gm', root: 7, intervals: [0, 3, 7] },
  { name: 'Bb', root: 10, intervals: [0, 4, 7] },
  { name: 'Cm', root: 0, intervals: [0, 3, 7] },
  { name: 'Cm7', root: 0, intervals: [0, 3, 7, 10] },
  { name: 'Abmaj7', root: 8, intervals: [0, 4, 7, 11] },
  { name: 'Ebmaj7', root: 3, intervals: [0, 4, 7, 11] },
  { name: 'Bb7', root: 10, intervals: [0, 4, 7, 10] },
  { name: 'Fm7', root: 5, intervals: [0, 3, 7, 10] },
  { name: 'Gm7', root: 7, intervals: [0, 3, 7, 10] },
  { name: 'Bbadd9', root: 10, intervals: [0, 4, 7, 14] },
  { name: 'Csus2', root: 0, intervals: [0, 2, 7] },
];
const DRUM_PITCHES = [36, 38, 42, 46, 41, 43, 45, 49, 37, 39, 44, 51, 47, 48, 50, 57];
const DRUM_ANIMATIONS = [
  'kick', 'snare', 'hihat', 'hihat',
  'tom', 'tom', 'tom', 'cymbal',
  'snare', 'snare', 'hihat', 'cymbal',
  'tom', 'tom', 'tom', 'cymbal',
];

/** row 0 is the bottom row; column 0 is the leftmost column. */
export function padInfo(note) {
  if (!Number.isInteger(note) || note < 0 || note > 127) return null;
  const row = Math.floor(note / 10) - 1;
  const column = note % 10 - 1;
  if (row < 0 || row > 7 || column < 0 || column > 7) return null;

  const role = row >= 4
    ? (column < 4 ? 'drums' : 'guitar')
    : (column < 4 ? 'keyboard' : 'vocals');
  const index = (row % 4) * 4 + column % 4;
  const zone = index < 6 ? 'low' : index < 11 ? 'mid' : 'high';
  const chordDefinition = role === 'drums' ? null : CHORDS[index];
  const pitch = chordDefinition
    ? (role === 'vocals' ? 60 : 48) + chordDefinition.root
    : DRUM_PITCHES[index];
  const chord = chordDefinition?.name ?? null;
  const pitches = chordDefinition
    ? chordDefinition.intervals.map(interval => pitch + interval)
    : [pitch];
  const animation = role === 'drums'
    ? DRUM_ANIMATIONS[index]
    : `${{ guitar: 'strum', keyboard: 'keys', vocals: 'sing' }[role]}_${zone}`;

  const label = chord ?? { kick: 'KICK', snare: 'SNR', hihat: 'HAT', tom: 'TOM', cymbal: 'CYM' }[animation];

  return { note, row, column, role, index, pitch, animation, chord, pitches, label };
}

/** Ignore clock, transport, SysEx and side/top buttons. Channels are zero-based. */
export function decodeMidi(data) {
  if (!data || data.length !== 3) return null;
  const [status, note, value] = data;
  if (![status, note, value].every(Number.isInteger)) return null;
  if (status < 0x80 || status > 0xef || note < 0 || note > 127 || value < 0 || value > 127) return null;
  const kind = status & 0xf0;
  if (kind !== 0x80 && kind !== 0x90 && kind !== 0xa0) return null;
  if (!padInfo(note)) return null;
  const type = kind === 0xa0 ? 'pressure' : kind === 0x80 || value === 0 ? 'off' : 'on';
  return { type, note, velocity: value, channel: status & 0x0f };
}

/**
 * Semantic command only: animation names must be mapped by a robot-specific
 * adapter. Polyphonic pressure is available from decodeMidi but does not retrigger.
 */
export function createCommand({
  note, velocity = 100, bpm = 120, type = 'on', source = 'simulator', now = 0,
} = {}) {
  const pad = padInfo(note);
  if (!pad || !['on', 'off'].includes(type)) return null;
  if (![velocity, bpm, now].every(Number.isFinite) || now < 0) return null;
  if (typeof source !== 'string' || source.length === 0 || source.length > 80) return null;

  const boundedVelocity = Math.round(Math.max(0, Math.min(127, velocity)));
  const boundedBpm = Math.max(40, Math.min(240, bpm));
  const release = type === 'off' || boundedVelocity === 0;
  const beatFraction = pad.role === 'drums' ? 0.25 : 1;

  return {
    schema_version: 1,
    type: release ? 'release' : 'trigger',
    scope: release ? 'pad' : 'role',
    robot: pad.role,
    animation: release ? 'idle' : pad.animation,
    pad_note: note,
    pitch: pad.pitch,
    chord: pad.chord,
    pitches: pad.pitches,
    velocity: release ? 0 : boundedVelocity,
    intensity: release ? 0 : Number((boundedVelocity / 127).toFixed(3)),
    bpm: boundedBpm,
    duration_ms: release ? 0 : Math.round(Math.max(80, 60000 / boundedBpm * beatFraction)),
    timestamp_ms: Math.round(now),
    source,
  };
}

/** Novation Launchpad X device ID 0C, command 0E: Programmer / Live switch. */
export function programmerMode(enabled) {
  return new Uint8Array([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, enabled ? 1 : 0, 0xf7]);
}
