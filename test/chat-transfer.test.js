import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { collectHistory, buildRollout, exportArchive, THREAD_ID } from '../tools/chat-transfer.mjs';
import { open } from '../tools/chat-crypto.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(),'robotband-export-test-'));
  const state = new DatabaseSync(join(dir,'state_5.sqlite'));
  state.exec('CREATE TABLE threads(id TEXT, name TEXT, title TEXT, created_at INTEGER, cli_version TEXT, model_provider TEXT)');
  state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run(THREAD_ID,'Roboterband','Old title',1793193241,'test','openai');
  state.close();
  const db = new DatabaseSync(join(dir,'thread_history_1.sqlite'));
  db.exec('CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_id TEXT, created_at_ms INTEGER, item_json TEXT, item_type TEXT, rollout_ordinal INTEGER)');
  const insert = db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?)');
  const add = (ordinal, item, thread = THREAD_ID) => insert.run(thread,'turn-a',item.id,1793193241000+ordinal,JSON.stringify(item),item.type,ordinal);
  add(1,{ type:'userMessage', id:'user-a', content:[{type:'text',text:'Baue einen Akkord-Loop.'}] });
  add(2,{ type:'reasoning', id:'private', text:'INTERNAL_MARKER' });
  add(3,{ type:'agentMessage', id:'assistant-a', phase:'commentary', text:'Ich baue den Looper.' });
  add(4,{ type:'mcpToolCall', id:'tool', text:'TOKEN_MARKER' });
  add(5,{ type:'agentMessage', id:'assistant-b', phase:'final_answer', text:'Der Loop ist fertig.' });
  add(6,{ type:'userMessage', id:'other-user', content:[{type:'text',text:'OTHER_CHAT_MARKER'}] },'other-thread');
  db.close();
  writeFileSync(join(dir,'auth.json'),'AUTH_MARKER');
  return dir;
}

test('exports only this thread visible user/assistant messages in order', () => {
  const home=fixture(), payload=collectHistory(home);
  assert.equal(payload.thread.id,THREAD_ID);
  assert.equal(payload.messages.length,3);
  assert.deepEqual(payload.messages.map(m=>m.role),['user','assistant','assistant']);
  for(const marker of ['INTERNAL_MARKER','TOKEN_MARKER','AUTH_MARKER','OTHER_CHAT_MARKER']) assert.ok(!JSON.stringify(payload).includes(marker));
});

test('native rollout retains the chat ID and creates complete visible turns', () => {
  const payload=collectHistory(fixture());
  const records=buildRollout(payload,'C:/Projects/RobotBand').trim().split('\n').map(JSON.parse);
  assert.equal(records[0].payload.id,THREAD_ID);
  assert.equal(records[0].payload.history_mode,'legacy');
  assert.equal(records[0].payload.cwd,'C:/Projects/RobotBand');
  assert.equal(records.filter(r=>r.type==='response_item').length,3);
  assert.deepEqual(records.filter(r=>r.type==='response_item').map(r=>r.payload.content[0].type),['input_text','output_text','output_text']);
  assert.equal(records.at(-1).payload.type,'task_complete');
  assert.equal(records.at(-1).payload.last_agent_message,'Der Loop ist fertig.');
  assert.ok(!records.some(r=>r.type==='turn_context'));
});

test('archive is authenticated encrypted JSON and key stays outside archive', () => {
  const home=fixture(), output=join(home,'chat.enc.json'), keyFile=join(home,'private.chat-key');
  const result=exportArchive({codexHome:home,output,keyFile});
  const text=readFileSync(output,'utf8'), key=Buffer.from(readFileSync(keyFile,'utf8').trim(),'base64url');
  assert.equal(result.messages,3);
  assert.ok(!text.includes('Akkord-Loop'));
  assert.ok(!text.includes(key.toString('base64url')));
  assert.equal(open(JSON.parse(text),key).thread.id,THREAD_ID);
});
