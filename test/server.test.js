import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDemoServer } from '../src/server.js';
import { DEFAULT_ROLE_ASSIGNMENTS } from '../public/robots.js';

async function startServer(t, options) {
  const server = createDemoServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (pathname, body, headers = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { base, post };
}

const command = (note = 51, extra = {}) => ({
  type: 'on', note, velocity: 100, bpm: 120, source: 'simulator', ...extra,
});

// A small SSE reader with bounded waits and explicit destruction, so test
// shutdown never depends on a server heartbeat or an open fetch stream.
async function subscribe(t, url) {
  const req = http.get(url);
  req.on('error', () => {});
  t.after(() => req.destroy());
  const [response] = await once(req, 'response');
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  response.setEncoding('utf8');
  const events = [];
  let pending = '';
  let waiter;
  response.on('data', chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n\n')) !== -1) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const data = block.split('\n').find(line => line.startsWith('data: '));
      if (data) {
        const event = JSON.parse(data.slice(6));
        events.push(event);
        if (waiter?.predicate(event)) {
          clearTimeout(waiter.timer);
          waiter.resolve(event);
          waiter = undefined;
        }
      }
    }
  });
  return {
    events,
    next(predicate) {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = undefined;
          reject(new Error('Timed out waiting for SSE event'));
        }, 1500);
        waiter = { predicate, resolve, timer };
      });
    },
  };
}

test('serves browser modules and exposes simulation status', async t => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/engine.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /export function padInfo/);
  assert.equal((await fetch(`${base}/missing-file.txt`)).status, 404);
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.mode, 'simulation');
  assert.equal(status.physical_robots, false);
  assert.deepEqual(status.roles.map(role => role.robot), ['drums', 'guitar', 'keyboard', 'vocals']);
  assert.deepEqual(status.roles.map(role => role.role), ['drums', 'guitar', 'keyboard', 'vocals']);
  assert.deepEqual(status.roles.map(role => role.robot_id), ['bot-1', 'bot-2', 'bot-3', null]);
  assert.equal(status.robots.length, 3);
  assert.deepEqual(status.robots.map(robot => robot.robot_id), ['bot-1', 'bot-2', 'bot-3']);
  assert.deepEqual(status.robots.map(robot => robot.roles), [['drums'], ['guitar'], ['keyboard']]);
});

