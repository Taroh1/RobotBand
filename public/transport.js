/** Audio-clock scheduler. The UI timer only fills a small future audio window. */
export class LoopTransport {
  constructor({ now, onStep, bpm = 120, stepsPerBeat = 4, lookahead = 0.12 }) {
    this.now = now;
    this.onStep = onStep;
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.lookahead = lookahead;
    this.playing = false;
    this.nextStep = 0;
    this.startTime = 0;
  }

  start(bpm = this.bpm) {
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('BPM must be between 40 and 240');
    this.bpm = bpm;
    this.nextStep = 0;
    this.startTime = this.now() + 0.08;
    this.playing = true;
  }

  get stepDuration() { return 60 / this.bpm / this.stepsPerBeat; }
  get beat() { return this.playing ? Math.max(0, (this.now() - this.startTime) * this.bpm / 60) : 0; }

  pump() {
    if (!this.playing) return;
    const now = this.now();
    // Never burst stale notes after a suspended tab or a long main-thread pause.
    const current = Math.max(0, Math.ceil((now - this.startTime) / this.stepDuration - 1e-7));
    if (this.nextStep < current - 1) this.nextStep = current;
    while (this.playing && this.startTime + this.nextStep * this.stepDuration < now + this.lookahead) {
      const step = this.nextStep++;
      const when = this.startTime + step * this.stepDuration;
      if (when >= now - 0.02) this.onStep(step, Math.max(now, when));
    }
  }

  stop() { this.playing = false; this.nextStep = 0; }
}
