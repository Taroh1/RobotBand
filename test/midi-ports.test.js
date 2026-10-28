import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMidiPort, midiPacketInfo } from '../public/midi-ports.js';

const port = (id, name, state = 'connected') => ({ id, name, state });

test('Windows second MIDI interface beats the first Launchpad interface and virtual ports', () => {
  const ports = [port('virtual', 'loopMIDI'), port('first', 'Launchpad X'), port('second', 'MIDIIN2 (Launchpad X)')];
  assert.equal(pickMidiPort(ports).id, 'second');
  assert.equal(pickMidiPort([port('first', 'Launchpad X'), port('out', 'MIDIOUT2 (Launchpad X)')]).id, 'out');
});

test('actual Windows LPX MIDI names choose MIDIIN2 and MIDIOUT2 over the first interface', () => {
  assert.equal(pickMidiPort([
    port('first-input', 'LPX MIDI'),
    port('second-input', 'MIDIIN2 (LPX MIDI)'),
  ]).id, 'second-input');
  assert.equal(pickMidiPort([
    port('first-output', 'LPX MIDI'),
    port('second-output', 'MIDIOUT2 (LPX MIDI)'),
  ]).id, 'second-output');
});

test('LPX MIDI beats DAW and supports MIDI map values', () => {
  const ports = [port('daw', 'LPX DAW In'), port('midi', 'LPX MIDI In')];
  assert.equal(pickMidiPort(new Map(ports.map(p => [p.id, p]))).id, 'midi');
});

test('manual connected selection persists while disconnected selection falls back', () => {
  const ports = [port('manual', 'Other keyboard'), port('off', 'LPX MIDI', 'disconnected'), port('lpx', 'Launchpad X')];
  assert.equal(pickMidiPort(ports, 'manual').id, 'manual');
  assert.equal(pickMidiPort(ports, 'off').id, 'lpx');
});

test('no unrelated port is silently selected and generic Launchpad X remains usable', () => {
  assert.equal(pickMidiPort([port('v', 'loopMIDI'), port('n', 'Novation controller'), port('m', 'Launchpad Mini')]), null);
  assert.equal(pickMidiPort([]), null);
  assert.equal(pickMidiPort([port('l', 'Launchpad X')]).id, 'l');
});

test('raw note messages distinguish grid, nongrid, channel and velocity-zero note offs', () => {
  assert.deepEqual(midiPacketInfo([0x90, 81, 100]), { statusHex: '90 51 64', kind: 'note_on', isGrid: true, note: 81, value: 100 });
  assert.equal(midiPacketInfo([0x9f, 81, 0]).kind, 'note_off');
  assert.equal(midiPacketInfo([0x80, 81, 64]).kind, 'note_off');
  assert.equal(midiPacketInfo([0x90, 36, 100]).isGrid, true);
  assert.equal(midiPacketInfo([0x90, 99, 100]).isGrid, false);
});

test('diagnostics expose CC, poly/channel pressure, clock and other valid messages', () => {
  const control = midiPacketInfo([0xb0, 91, 127]);
  assert.equal(control.kind, 'control');
  assert.equal(control.controller, 91);
  assert.equal(control.isGrid, false);
  assert.equal(midiPacketInfo([0xa0, 81, 32]).kind, 'pressure');
  assert.equal(midiPacketInfo([0xd0, 32]).kind, 'pressure');
  assert.equal(midiPacketInfo([0xf8]).kind, 'clock');
  assert.equal(midiPacketInfo([0xc0, 5]).kind, 'other');
  assert.equal(midiPacketInfo(new Uint8Array([0xf0, 0, 32, 41, 0xf7])).kind, 'other');
});

test('diagnostics reject malformed lengths, unbounded bytes and invalid data statuses', () => {
  for (const bytes of [null, [], [0x90, 81], [0x90, 81, 100, 0], [0x90, 128, 100], [0x90, 81, -1], [0x90, 81, NaN], [256], [12, 10, 10], [0xf8, 0], [0xf0, 32], [0xf0, 200, 0xf7], [0xf4]]) {
    assert.equal(midiPacketInfo(bytes), null, JSON.stringify(bytes));
  }
});
