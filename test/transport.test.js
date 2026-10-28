import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopTransport } from '../public/transport.js';

test('audio-clock steps stay on the same grid over several loops', () => {
  let clock = 5;
  const events = [];
  const transport = new LoopTransport({ now: () => clock, onStep: (step, when) => events.push({ step, when }) });
  transport.start(120);
  for (let i = 0; i < 1000; i++) { transport.pump(); clock += 0.025; }
  assert.ok(events.length > 190);
  for (const event of events) assert.ok(Math.abs(event.when - (5.08 + event.step * 0.125)) < 1e-8);
  assert.equal(new Set(events.map(event => event.step)).size, events.length);
});

test('long scheduling stalls skip expired notes, stop cancels future scheduling', () => {
  let clock = 0;
  const events = [];
  const transport = new LoopTransport({ now: () => clock, onStep: (step, when) => events.push({ step, when }) });
  transport.start(); transport.pump();
  clock = 10; transport.pump();
  assert.ok(events.length < 4);
  assert.ok(events.at(-1).when >= 10);
  transport.stop(); const count = events.length; clock = 20; transport.pump();
  assert.equal(events.length, count);
  assert.equal(transport.beat, 0);
});

test('tempo and beat conversion reset cleanly on restart', () => {
  let clock = 0;
  const transport = new LoopTransport({ now: () => clock, onStep: () => {} });
  assert.throws(() => transport.start(NaN)); assert.throws(() => transport.start(300));
  transport.start(60); clock = 2.08;
  assert.ok(Math.abs(transport.beat - 2) < 1e-8);
  transport.stop(); transport.start(120);
  assert.equal(transport.nextStep, 0); assert.equal(transport.stepDuration, 0.125);
});
