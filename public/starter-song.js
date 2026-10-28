import { padInfo } from './engine.js';

/** A two-bar C-minor progression that can be loaded straight into the looper. */
export function createStarterSong({ bpm = 110 } = {}) {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new RangeError('bpm must be a finite number between 40 and 240');
  }

  const events = [];
  const add = (note, step, duration_steps, velocity) => {
    const { role } = padInfo(note);
    events.push({
      id: `pad-${note}-step-${step}`,
      note,
      velocity,
      role,
      step,
      duration_steps,
    });
  };

  // Cm → Ab → Eb → Bb: one chord every two beats. Guitar answers one eighth
  // note later; quiet vocal harmonies leave the second and fourth chords open.
  for (let chord = 0; chord < 4; chord++) {
    const step = chord * 8;
    add(11 + chord, step, 8, 86);
    add(55 + chord, step + 2, 6, 72);
    add(51, step, 1, 106);
    add(52, step + 4, 1, 92);
  }
  add(15, 0, 6, 42);
  add(17, 16, 6, 42);
  for (let step = 0; step < 32; step += 2) add(53, step, 1, 50);

  events.sort((a, b) => a.step - b.step || a.note - b.note);
  return {
    schema_version: 1,
    bpm,
    bars: 2,
    steps_per_beat: 4,
    beats_per_bar: 4,
    events,
    muted: [],
  };
}
