import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterSong } from '../public/starter-song.js';
import { padInfo } from '../public/engine.js';
import { LoopRecorder } from '../public/looper.js';

test('starter song serializes a fresh two-bar loop with all four roles', () => {
  const song = createStarterSong();
  assert.equal(song.schema_version, 1);
  assert.equal(song.bpm, 110);
  assert.equal(song.bars, 2);
  assert.equal(song.steps_per_beat, 4);
  assert.equal(song.beats_per_bar, 4);
  assert.equal(song.events.length, 34);
  assert.deepEqual(song.muted, []);
  assert.deepEqual(new Set(song.events.map(event => event.role)), new Set(['keyboard', 'guitar', 'vocals', 'drums']));
  assert.deepEqual(JSON.parse(JSON.stringify(song)), song);
});

test('starter song loads into LoopRecorder without any schema conversion', () => {
  const song = createStarterSong({ bpm: 125 });
  const recorder = new LoopRecorder({ bars: 4 });
  assert.equal(recorder.load(song), 125);
  assert.equal(recorder.steps, 32);
  assert.deepEqual(recorder.serialize({ bpm: 125 }), song);
  assert.ok(recorder.eventsAtStep(0).some(event => event.role === 'keyboard'));
});

test('every event has a unique ID and valid matching Launchpad role within 32 steps', () => {
  const { events } = createStarterSong();
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  for (const event of events) {
    assert.equal(event.role, padInfo(event.note).role);
    assert.ok(Number.isInteger(event.step) && event.step >= 0);
    assert.ok(Number.isInteger(event.duration_steps) && event.duration_steps >= 1);
    assert.ok(event.step + event.duration_steps <= 32);
    assert.ok(Number.isInteger(event.velocity) && event.velocity >= 1 && event.velocity <= 127);
  }
});

test('keyboard and guitar share Cm Ab Eb Bb while guitar plays offbeat', () => {
  const song = createStarterSong();
  const keyboard = song.events.filter(event => event.role === 'keyboard');
  const guitar = song.events.filter(event => event.role === 'guitar');
  assert.deepEqual(keyboard.map(event => padInfo(event.note).chord), ['Cm', 'Ab', 'Eb', 'Bb']);
  assert.deepEqual(guitar.map(event => padInfo(event.note).chord), ['Cm', 'Ab', 'Eb', 'Bb']);
  assert.deepEqual(keyboard.map(event => event.step), [0, 8, 16, 24]);
  assert.deepEqual(guitar.map(event => event.step), [2, 10, 18, 26]);
  assert.ok(keyboard.every(event => event.duration_steps === 8));
  assert.ok(guitar.every(event => event.duration_steps === 6));
  assert.deepEqual(song.events.filter(event => event.role === 'vocals').map(event => [event.step, padInfo(event.note).chord]), [[0, 'Cm'], [16, 'Eb']]);
});

test('drums provide alternating kick and snare with a quiet eighth-note hat', () => {
  const drums = createStarterSong().events.filter(event => event.role === 'drums');
  assert.deepEqual(drums.filter(event => event.note === 51).map(event => event.step), [0, 8, 16, 24]);
  assert.deepEqual(drums.filter(event => event.note === 52).map(event => event.step), [4, 12, 20, 28]);
  const hats = drums.filter(event => event.note === 53);
  assert.deepEqual(hats.map(event => event.step), Array.from({ length: 16 }, (_, i) => i * 2));
  assert.ok(hats.every(event => event.velocity === 50 && event.duration_steps === 1));
});

test('the example never exceeds two simultaneous pad voices per role', () => {
  const song = createStarterSong();
  for (let step = 0; step < 32; step++) {
    const active = song.events.filter(event => event.step <= step && event.step + event.duration_steps > step);
    for (const role of ['drums', 'guitar', 'keyboard', 'vocals']) {
      assert.ok(active.filter(event => event.role === role).length <= 2, `${role} at step ${step}`);
    }
  }
});

test('custom tempo is validated and song instances do not share editable arrays', () => {
  assert.equal(createStarterSong({ bpm: 140 }).bpm, 140);
  for (const bpm of [0, 39, 241, NaN, Infinity, '110', null]) assert.throws(() => createStarterSong({ bpm }), RangeError);
  const first = createStarterSong();
  first.events[0].velocity = 1;
  first.events.pop();
  first.muted.push('drums');
  const second = createStarterSong();
  assert.equal(second.events.length, 34);
  assert.notEqual(second.events[0].velocity, 1);
  assert.deepEqual(second.muted, []);
});
