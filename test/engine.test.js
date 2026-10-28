import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, padInfo, decodeMidi, createCommand, programmerMode } from '../public/engine.js';

test('all 64 grid pads map once to the four role quadrants', () => {
  const counts = Object.fromEntries(ROLES.map(role => [role.id, 0]));
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const note = (row + 1) * 10 + column + 1;
      const pad = padInfo(note);
      assert.equal(pad.row, row);
      assert.equal(pad.column, column);
      assert.equal(pad.index, row % 4 * 4 + column % 4);
      counts[pad.role]++;
    }
  }
  assert.deepEqual(counts, { drums: 16, guitar: 16, keyboard: 16, vocals: 16 });
  assert.equal(padInfo(81).role, 'drums');
  assert.equal(padInfo(88).role, 'guitar');
  assert.equal(padInfo(11).role, 'keyboard');
  assert.equal(padInfo(18).role, 'vocals');
});

test('side buttons, top buttons and invalid addresses are excluded', () => {
  for (const note of [-1, 0, 10, 19, 20, 89, 91, 99, 127, 128, 11.5, NaN, '11']) {
    assert.equal(padInfo(note), null, `address ${note}`);
  }
});

test('melodic pads expose a root-position chord palette and percussion stays single-note', () => {
  assert.equal(padInfo(11).pitch, 48);
  assert.equal(padInfo(12).pitch, 56);
  assert.equal(padInfo(13).pitch, 51);
  assert.equal(padInfo(44).pitch, 48);
  assert.equal(padInfo(15).pitch, 60);
  assert.deepEqual(padInfo(11).pitches, [48, 51, 55]);
  assert.deepEqual(padInfo(12).pitches, [56, 60, 63]);
  assert.equal(padInfo(11).chord, 'Cm');
  assert.equal(padInfo(11).label, 'Cm');
  assert.equal(padInfo(51).pitch, 36);
  assert.deepEqual(padInfo(51).pitches, [36]);
  assert.equal(padInfo(51).chord, null);
  assert.equal(padInfo(51).label, 'KICK');
  assert.equal(padInfo(52).animation, 'snare');
  assert.equal(padInfo(53).animation, 'hihat');
});

test('MIDI handles all channels, zero-velocity note off and poly pressure', () => {
  assert.deepEqual(decodeMidi([0x92, 11, 100]), { type: 'on', note: 11, velocity: 100, channel: 2 });
  assert.equal(decodeMidi([0x9f, 11, 0]).type, 'off');
  assert.equal(decodeMidi([0x8f, 11, 64]).type, 'off');
  assert.equal(decodeMidi(new Uint8Array([0xa0, 11, 43])).type, 'pressure');
  for (const bytes of [[0xf8], [0xb0, 91, 127], [0x90, 91, 100], [0x90, 11], [0x90, 11, 128], [0x90, 11, -1]]) {
    assert.equal(decodeMidi(bytes), null);
  }
});

test('commands expose semantic routing, tempo, velocity and release', () => {
  const command = createCommand({ note: 11, velocity: 127, bpm: 120, now: 200.3, source: 'launchpad' });
  assert.equal(command.robot, 'keyboard');
  assert.equal(command.type, 'trigger');
  assert.equal(command.animation, 'keys_low');
  assert.equal(command.duration_ms, 500);
  assert.equal(command.chord, 'Cm');
  assert.deepEqual(command.pitches, [48, 51, 55]);
  assert.equal(command.intensity, 1);
  assert.equal(command.timestamp_ms, 200);
  assert.equal(createCommand({ note: 11, velocity: 0 }).type, 'release');
  const release = createCommand({ note: 11, type: 'off', velocity: 100 });
  assert.equal(release.animation, 'idle');
  assert.equal(release.intensity, 0);
  assert.equal(release.duration_ms, 0);
  assert.deepEqual(release.pitches, [48, 51, 55]);
  assert.equal(createCommand({ note: 11, type: 'pressure' }), null);
});

test('every melodic quadrant shares the requested 16 chords and valid MIDI pitches', () => {
  const names = ['Cm', 'Ab', 'Eb', 'Bb', 'Fm', 'Gm', 'Bb', 'Cm', 'Cm7', 'Abmaj7', 'Ebmaj7', 'Bb7', 'Fm7', 'Gm7', 'Bbadd9', 'Csus2'];
  for (const [rowOffset, columnOffset] of [[0, 0], [0, 4], [4, 4]]) {
    for (let index = 0; index < 16; index++) {
      const row = rowOffset + Math.floor(index / 4);
      const column = columnOffset + index % 4;
      const pad = padInfo((row + 1) * 10 + column + 1);
      assert.equal(pad.chord, names[index]);
      assert.equal(pad.label, names[index]);
      assert.equal(pad.pitch, pad.pitches[0]);
      assert.ok(pad.pitches.length >= 3);
      assert.ok(pad.pitches.every(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127));
      assert.ok(pad.pitches.every((pitch, i) => i === 0 || pitch > pad.pitches[i - 1]));
    }
  }
});

test('seventh, added-ninth and suspended chords have the correct intervals', () => {
  const intervals = note => {
    const pad = padInfo(note);
    return pad.pitches.map(pitch => pitch - pad.pitch);
  };
  assert.deepEqual(intervals(31), [0, 3, 7, 10]); // Cm7
  assert.deepEqual(intervals(32), [0, 4, 7, 11]); // Abmaj7
  assert.deepEqual(intervals(34), [0, 4, 7, 10]); // Bb7
  assert.deepEqual(intervals(43), [0, 4, 7, 14]); // Bbadd9
  assert.deepEqual(intervals(44), [0, 2, 7]); // Csus2
});

test('melodic commands sustain for a full beat, drum commands retain quarter-beat timing', () => {
  for (const note of [11, 15, 55]) {
    assert.equal(createCommand({ note, bpm: 120, source: 'loop' }).duration_ms, 500);
    assert.equal(createCommand({ note, bpm: 60, source: 'loop' }).duration_ms, 1000);
  }
  assert.equal(createCommand({ note: 51, bpm: 120 }).duration_ms, 125);
});

test('extreme values are bounded; non-finite inputs never reach robot commands', () => {
  assert.equal(createCommand({ note: 11, bpm: 0, velocity: 200 }).bpm, 40);
  assert.equal(createCommand({ note: 11, bpm: 1000 }).bpm, 240);
  assert.equal(createCommand({ note: 11, velocity: 200 }).velocity, 127);
  assert.equal(createCommand({ note: 11, velocity: -1 }).type, 'release');
  for (const key of ['bpm', 'velocity', 'now']) {
    for (const value of [NaN, Infinity, -Infinity, '120', null]) {
      assert.equal(createCommand({ note: 11, [key]: value }), null, `${key}: ${value}`);
    }
  }
  assert.equal(createCommand({ note: 11, now: -1 }), null);
  assert.equal(createCommand({ note: 11, source: '' }), null);
  assert.equal(createCommand(), null);
});

test('programmer mode messages match the Launchpad X SysEx format', () => {
  assert.deepEqual([...programmerMode(true)], [240, 0, 32, 41, 2, 12, 14, 1, 247]);
  assert.deepEqual([...programmerMode(false)], [240, 0, 32, 41, 2, 12, 14, 0, 247]);
});
