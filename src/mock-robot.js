import { ROBOTS, robotForRole } from '../public/robots.js';
const roles = [...ROBOTS.map(bot => bot.id), 'drums', 'guitar', 'keyboard'];
const role = process.argv[2];
if (!roles.includes(role)) {
  console.error('Usage: npm run robot -- bot-1|bot-2|bot-3 (or drums|guitar|keyboard)');
  process.exitCode = 1;
} else {
  const base = process.env.DEMO_URL || 'http://127.0.0.1:3210';
  const robotId = ROBOTS.some(bot => bot.id === role) ? role : robotForRole(role).id;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  try {
    const response = await fetch(`${base}/api/robots/${robotId}/events`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`Mock ${robotId} connected. Prints signals; does not control hardware. Ctrl+C stops.`);
    let pending = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        for (const line of frame.split('\n')) if (line.startsWith('data: ')) console.log(line.slice(6));
      }
    }
    console.error('Bridge closed. Restart mock to reconnect; old events are not replayed.');
  } catch (error) {
    if (!controller.signal.aborted) { console.error(`Bridge unavailable: ${error.message}`); process.exitCode = 1; }
  }
}
