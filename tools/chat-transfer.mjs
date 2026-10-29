import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generateKey, seal, open } from './chat-crypto.mjs';
import { findCodexBinary, startCodex } from './codex-rpc.mjs';

export const THREAD_ID = '01a182a5-5838-7020-81ed-821b3eed52b2';
const PAYLOAD_FORMAT = 'robotband-visible-chat-v1';
const TOOL_REPO = fileURLToPath(new URL('../',import.meta.url));

function canonicalPath(path) {
  const absolute=resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent=dirname(absolute);
  return parent===absolute ? absolute : join(canonicalPath(parent),absolute.slice(parent.length).replace(/^[/\\]+/,''));
}

function keepKeyOutside(keyFile, project = TOOL_REPO) {
  const key=canonicalPath(keyFile);
  for (const root of [TOOL_REPO,project]) {
    const child=relative(canonicalPath(root),key);
    if (!child.startsWith('..') && !isAbsolute(child)) throw new Error('Key file must stay outside the Git repository.');
  }
}

function latestState(home) {
  const files = readdirSync(home).filter(name => /^state_\d+\.sqlite$/.test(name));
  files.sort((a,b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  if (!files.length) throw new Error('Codex state database not found. Start Codex once on this device first.');
  return join(home, files[0]);
}

/** Read just this thread. Credentials, other chats, tools and reasoning are not collected. */
export function collectHistory(home, id = THREAD_ID) {
  const state = new DatabaseSync(latestState(home), { readOnly: true });
  let thread;
  try { thread = state.prepare('SELECT * FROM threads WHERE id = ?').get(id); }
  finally { state.close(); }
  if (!thread) throw new Error('Requested local chat was not found.');
  const historyPath = join(home, 'thread_history_1.sqlite');
  if (!existsSync(historyPath)) throw new Error('This exporter needs the paginated Codex chat store.');
  const db = new DatabaseSync(historyPath, { readOnly: true });
  let rows;
  try {
    rows = db.prepare("SELECT turn_id, item_id, created_at_ms, item_json FROM thread_items WHERE thread_id = ? AND item_type IN ('userMessage', 'agentMessage') ORDER BY rollout_ordinal, created_at_ms").all(id);
  } finally { db.close(); }
  const messages = [];
  for (const row of rows) {
    const item = JSON.parse(row.item_json);
    const user = item.type === 'userMessage';
    if (!user && !['commentary', 'final_answer'].includes(item.phase)) continue;
    const text = user
      ? (item.content ?? []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
      : item.text;
    if (typeof text !== 'string' || !text.trim()) continue;
    messages.push({ turn_id: row.turn_id, item_id: row.item_id, created_at_ms: row.created_at_ms,
      role: user ? 'user' : 'assistant', phase: user ? null : item.phase, text });
  }
  if (!messages.some(message => message.role === 'user')) throw new Error('No visible chat messages found.');
  return {
    format: PAYLOAD_FORMAT, exported_at: new Date().toISOString(),
    thread: { id, title: thread.name || thread.title || 'Roboterband', created_at: thread.created_at,
      source_cli_version: thread.cli_version || '', model_provider: thread.model_provider || 'openai' },
    project_url: 'https://github.com/Taroh1/RobotBand', messages,
  };
}

function validatePayload(payload) {
  if (!payload || payload.format !== PAYLOAD_FORMAT || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(payload.thread?.id)
    || typeof payload.thread.title !== 'string' || payload.thread.title.length > 1000
    || !Number.isFinite(payload.thread.created_at) || !Array.isArray(payload.messages)
    || !payload.messages.length || payload.messages.length > 100000) throw new Error('Invalid chat archive.');
  for (const message of payload.messages) {
    if (!['user','assistant'].includes(message.role) || typeof message.text !== 'string'
      || typeof message.turn_id !== 'string' || typeof message.item_id !== 'string'
      || !Number.isFinite(message.created_at_ms)
      || (message.role === 'assistant' && !['commentary','final_answer'].includes(message.phase))) {
      throw new Error('Invalid visible chat message.');
    }
  }
  return payload;
}

/** Produce an ordinary native legacy transcript using visible messages only. */
export function buildRollout(payload, cwd, nativeMeta = {}) {
  validatePayload(payload);
  const id = payload.thread.id, records = [];
  const add = (type, data, time) => records.push({ timestamp: new Date(time).toISOString(), ordinal: records.length, type, payload: data });
  const created = payload.thread.created_at * 1000;
  add('session_meta', { id, session_id: id, timestamp: new Date(created).toISOString(), cwd,
    originator: 'codex_vscode', cli_version: nativeMeta.cli_version || payload.thread.source_cli_version,
    source: 'vscode', thread_source: 'user', model_provider: 'openai', history_mode: 'legacy' }, created);
  let currentTurn = null, lastTime = created, finalText = null;
  const closeTurn = () => {
    if (currentTurn) add('event_msg', { type: 'task_complete', turn_id: currentTurn, root_turn_id: currentTurn,
      last_agent_message: finalText, completed_at: Math.floor(lastTime / 1000) }, lastTime);
  };
  for (const message of payload.messages) {
    const time = Math.max(created, message.created_at_ms);
    if (message.turn_id !== currentTurn) {
      closeTurn(); currentTurn = message.turn_id; finalText = null;
      add('event_msg', { type: 'task_started', turn_id: currentTurn, root_turn_id: currentTurn,
        turn_attribution: { turn_id:currentTurn, turn_trigger:'composer', parent_turn_id:null,
          initiating_agent_path:null, root_turn_id:currentTurn },
        started_at: Math.floor(time / 1000), model_context_window: null, collaboration_mode_kind: 'default' }, time);
    }
    const content = [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.text }];
    add('response_item', { type: 'message', id: message.item_id, role: message.role, content,
      ...(message.role === 'assistant' ? { phase: message.phase } : {}) }, time);
    add('event_msg', message.role==='user'
      ? { type:'user_message', id:message.item_id, message:message.text, images:[],local_images:[],text_elements:[] }
      : { type:'agent_message', id:message.item_id, message:message.text, phase:message.phase },time);
    if (message.role === 'assistant' && message.phase === 'final_answer') finalText = message.text;
    lastTime = time;
  }
  closeTurn();
  return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}

function keyFromFile(file, create = false) {
  if (!existsSync(file)) {
    if (!create) throw new Error('Key file not found. Copy it separately from the source device.');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generateKey().toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
  }
  const text = readFileSync(file, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error('Invalid transfer key file.');
  return Buffer.from(text, 'base64url');
}

export function exportArchive({ codexHome, output, keyFile, threadId = THREAD_ID, project = TOOL_REPO }) {
  keepKeyOutside(keyFile,project);
  const payload = collectHistory(codexHome, threadId);
  const key = keyFromFile(keyFile, true);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(seal(payload, key), null, 2) + '\n');
  return { thread_id: payload.thread.id, messages: payload.messages.length, turns: new Set(payload.messages.map(m => m.turn_id)).size,
    archive: output, key_file: keyFile, exported_at: payload.exported_at };
}

function assertClosed() {
  if (process.platform !== 'win32') return;
  const processes = execFileSync('tasklist', ['/fo','csv','/nh'], { encoding:'utf8', windowsHide:true });
  if (/^"(?:Code|Code - Insiders|ChatGPT|Codex|codex)\.exe"/im.test(processes)) {
    throw new Error('Close VS Code, ChatGPT/Codex and Codex CLI first. Run this import in a separate PowerShell window.');
  }
}

export async function importArchive({ input, keyFile, project, codexHome, binary, isolated = false }) {
  keepKeyOutside(keyFile,project);
  const payload = validatePayload(open(JSON.parse(readFileSync(input, 'utf8')), keyFromFile(keyFile)));
  if (!existsSync(join(project, 'package.json'))) throw new Error('Project folder is not the RobotBand checkout.');
  if (!isolated) assertClosed();
  mkdirSync(codexHome, { recursive:true });
  if (readdirSync(codexHome).some(name => /^state_\d+\.sqlite$/.test(name))) {
    const existing = new DatabaseSync(latestState(codexHome), { readOnly:true });
    let collision;
    try { collision = existing.prepare('SELECT id FROM threads WHERE id = ?').get(payload.thread.id); } finally { existing.close(); }
    if (collision) throw new Error('This chat ID already exists here. Import stops instead of overwriting newer messages.');
  }
  // Let this installation create its own schema and current permission defaults.
  let client = await startCodex({ binary, codexHome, cwd:project });
  let template;
  try {
    template = await client.request('thread/start', { cwd: project, ephemeral:false });
    await client.request('thread/name/set', { threadId:template.thread.id, name:'Chat transfer initialization (empty)' });
  }
  finally { await client.close(); }
  const templateId = template.thread.id;
  const statePath = latestState(codexHome);
  const db = new DatabaseSync(statePath);
  let targetPath;
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(templateId);
    if (!row) throw new Error('Native initialization did not create the expected thread metadata.');
    const created = new Date(payload.thread.created_at * 1000);
    const parts = created.toISOString().slice(0,10).split('-');
    const folder = join(codexHome, 'sessions', ...parts);
    mkdirSync(folder, { recursive:true });
    targetPath = join(folder, `rollout-${created.toISOString().replace(/:/g,'-')}-${payload.thread.id}.jsonl`);
    if (existsSync(targetPath)) throw new Error('An existing rollout file already has this ID. Nothing overwritten.');
    const text = buildRollout(payload, project, row);
    const backup = join(codexHome, 'chat-transfer-backups', `${Date.now()}-${payload.thread.id}`);
    mkdirSync(backup, { recursive:true });
    // A metadata-only record for undo, without duplicating unrelated conversations.
    writeFileSync(join(backup, 'import.json'), JSON.stringify({ thread_id:payload.thread.id, rollout_path:targetPath,
      imported_at:new Date().toISOString(), template_id:templateId }, null,2));
    writeFileSync(targetPath, text, { flag:'wx' });
    const now = Date.now();
    const updated = { ...row, id:payload.thread.id, rollout_path:targetPath, cwd:project,
      source:'vscode', originator:'codex_vscode', history_mode:'legacy',
      title:payload.thread.title, name:payload.thread.title,
      first_user_message:payload.messages.find(m=>m.role==='user')?.text ?? '',
      preview:payload.messages.find(m=>m.role==='user')?.text.slice(0,200) ?? '',
      created_at:payload.thread.created_at, created_at_ms:payload.thread.created_at * 1000,
      updated_at:Math.floor(now/1000), updated_at_ms:now, recency_at:Math.floor(now/1000), recency_at_ms:now,
      archived:0, archived_at:null, is_pinned:0, tokens_used:0, has_user_event:1 };
    const fields = Object.keys(row);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO threads (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map(()=>'?').join(',')})`)
        .run(...fields.map(field=>updated[field]??null));
      // Archive only our newly created empty initialization chat.
      db.prepare('UPDATE threads SET archived = 1, name = ? WHERE id = ?').run('Chat transfer initialization (empty)', templateId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  let verified=false;
  try {
    client = await startCodex({ binary, codexHome, cwd:project });
    const read = await client.request('thread/read', { threadId:payload.thread.id, includeTurns:true });
    await client.request('thread/resume', { threadId:payload.thread.id, cwd:project, excludeTurns:true });
    await client.request('thread/name/set', { threadId:payload.thread.id, name:payload.thread.title });
    const turns = read.thread?.turns ?? [];
    if (turns.length && !turns.some(turn=>(turn.items??[]).length)) {
      const page = await client.request('thread/turns/list', { threadId:payload.thread.id, itemsView:'full', limit:100 });
      const entries=page.data??page.turns??[];
      if (entries.length) turns.splice(0,turns.length,...entries);
    }
    const nativeItems = turns.flatMap(turn=>turn.items??[]).filter(item=>['userMessage','agentMessage'].includes(item.type));
    const nativeText = item => item.type==='userMessage'
      ? (item.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n') : item.text;
    const sourceTexts=payload.messages.map(message=>`${message.role}\n${message.text}`).sort();
    const nativeTexts=nativeItems.map(item=>`${item.type==='userMessage'?'user':'assistant'}\n${nativeText(item)}`).sort();
    if (turns.length!==new Set(payload.messages.map(message=>message.turn_id)).size || nativeItems.length!==payload.messages.length
      || sourceTexts.some((text,index)=>nativeTexts[index]!==text)) {
      throw new Error(`Native Codex message verification failed; import is rolled back. Expected ${payload.messages.length}; native ${nativeItems.length}.`);
    }
    verified=true;
    return { thread_id:payload.thread.id, title:payload.thread.title, messages:payload.messages.length,
      native_messages:nativeItems.length,
      native_turns:turns.length, source_turns:new Set(payload.messages.map(m=>m.turn_id)).size,
      native_resume:true, rollout:targetPath, codex_home:codexHome };
  } finally {
    await client.close();
    if (!verified) {
      const cleanup = new DatabaseSync(statePath);
      try { cleanup.prepare('DELETE FROM threads WHERE id = ? AND rollout_path = ?').run(payload.thread.id,targetPath); }
      finally { cleanup.close(); }
      const withinHome=relative(resolve(codexHome),resolve(targetPath));
      if (!withinHome.startsWith('..')&&!isAbsolute(withinHome)&&existsSync(targetPath)) unlinkSync(targetPath);
    }
  }
}

function options(args) {
  const result = {};
  for (let i=0;i<args.length;i+=2) {
    if (!args[i]?.startsWith('--') || args[i+1]===undefined) throw new Error('Use --option value pairs.');
    result[args[i].slice(2)] = args[i+1];
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2], args = options(process.argv.slice(3));
    const project = resolve(args.project || '.');
    const codexHome = resolve(args['codex-home'] || process.env.CODEX_HOME || join(homedir(),'.codex'));
    if (!args['key-file']) throw new Error('--key-file is required. Keep this file outside the Git repository.');
    const keyFile = resolve(args['key-file']);
    const withinRepo = relative(project,keyFile);
    if (!withinRepo.startsWith('..') && !isAbsolute(withinRepo)) throw new Error('Key file must stay outside the repository.');
    if (command === 'export') {
      console.log(JSON.stringify(exportArchive({ codexHome, output:resolve(args.output || 'chat-transfer/robotband-chat.enc.json'),
        keyFile, threadId:args.thread || THREAD_ID, project }), null,2));
    } else if (command === 'import' || command === 'verify') {
      const binary = args.binary || await findCodexBinary();
      const target = command === 'verify' ? join(tmpdir(), `robotband-chat-verify-${randomUUID()}`) : codexHome;
      const result = await importArchive({ input:resolve(args.input || 'chat-transfer/robotband-chat.enc.json'),
        keyFile, project, codexHome:target, binary, isolated:command==='verify' });
      console.log(JSON.stringify(result,null,2));
    } else throw new Error('Usage: node tools/chat-transfer.mjs export|verify|import --key-file PATH [--project PATH]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
