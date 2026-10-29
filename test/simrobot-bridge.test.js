import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createDemoServer } from '../src/server.js';

const executable = fileURLToPath(new URL('../external/BHumanCodeRelease/Build/Windows/SimRobot/Develop/RobotBandBridgeProbe.exe', import.meta.url));

test('native SimRobot bridge: live routing, pad releases, expiry, stop and reconnect', {
  skip: process.platform !== 'win32' || !existsSync(executable), timeout: 20000,
}, async t => {
  let server = createDemoServer({ minInterval: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const probe = spawn(executable, [String(port)], { cwd: dirname(executable), windowsHide: true });
  const states = [];
  let pending = '';
  let errorText = '';
  probe.stderr.on('data', data => { errorText += data; });
  probe.stdout.on('data', data => {
    pending += data;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
      if (line) states.push(JSON.parse(line));
    }
  });
  t.after(async () => {
    probe.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function waitFor(predicate, start = 0) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const found = states.slice(start).find(predicate);
      if (found) return found;
      if (probe.exitCode !== null) throw new Error(`Native probe exited: ${probe.exitCode}; ${errorText}`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out: ${JSON.stringify(states.at(-1))}; ${errorText}`);
  }
  async function post(path, body) {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  }
  const on = note => ({ type: 'on', note, velocity: 100, bpm: 40, source: 'loop' });
  await waitFor(state => state.connected);
  assert.equal((await (await fetch(`${base}/api/status`)).json()).simrobot.connected, true);
  let mark = states.length;
  for (const note of [51, 55, 11]) assert.equal((await post('/api/command', on(note))).accepted, true);
  const active = await waitFor(state => state.robots.every(robot => robot.active), mark);
  assert.deepEqual(active.robots.map(robot => robot.animation), ['kick', 'strum_low', 'keys_low']);
  assert.ok(active.robots[0].intensity > 0.78);
  mark = states.length;
  await post('/api/command', { ...on(56), type: 'off', velocity: 0 });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(states.at(-1).robots[1].active, true, 'unrelated pad release must not stop the guitar');
  await waitFor(state => state.robots.every(robot => !robot.active), mark);
  mark = states.length;
  await post('/api/command', on(55));
  await waitFor(state => state.robots[1].active, mark);
  mark = states.length;
  await post('/api/stop', {});
  await waitFor(state => state.robots.every(robot => !robot.active), mark);

  mark = states.length;
  await post('/api/command', on(11));
  await waitFor(state => state.robots[2].active, mark);
  mark = states.length;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await waitFor(state => !state.connected && state.robots.every(robot => !robot.active), mark);
  server = createDemoServer({ minInterval: 0 });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  mark = states.length;
  await waitFor(state => state.connected, mark);
  mark = states.length;
  await post('/api/command', on(55)); // server sequences restart at 1
  await waitFor(state => state.robots[1].active, mark);
});
