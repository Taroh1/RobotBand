import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopRecorder, quantizeBeat, MAX_LOOP_EVENTS } from '../public/looper.js';

function record(loop, note = 11, start = 0, end = 0.25, velocity = 100) {
  assert.equal(loop.noteOn({ note, velocity, beat: start }), true);
  return loop.noteOff({ note, beat: end });
}

test('quantization rounds to the nearest sixteenth and wraps stably', () => {
  assert.equal(quantizeBeat(0), 0);
  assert.equal(quantizeBeat(0.12), 0);
  assert.equal(quantizeBeat(0.125), 1);
  assert.equal(quantizeBeat(0.37499999999999994), 2);
  assert.equal(quantizeBeat(7.99), 0);
  assert.equal(quantizeBeat(8.25), 1);
  assert.equal(quantizeBeat(-0.25), 31);
  assert.equal(quantizeBeat(1024.5), 2);
  for (const beat of [NaN, Infinity, '1', Number.MAX_VALUE]) assert.throws(() => quantizeBeat(beat));
  assert.throws(() => quantizeBeat(0, 0));
  assert.throws(() => quantizeBeat(0, 4, 0));
});

test('recording quantizes starts and gates without timers', () => {
  const loop = new LoopRecorder();
  assert.equal(loop.loopBeats, 8);
  assert.equal(loop.steps, 32);
  assert.equal(loop.noteOn({ note: 11, velocity: 100, beat: 0 }), false);
  loop.startRecording();
  const event = record(loop, 11, 1.13, 1.61, 85);
  assert.deepEqual(event, {
    id: 'pad-11-step-5', note: 11, velocity: 85, role: 'keyboard', step: 5, duration_steps: 1,
  });
  assert.equal(record(loop, 12, 2, 2).duration_steps, 1);
  assert.equal(loop.events.length, 2);
  loop.stopRecording();
  assert.equal(loop.recording, false);
});

test('held gates retain duration across loop boundaries and are bounded to one loop', () => {
  const loop = new LoopRecorder();
  loop.startRecording();
  assert.equal(record(loop, 11, 7.75, 8.5).duration_steps, 3);
  assert.equal(loop.events[0].step, 31);
  const wrapped = record(loop, 12, 7.99, 8.5);
  assert.equal(wrapped.step, 0);
  assert.equal(wrapped.duration_steps, 2);
  assert.equal(record(loop, 13, 1, 25).duration_steps, 32);
});

test('overdub replaces the same pad and step while preserving other notes', () => {
  const loop = new LoopRecorder();
  loop.startRecording();
  record(loop, 11, 0, 0.25, 50);
  record(loop, 12, 1, 1.25);
  loop.stopRecording();
  loop.startRecording({ overdub: true });
  const replacement = record(loop, 11, 8, 8.75, 127);
  assert.equal(loop.events.length, 2);
  assert.equal(replacement.velocity, 127);
  assert.equal(replacement.duration_steps, 3);
  assert.equal(replacement.id, 'pad-11-step-0');
  loop.startRecording();
  assert.equal(loop.events.length, 0);
});

test('stopping, clearing and resizing discard pending notes', () => {
  const loop = new LoopRecorder({ bars: 4 });
  loop.startRecording();
  record(loop, 11, 0, 20);
  record(loop, 12, 12, 12.25);
  loop.noteOn({ note: 13, velocity: 100, beat: 13 });
  loop.setBars(1);
  assert.equal(loop.steps, 16);
  assert.equal(loop.recording, false);
  assert.equal(loop.events.length, 1);
  assert.equal(loop.events[0].duration_steps, 16);
  assert.equal(loop.noteOff({ note: 13, beat: 14 }), null);
  assert.throws(() => loop.setBars(3));
  assert.equal(loop.bars, 1);
  loop.startRecording({ overdub: true });
  loop.noteOn({ note: 51, velocity: 100, role: 'drums', beat: 0 });
  loop.clear('drums');
  assert.equal(loop.noteOff({ note: 51, beat: 1 }), null);
  assert.equal(loop.events.length, 1);
  loop.clear();
  assert.deepEqual(loop.events, []);
});

