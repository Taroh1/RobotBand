export class DemoAudio {
  context = null;
  enabled = false;
  voices = new Map();
  master = null;
  metronomeSequence = 0;

  get currentTime() { return this.context?.currentTime ?? 0; }

  async enable() {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio wird von diesem Browser nicht unterstützt.');
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.65;
      // The compressor keeps several layered chords from clipping the demo output.
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 18;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      this.master.connect(compressor).connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.enabled = true;
    return true;
  }

  async toggle() {
    if (!this.enabled) return this.enable();
    this.enabled = false;
    this.stopAll();
    return false;
  }

  /** `when` and `duration` are AudioContext seconds, so loop audio can be scheduled. */
  play(key, command, { when = this.currentTime, duration = null } = {}) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return false;
    if (!command || !Number.isFinite(when) || (duration !== null && !Number.isFinite(duration))) return false;
    const input = Array.isArray(command.pitches) ? command.pitches : [command.pitch];
    const pitches = [...new Set(input)].filter(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127).slice(0, 8);
    if (!pitches.length) return false;
    const role = command.robot;
    const drum = role === 'drums', tick = role === 'metronome';
    const sounding = drum ? pitches.slice(0, 1) : pitches;
    const partials = role === 'keyboard' ? 2 : 1;
    const sourceCount = sounding.length * partials;
    this.stop(key, { immediate: true });
    // Count scheduled sources as well as already sounding ones.
    const activeSources = () => [...this.voices.values()].reduce((sum, voice) => sum + voice.sources.length, 0);
    while (this.voices.size >= 32 || activeSources() + sourceCount > 96) {
      this.stop(this.voices.keys().next().value, { immediate: true });
    }
    const ctx = this.context, t = Math.max(ctx.currentTime, when);
    const defaultDrumDuration = ({ kick: 0.24, snare: 0.18, hihat: 0.10, cymbal: 0.35, tom: 0.22 })[command.animation] ?? 0.18;
    const commandDuration = Number.isFinite(command.duration_ms) ? command.duration_ms / 1000 : 0.6;
    const length = Math.max(0.04, Math.min(64, duration ?? (drum ? defaultDrumDuration : tick ? 0.045 : Math.max(0.4, commandDuration))));
    const intensity = Number.isFinite(command.intensity) ? Math.max(0, Math.min(1, command.intensity)) : 0.7;
    const peak = intensity * (drum ? 0.18 : tick ? 0.09 : 0.105) / Math.sqrt(sounding.length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + Math.min(0.015, length / 4));
    if (role === 'guitar' || drum || tick) {
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    } else {
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, peak * 0.7), t + length * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    }
    gain.connect(this.master);
    const voice = { sources: [], nodes: [gain], gain, startAt: t, endAt: t + length, peak, remaining: 0, disposed: false, releasing: false };
    this.voices.set(key, voice);

    const addSource = (node, output, startAt = t) => {
      voice.sources.push(node);
      voice.nodes.push(node);
      node.connect(output);
      node.onended = () => {
        if (voice.disposed) return;
        voice.remaining--;
        if (!voice.remaining) this.dispose(key, voice);
      };
      voice.remaining++;
      node.start(startAt);
      node.stop(t + length + 0.035);
    };

    if (drum && command.animation !== 'kick' && command.animation !== 'tom') {
      const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * length)), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = command.animation === 'snare' ? 850 : 4500;
      filter.connect(gain);
      voice.nodes.push(filter);
      addSource(noise, filter);
    } else {
      for (const [index, pitch] of sounding.entries()) {
        const hz = tick ? (pitch === 84 ? 1760 : 1100) : 440 * 2 ** ((pitch - 69) / 12);
        const node = ctx.createOscillator();
        node.type = role === 'guitar' ? 'triangle' : 'sine';
        node.frequency.setValueAtTime(drum ? (command.animation === 'kick' ? 140 : hz) : hz, t);
        if (drum) node.frequency.exponentialRampToValueAtTime(command.animation === 'kick' ? 40 : hz * 0.7, t + length);
        // A small strum offset separates guitar attacks without shifting the beat.
        addSource(node, gain, t + (role === 'guitar' ? index * Math.min(0.007, length / 32) : 0));
        if (role === 'keyboard') {
          const harmonic = ctx.createOscillator();
          harmonic.type = 'sine';
          harmonic.frequency.setValueAtTime(hz * 2, t);
          const harmonicGain = ctx.createGain();
          harmonicGain.gain.value = 0.18;
          harmonicGain.connect(gain);
          voice.nodes.push(harmonicGain);
          addSource(harmonic, harmonicGain);
        }
      }
    }
    return true;
  }

  dispose(key, voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
    if (this.voices.get(key) === voice) this.voices.delete(key);
  }

  stop(key, { immediate = false } = {}) {
    const voice = this.voices.get(key);
    if (!voice) return;
    const now = this.currentTime;
    if (immediate || voice.startAt > now) {
      for (const node of voice.sources) { try { node.stop(now); } catch { /* Already ended. */ } }
      this.dispose(key, voice);
      return;
    }
    if (voice.releasing) return;
    voice.releasing = true;
    // A quick mouse tap still leaves an audible chord. Panic bypasses this guard.
    const releaseAt = Math.max(now, Math.min(voice.endAt, voice.startAt + 0.15));
    const parameter = voice.gain.gain;
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(releaseAt);
    else {
      parameter.cancelScheduledValues(releaseAt);
      parameter.setValueAtTime(Math.max(0.0001, Math.min(voice.peak, parameter.value || voice.peak)), releaseAt);
    }
    parameter.exponentialRampToValueAtTime(0.0001, releaseAt + 0.06);
    for (const node of voice.sources) { try { node.stop(releaseAt + 0.075); } catch { /* Already ended. */ } }
  }

  stopAll() { for (const key of [...this.voices.keys()]) this.stop(key, { immediate: true }); }

  tick(when = this.currentTime, accent = false) {
    return this.play(`metronome:${++this.metronomeSequence}`, {
      robot: 'metronome', pitch: accent ? 84 : 79, intensity: accent ? 0.6 : 0.4, duration_ms: 45,
    }, { when, duration: 0.045 });
  }
}
