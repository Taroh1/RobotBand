import { padInfo } from './engine.js';

/** Keep a manual selection; otherwise choose only the Launchpad X MIDI interface. */
export function pickMidiPort(ports, preferredId) {
  const candidates = Array.from(ports?.values?.() ?? ports ?? [])
    .filter(port => port && port.state === 'connected');
  const preferred = candidates.find(port => port.id === preferredId);
  if (preferred) return preferred;

  const launchpads = candidates.filter(port => /launchpad\s*x\b|\blpx\b|launchpad.*\bx\b/i.test(port.name ?? ''));
  const score = port => {
    const name = port.name ?? '';
    if (/\bdaw\b/i.test(name)) return -10;
    if (/midi\s*(?:in|out)\s*2\b|\bmidi\s*2\b|\b2\s*[-:]?\s*launchpad/i.test(name)) return 30;
    if (/\blpx\s+midi\b|launchpad\s*x.*\bmidi\b/i.test(name)) return 20;
    return 0;
  };
  launchpads.sort((a, b) => score(b) - score(a));
  return launchpads[0] ?? null;
}

/** Inspect valid complete MIDI frames, including frames the pad engine ignores. */
export function midiPacketInfo(data) {
  if (!data || !Number.isInteger(data.length) || data.length < 1) return null;
  const bytes = Array.from(data);
  if (!bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  const status = bytes[0];
  if (status < 0x80) return null;
  const family = status & 0xf0;

  if (status === 0xf0) {
    if (bytes.length < 2 || bytes.at(-1) !== 0xf7 || bytes.slice(1, -1).some(byte => byte > 127)) return null;
  } else {
    let expected;
    if (status < 0xf0) expected = family === 0xc0 || family === 0xd0 ? 2 : 3;
    else expected = ({ 0xf1: 2, 0xf2: 3, 0xf3: 2, 0xf6: 1, 0xf7: 1 })[status] ?? (status >= 0xf8 ? 1 : 0);
    if (!expected || bytes.length !== expected || bytes.slice(1).some(byte => byte > 127)) return null;
  }

  const result = {
    statusHex: bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '),
    kind: 'other',
    isGrid: false,
  };
  if (status === 0xf8) result.kind = 'clock';
  else if (family === 0x80 || family === 0x90 || family === 0xa0) {
    result.kind = family === 0xa0 ? 'pressure' : family === 0x80 || bytes[2] === 0 ? 'note_off' : 'note_on';
    result.note = bytes[1];
    result.value = bytes[2];
    result.isGrid = padInfo(bytes[1]) !== null;
  } else if (family === 0xb0) {
    result.kind = 'control';
    result.controller = bytes[1];
    result.value = bytes[2];
  } else if (family === 0xd0) {
    result.kind = 'pressure';
    result.value = bytes[1];
  }
  return result;
}
