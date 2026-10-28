import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoAudio } from '../public/audio.js';

class Parameter {
  value = 0;
  calls = [];
  setValueAtTime(...args) { this.calls.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.calls.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args) { this.calls.push(['exponential', ...args]); }
  cancelScheduledValues(...args) { this.calls.push(['cancel', ...args]); }
  cancelAndHoldAtTime(...args) { this.calls.push(['hold', ...args]); }
}
class Node {
  gain = new Parameter();
  frequency = new Parameter();
  connections = [];
  stops = [];
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(time) { this.startAt = time; }
  stop(time) { this.stops.push(time); }
}
class FakeContext {
  state = 'suspended';
  currentTime = 2;
  sampleRate = 1000;
  destination = {};
  sources = [];
  async resume() { this.state = 'running'; }
  createGain() { return new Node(); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => [name, new Parameter()])));
  }
  createOscillator() { const node = new Node(); this.sources.push(node); return node; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createBiquadFilter() { return new Node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
}
const chord = { robot: 'keyboard', pitches: [48, 51, 55], pitch: 48, intensity: 0.8, duration_ms: 500 };

async function setup() {
  globalThis.AudioContext = FakeContext;
  const audio = new DemoAudio();
  await audio.enable();
  return audio;
}

test('enable is explicit and chords schedule every pitch on the audio clock', async () => {
  const audio = await setup();
  assert.equal(audio.currentTime, 2);
  assert.equal(audio.play('chord', chord, { when: 3, duration: 1.5 }), true);
  const voice = audio.voices.get('chord');
  assert.equal(voice.sources.length, 6);
  assert.ok(voice.sources.every(node => node.startAt === 3));
  assert.equal(voice.endAt, 4.5);
  assert.equal(audio.context.sources[0].frequency.calls[0][1], 440 * 2 ** ((48 - 69) / 12));
});

test('short taps retain an audible attack but panic cancels scheduled notes immediately', async () => {
  const audio = await setup();
  audio.play('tap', chord);
  const voice = audio.voices.get('tap');
  audio.stop('tap');
  assert.deepEqual(voice.gain.gain.calls.find(call => call[0] === 'hold'), ['hold', 2.15]);
  audio.play('future', chord, { when: 10 });
  const future = audio.voices.get('future');
  audio.stopAll();
  assert.equal(audio.voices.size, 0);
  assert.ok(future.sources.every(node => node.stops.at(-1) === 2 && node.disconnected));
  assert.ok(voice.gain.disconnected);
});

test('voice limits include future notes and cleanup waits for all chord voices', async () => {
  const audio = await setup();
  for (let i = 0; i < 80; i++) audio.play(`future-${i}`, { ...chord, pitches: [48, 51, 55, 58] }, { when: 8 });
  assert.ok(audio.voices.size <= 32);
  assert.ok([...audio.voices.values()].reduce((sum, voice) => sum + voice.sources.length, 0) <= 96);
  const key = [...audio.voices.keys()][0], voice = audio.voices.get(key);
  voice.sources[0].onended();
  assert.ok(audio.voices.has(key));
  for (const source of voice.sources.slice(1)) source.onended();
  assert.equal(audio.voices.has(key), false);
  assert.ok(voice.nodes.every(node => node.disconnected));
});

test('noise nodes disconnect, metronome schedules, and toggle stops all audio', async () => {
  const audio = await setup();
  audio.play('snare', { robot: 'drums', animation: 'snare', pitches: [38], intensity: 1 });
  const snare = audio.voices.get('snare');
  assert.equal(snare.sources.length, 1);
  snare.sources[0].onended();
  assert.ok(snare.nodes.every(node => node.disconnected));
  audio.tick(4, true);
  assert.equal(audio.context.sources.at(-1).startAt, 4);
  assert.equal(await audio.toggle(), false);
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.play('off', chord), false);
});

test('invalid timing and pitches do not allocate audio nodes', async () => {
  const audio = await setup();
  assert.equal(audio.play('invalid', chord, { when: NaN }), false);
  assert.equal(audio.play('invalid', { ...chord, pitches: [-1, 150, NaN] }), false);
  assert.equal(audio.voices.size, 0);
});

test('long loop gates remain intact and extreme gates are bounded', async () => {
  const audio = await setup();
  audio.play('eight-bars', chord, { when: 3, duration: 48 });
  assert.equal(audio.voices.get('eight-bars').endAt, 51);
  audio.play('bounded', chord, { when: 3, duration: 1000 });
  assert.equal(audio.voices.get('bounded').endAt, 67);
});

test('releasing an already faded tail never schedules gain automation in the past', async () => {
  const audio = await setup();
  audio.play('tail', chord, { duration: 0.5 });
  const voice = audio.voices.get('tail');
  audio.context.currentTime = 2.52;
  audio.stop('tail');
  assert.deepEqual(voice.gain.gain.calls.find(call => call[0] === 'hold'), ['hold', 2.52]);
  assert.ok(voice.sources.every(source => source.stops.at(-1) > audio.currentTime));
});