test('mute filters playback without removing data and snapshots are detached', () => {
  const loop = new LoopRecorder();
  loop.startRecording();
  record(loop, 11);
  record(loop, 51);
  assert.equal(loop.eventsAtStep(0).length, 2);
  assert.equal(loop.toggleMute('keyboard'), true);
  assert.deepEqual(loop.eventsAtStep(0).map(event => event.role), ['drums']);
  assert.equal(loop.events.length, 2);
  assert.equal(loop.toggleMute('keyboard'), false);
  const view = loop.eventsAtStep(0);
  view[0].velocity = 1;
  assert.equal(loop.events[0].velocity, 100);
  assert.throws(() => loop.toggleMute('other'));
  assert.throws(() => loop.eventsAtStep(32));
});

test('loop JSON roundtrips with tempo, timing, notes and mute state', () => {
  const loop = new LoopRecorder({ bars: 1 });
  loop.startRecording();
  record(loop, 55, 1, 1.75);
  loop.noteOn({ note: 11, velocity: 100, beat: 2 });
  loop.toggleMute('guitar');
  const snapshot = loop.serialize({ bpm: 135.5 });
  const loaded = new LoopRecorder();
  assert.equal(loaded.load(JSON.stringify(snapshot)), 135.5);
  assert.deepEqual(loaded.serialize({ bpm: 135.5 }), snapshot);
  assert.equal(loaded.recording, false);
  assert.equal(loaded.noteOff({ note: 11, beat: 3 }), null);
  snapshot.events[0].velocity = 1;
  snapshot.muted.length = 0;
  assert.equal(loaded.events[0].velocity, 100);
  assert.equal(loaded.muted.has('guitar'), true);
});

test('strict imports reject malformed data atomically, including out-of-loop events', () => {
  const loop = new LoopRecorder();
  loop.startRecording();
  record(loop);
  loop.noteOn({ note: 12, velocity: 80, beat: 1 });
  const before = loop.serialize();
  const invalid = [
    null, [], {}, { ...before, schema_version: 2 }, { ...before, bpm: 241 },
    { ...before, bars: 3 }, { ...before, extra: true },
    { ...before, steps_per_beat: 0 }, { ...before, beats_per_bar: 1.5 },
    { ...before, muted: ['not-a-role'] }, { ...before, muted: ['drums', 'drums'] },
    { ...before, events: [...before.events, ...before.events] },
    ...[
      { note: 91 }, { role: 'vocals' }, { velocity: 0 }, { velocity: 128 },
      { step: 32 }, { step: -1 }, { duration_steps: 0 }, { duration_steps: 33 },
      { id: 'wrong-id' }, { extra: 1 },
    ].map(change => ({ ...before, events: [{ ...before.events[0], ...change }] })),
  ];
  for (const data of invalid) {
    assert.throws(() => loop.load(data));
    assert.deepEqual(loop.serialize(), before);
    assert.equal(loop.recording, true);
  }
  assert.throws(() => loop.load('{'));
  assert.equal(loop.noteOff({ note: 12, beat: 1.5 }).duration_steps, 2);
});

test('invalid live input is ignored and the event cap still permits replacements', () => {
  const loop = new LoopRecorder({ bars: 8 });
  loop.startRecording();
  assert.equal(loop.noteOn({ note: 91, velocity: 100, beat: 0 }), false);
  assert.equal(loop.noteOn({ note: 11, velocity: 100, role: 'drums', beat: 0 }), false);
  assert.equal(loop.noteOn({ note: 11, velocity: 100, beat: -1 }), false);
  assert.equal(loop.noteOn({ note: 11, velocity: Infinity, beat: 0 }), false);
  assert.equal(loop.noteOn({ note: 11, velocity: 100, beat: Infinity }), false);
  for (const note of [11, 12, 13, 14]) {
    for (let step = 0; step < 128; step++) record(loop, note, step / 4, (step + 1) / 4);
  }
  assert.equal(loop.events.length, MAX_LOOP_EVENTS);
  assert.equal(record(loop, 15), null);
  assert.equal(record(loop, 11, 0, 0.5, 127).velocity, 127);
  assert.equal(loop.events.length, MAX_LOOP_EVENTS);
  const imported = loop.serialize();
  imported.events.push({ ...imported.events[0] });
  assert.throws(() => loop.load(imported));
});