test('derives role and animation from the pad instead of trusting client fields', async t => {
  const { post } = await startServer(t);
  const result = await post('/api/command', command(51, {
    robot: 'vocals', role: 'vocals', robot_id: 'bot-3', animation: 'arbitrary-motion', duration_ms: 999999,
    now: 0, timestamp_ms: 0,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.event.robot, 'drums');
  assert.equal(result.body.event.role, 'drums');
  assert.equal(result.body.event.robot_id, 'bot-1');
  assert.equal(result.body.event.animation, 'kick');
  assert.equal(result.body.event.duration_ms, 125);
  assert.ok(result.body.event.timestamp_ms > 0);
  assert.equal(result.body.delivery, 'local_bridge');
  assert.equal(result.body.physical_robot_ack, false);
});

test('loop commands receive canonical chord data instead of client-supplied pitches', async t => {
  const { post } = await startServer(t);
  const result = await post('/api/command', command(11, {
    source: 'loop', chord: 'invalid', pitches: [1], pitch: 1,
    robot: 'drums', animation: 'arbitrary-motion', duration_ms: 999999,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.event.source, 'loop');
  assert.equal(result.body.event.robot, 'keyboard');
  assert.equal(result.body.event.robot_id, 'bot-3');
  assert.equal(result.body.event.animation, 'keys_low');
  assert.equal(result.body.event.chord, 'Cm');
  assert.equal(result.body.event.pitch, 48);
  assert.deepEqual(result.body.event.pitches, [48, 51, 55]);
  assert.equal(result.body.event.duration_ms, 500);
  assert.equal(result.body.event.bpm, 120);
});

test('limits triggers per physical robot while passing releases through', async t => {
  const { post } = await startServer(t, { minInterval: 10_000 });
  assert.equal((await post('/api/command', command(51))).body.accepted, true);
  const limited = await post('/api/command', command(52));
  assert.equal(limited.body.accepted, false);
  assert.equal(limited.body.reason, 'rate_limited');
  assert.equal((await post('/api/command', command(55))).body.accepted, true);
  const release = await post('/api/command', command(51, { type: 'off' }));
  assert.equal(release.body.accepted, true);
  assert.equal(release.body.event.type, 'release');
  const zeroVelocity = await post('/api/command', command(52, { velocity: 0 }));
  assert.equal(zeroVelocity.body.accepted, true);
  assert.equal(zeroVelocity.body.event.type, 'release');
});

test('rejects malformed JSON, invalid commands and non-grid notes', async t => {
  const { base, post } = await startServer(t);
  const malformed = await fetch(`${base}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await post('/api/command', [])).status, 400);
  for (const invalid of [
    command(91), command(19), command(50), command(51.5),
    command(51, { velocity: 128 }), command(51, { velocity: -1 }),
    command(51, { bpm: '120' }), command(51, { type: 'pressure' }),
    command(51, { source: 'unknown-client' }),
  ]) assert.equal((await post('/api/command', invalid)).status, 400);
  const wrongType = await fetch(`${base}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await post('/api/command', { padding: 'x'.repeat(5000) })).status, 413);
});

test('rejects cross-origin commands before they reach the bridge', async t => {
  const { base, post } = await startServer(t);
  assert.equal((await post('/api/command', command(), { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post('/api/command', command(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const history = await (await fetch(`${base}/api/events`)).json();
  assert.equal(history.length, 0);
});

test('stop-all emits exactly three physical robot commands and resets the limiter', async t => {
  const { post } = await startServer(t, { minInterval: 10_000 });
  await post('/api/command', command());
  const stop = await post('/api/stop', {});
  assert.equal(stop.status, 200);
  assert.equal(stop.body.events.length, 3);
  assert.deepEqual(stop.body.events.map(event => event.robot_id), ['bot-1', 'bot-2', 'bot-3']);
  assert.deepEqual(stop.body.events.map(event => event.role), ['drums', 'guitar', 'keyboard']);
  for (const event of stop.body.events) {
    assert.equal(event.type, 'stop');
    assert.equal(event.animation, 'idle');
    assert.equal(event.reason, 'user');
  }
  assert.equal((await post('/api/command', command())).body.accepted, true);
});

test('SSE routes only to its role and movement expires without a release', async t => {
  const { base, post } = await startServer(t);
  const drums = await subscribe(t, `${base}/api/robots/drums/events`);
  const guitar = await subscribe(t, `${base}/api/robots/guitar/events`);
  const result = await post('/api/command', command(51, { bpm: 240 }));
  const trigger = await drums.next(event => event.type === 'trigger');
  assert.equal(trigger.sequence, result.body.event.sequence);
  assert.equal(trigger.robot, 'drums');
  assert.equal(trigger.robot_id, 'bot-1');
  const expired = await drums.next(event => event.type === 'stop');
  assert.equal(expired.reason, 'expired');
  assert.equal(expired.robot, 'drums');
  assert.equal(expired.robot_id, 'bot-1');
  assert.ok(expired.sequence > trigger.sequence);
  assert.deepEqual(guitar.events, []);
});

test('shared SSE multiplexes all roles and stop commands without replaying history', async t => {
  const { base, post } = await startServer(t, { minInterval: 0 });
  const historical = await post('/api/command', command(15, { bpm: 40 }));
  assert.equal(historical.body.accepted, true);

  const stream = await subscribe(t, `${base}/api/stream`);
  const accepted = [];
  for (const note of [51, 55, 11, 15]) {
    const result = await post('/api/command', command(note, { bpm: 40 }));
    assert.equal(result.body.accepted, true);
    accepted.push(result.body.event);
  }
  await stream.next(event => event.sequence === accepted.at(-1).sequence);
  const triggers = stream.events.filter(event => event.type === 'trigger');
  assert.deepEqual(triggers.map(event => event.robot), ['drums', 'guitar', 'keyboard', 'vocals']);
  assert.deepEqual(triggers.map(event => event.robot_id), ['bot-1', 'bot-2', 'bot-3', null]);
  assert.deepEqual(triggers.map(event => event.sequence), accepted.map(event => event.sequence));
  assert.ok(stream.events.every(event => event.sequence > historical.body.event.sequence));

  const result = await post('/api/stop', {});
  await stream.next(event => event.sequence === result.body.events.at(-1).sequence);
  assert.deepEqual(
    stream.events.filter(event => event.type === 'stop' && event.reason === 'user').map(event => event.robot_id),
    ['bot-1', 'bot-2', 'bot-3'],
  );
});

test('shared SSE and role SSE deliver the same trigger and expiry exactly once', async t => {
  const { base, post } = await startServer(t);
  const shared = await subscribe(t, `${base}/api/stream`);
  const role = await subscribe(t, `${base}/api/robots/drums/events`);
  const result = await post('/api/command', command(51, { bpm: 240 }));
  const expiry = await shared.next(event => event.type === 'stop' && event.reason === 'expired');
  await role.next(event => event.sequence === expiry.sequence);
  assert.deepEqual(shared.events, role.events);
  assert.deepEqual(shared.events.map(event => event.type), ['trigger', 'stop']);
  assert.equal(shared.events[0].sequence, result.body.event.sequence);
});

test('physical bot endpoints and compatible role aliases share one routed stream', async t => {
  const { base, post } = await startServer(t);
  const physical = await subscribe(t, `${base}/api/robots/bot-2/events`);
  const alias = await subscribe(t, `${base}/api/robots/guitar/events`);
  for (const unavailable of ['vocals', 'bot-4']) {
    assert.equal((await fetch(`${base}/api/robots/${unavailable}/events`)).status, 404);
  }
  const result = await post('/api/command', command(55, { bpm: 40 }));
  const actual = await physical.next(event => event.sequence === result.body.event.sequence);
  const compatible = await alias.next(event => event.sequence === actual.sequence);
  assert.deepEqual(actual, compatible);
  assert.equal(actual.role, 'guitar');
  assert.equal(actual.robot_id, 'bot-2');
});

test('unassigned vocals remain global audio-only events without a fourth bot or movement limiter', async t => {
  const { base, post } = await startServer(t, { minInterval: 10_000 });
  const shared = await subscribe(t, `${base}/api/stream`);
  const physical = await Promise.all(['bot-1', 'bot-2', 'bot-3'].map(id => subscribe(t, `${base}/api/robots/${id}/events`)));
  for (const note of [15, 16]) {
    const result = await post('/api/command', command(note));
    assert.equal(result.body.accepted, true);
    assert.equal(result.body.delivery, 'audio_only');
    assert.equal(result.body.event.role, 'vocals');
    assert.equal(result.body.event.robot_id, null);
    await shared.next(event => event.sequence === result.body.event.sequence);
  }
  const stop = await post('/api/stop', {});
  await shared.next(event => event.sequence === stop.body.events.at(-1).sequence);
  for (let index = 0; index < physical.length; index++) {
    await physical[index].next(event => event.robot_id === `bot-${index + 1}` && event.type === 'stop');
    assert.deepEqual(physical[index].events.map(event => event.type), ['stop']);
  }
  assert.equal(shared.events.filter(event => event.type === 'trigger').length, 2);
});

test('different musical roles assigned to one robot share its movement limiter', async t => {
  const assignments = { ...DEFAULT_ROLE_ASSIGNMENTS, vocals: 'bot-2' };
  const { base, post } = await startServer(t, { minInterval: 10_000, assignments });
  assert.equal((await post('/api/command', command(55))).body.accepted, true);
  const vocals = await post('/api/command', command(15));
  assert.equal(vocals.body.accepted, false);
  assert.equal(vocals.body.reason, 'rate_limited');
  assert.equal((await post('/api/command', command(11))).body.accepted, true);
  const release = await post('/api/command', command(55, { type: 'off' }));
  assert.equal(release.body.accepted, true);
  assert.equal(release.body.event.robot_id, 'bot-2');
  assert.equal(release.body.event.scope, 'pad');
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.deepEqual(status.robots.find(robot => robot.robot_id === 'bot-2').roles, ['guitar', 'vocals']);
});

test('a newer role gesture replaces the old role TTL on their shared robot', async t => {
  const assignments = { ...DEFAULT_ROLE_ASSIGNMENTS, vocals: 'bot-2' };
  const { base, post } = await startServer(t, { minInterval: 0, assignments });
  const stream = await subscribe(t, `${base}/api/robots/bot-2/events`);
  const guitar = await post('/api/command', command(55, { bpm: 240 }));
  const vocals = await post('/api/command', command(15, { bpm: 40 }));
  assert.equal(guitar.body.event.duration_ms, 250);
  assert.equal(vocals.body.event.duration_ms, 1500);
  await stream.next(event => event.sequence === vocals.body.event.sequence);
  await new Promise(resolve => setTimeout(resolve, 330));
  assert.deepEqual(stream.events.map(event => event.type), ['trigger', 'trigger']);
  assert.deepEqual(stream.events.map(event => event.role), ['guitar', 'vocals']);
  await post('/api/stop', {});
});

test('stop-all still covers unused physical robots with no primary musical role', async t => {
  const assignments = { drums: 'bot-1', guitar: 'bot-1', keyboard: null, vocals: null };
  const { post } = await startServer(t, { assignments });
  const stop = await post('/api/stop', {});
  assert.deepEqual(stop.body.events.map(event => event.robot_id), ['bot-1', 'bot-2', 'bot-3']);
  assert.deepEqual(stop.body.events.map(event => event.role), ['drums', null, null]);
  assert.deepEqual(stop.body.events.map(event => event.robot), ['drums', null, null]);
});
