import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createCommand, ROLES } from '../public/engine.js';
import { ROBOTS, DEFAULT_ROLE_ASSIGNMENTS, robotForRole, rolesForRobot, validateAssignments } from '../public/robots.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const roleIds = ROLES.map(role => role.id);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

export function createDemoServer({ minInterval = 120, assignments = DEFAULT_ROLE_ASSIGNMENTS } = {}) {
  const routing = validateAssignments(assignments);
  const streams = new Map(ROBOTS.map(robot => [robot.id, new Set()]));
  const sharedStreams = new Set();
  const simrobotStreams = new Set();
  const recent = [];
  const lastTrigger = new Map();
  const timers = new Map();
  let sequence = 0;

  function publish(command) {
    const event = { ...command, sequence: ++sequence, received_at: new Date().toISOString() };
    recent.push(event);
    if (recent.length > 200) recent.shift();
    for (const stream of [...(streams.get(event.robot_id) ?? []), ...sharedStreams]) {
      if (!stream.write(`data: ${JSON.stringify(event)}\n\n`)) stream.destroy();
    }
    return event;
  }

  function stopAll(reason = 'user') {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    lastTrigger.clear();
    return ROBOTS.map(bot => {
      const role = rolesForRobot(bot.id, routing)[0] ?? null;
      return publish({ schema_version: 1, type: 'stop', robot: role, role, robot_id: bot.id,
        scope: 'robot', animation: 'idle', duration_ms: 0, reason, timestamp_ms: Date.now() });
    });
  }

  const server = http.createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Local browser only: reject cross-origin control requests and DNS rebinding.
    const host = req.headers.host;
    if (!host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(403, { error: 'Local host required' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, { error: 'Same origin required' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Same origin required' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, `http://${host}`).pathname); }
    catch { return json(400, { error: 'Invalid URL' }); }
    try {
      if (req.method === 'GET' && pathname === '/api/status') return json(200, {
        service: 'robot-band', api_version: 1, mode: 'simulation', min_interval_ms: minInterval, physical_robots: false,
        roles: roleIds.map(role => ({ robot: role, role, robot_id: routing[role],
          subscribers: streams.get(routing[role])?.size ?? 0 })),
        robots: ROBOTS.map(robot => ({ robot_id: robot.id, label: robot.label,
          roles: rolesForRobot(robot.id, routing), subscribers: streams.get(robot.id).size })),
        shared_subscribers: sharedStreams.size, simrobot: { connected: simrobotStreams.size > 0, subscribers: simrobotStreams.size }, events: recent.length
      });
      if (req.method === 'GET' && pathname === '/api/events') return json(200, recent);
      const roleMatch = /^\/api\/robots\/(bot-[123]|drums|guitar|keyboard|vocals)\/events$/.exec(pathname);
      const streamRobot = roleMatch && (ROBOTS.find(robot => robot.id === roleMatch[1]) ?? robotForRole(roleMatch[1], routing));
      if (roleMatch && !streamRobot) return json(404, { error: 'No robot assigned to this musical role' });
      if (req.method === 'GET' && (roleMatch || pathname === '/api/stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected; live events only, no replay\n\n');
        const clients = roleMatch ? streams.get(streamRobot.id) : sharedStreams;
        clients.add(res);
        if (req.headers['x-robotband-client'] === 'simrobot-v1') simrobotStreams.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 1000);
        req.on('close', () => { clients.delete(res); simrobotStreams.delete(res); clearInterval(heartbeat); });
        return;
      }
      if (req.method === 'POST' && (pathname === '/api/command' || pathname === '/api/stop')) {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return json(413, { error: 'Body too large' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON' }); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { error: 'Object required' });
        if (pathname === '/api/stop') return json(200, { accepted: true, events: stopAll('user') });
        // Derive the robot and animation on the server; do not trust client role fields.
        if (!['on', 'off'].includes(input.type) || !['simulator', 'launchpad', 'demo', 'loop'].includes(input.source)
          || !Number.isInteger(input.note) || !Number.isInteger(input.velocity)
          || input.velocity < 0 || input.velocity > 127 || !Number.isFinite(input.bpm)) {
          return json(400, { error: 'Invalid command' });
        }
        const musicalCommand = createCommand({ ...input, now: Date.now() });
        if (!musicalCommand) return json(400, { error: 'Not an 8x8 grid pad' });
        const command = { ...musicalCommand, role: musicalCommand.robot, robot_id: routing[musicalCommand.robot] };
        const robotId = command.robot_id;
        const now = Date.now();
        if (robotId && command.type === 'trigger' && now - (lastTrigger.get(robotId) ?? -Infinity) < minInterval) {
          return json(200, { accepted: false, reason: 'rate_limited' });
        }
        if (robotId && command.type === 'trigger') lastTrigger.set(robotId, now);
        const event = publish(command);
        // One-shot movement lifetime: no stale animation if a browser disappears.
        if (robotId && command.type === 'trigger') {
          clearTimeout(timers.get(robotId));
          timers.set(robotId, setTimeout(() => {
            publish({ schema_version: 1, robot: command.robot, role: command.role, robot_id: robotId,
              scope: 'robot', type: 'stop', animation: 'idle',
              duration_ms: 0, reason: 'expired', timestamp_ms: Date.now() });
            timers.delete(robotId);
          }, command.duration_ms));
        }
        return json(200, { accepted: true, event, delivery: robotId ? 'local_bridge' : 'audio_only', physical_robot_ack: false });
      }
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const file = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(resolve(publicDir) + sep)) return json(403, { error: 'Forbidden' });
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (error) {
      if (!res.headersSent) json(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500,
        { error: error.code === 'ENOENT' || error.code === 'EISDIR' ? 'Not found' : 'Request failed' });
      else res.end();
    }
  });
  server.on('close', () => { for (const timer of timers.values()) clearTimeout(timer); });
  server.stopRobots = stopAll;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`Launchpad Robot Band: http://127.0.0.1:${port}\nLocal simulation; no physical K1 adapter attached.`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  const shutdown = () => { server.stopRobots('server_shutdown'); server.closeAllConnections(); server.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
