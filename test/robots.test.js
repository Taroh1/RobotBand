import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../public/engine.js';
import { ROBOTS, DEFAULT_ROLE_ASSIGNMENTS, robotForRole, rolesForRobot, validateAssignments } from '../public/robots.js';

test('exactly three immutable physical robots coexist with four musical roles', () => {
  assert.deepEqual(ROBOTS.map(robot => robot.id), ['bot-1', 'bot-2', 'bot-3']);
  assert.deepEqual(ROBOTS.map(robot => robot.label), ['Bot 1', 'Bot 2', 'Bot 3']);
  assert.equal(ROLES.length, 4);
  assert.ok(Object.isFrozen(ROBOTS));
  assert.ok(ROBOTS.every(Object.isFrozen));
  assert.throws(() => ROBOTS.push({ id: 'bot-4' }), TypeError);
  assert.throws(() => { ROBOTS[0].label = 'Changed'; }, TypeError);
});

test('provisional assignments leave vocals unassigned without removing its musical role', () => {
  assert.ok(Object.isFrozen(DEFAULT_ROLE_ASSIGNMENTS));
  assert.deepEqual(DEFAULT_ROLE_ASSIGNMENTS, {
    drums: 'bot-1', guitar: 'bot-2', keyboard: 'bot-3', vocals: null,
  });
  assert.equal(robotForRole('drums'), ROBOTS[0]);
  assert.equal(robotForRole('guitar'), ROBOTS[1]);
  assert.equal(robotForRole('keyboard'), ROBOTS[2]);
  assert.equal(robotForRole('vocals'), null);
  assert.deepEqual(rolesForRobot('bot-1'), ['drums']);
});

test('one robot can take several musical roles and another can remain unused', () => {
  const assignments = { drums: 'bot-1', guitar: 'bot-2', keyboard: 'bot-2', vocals: 'bot-2' };
  assert.deepEqual(validateAssignments(assignments), assignments);
  assert.equal(robotForRole('vocals', assignments), ROBOTS[1]);
  assert.deepEqual(rolesForRobot('bot-2', assignments), ['guitar', 'keyboard', 'vocals']);
  assert.deepEqual(rolesForRobot('bot-3', assignments), []);
});

test('all roles may be unassigned and unknown lookups never select a bot', () => {
  const assignments = { drums: null, guitar: null, keyboard: null, vocals: null };
  assert.deepEqual(validateAssignments(assignments), assignments);
  assert.equal(robotForRole('drums', assignments), null);
  assert.equal(robotForRole('bass'), null);
  assert.equal(robotForRole('__proto__'), null);
  assert.deepEqual(rolesForRobot('bot-4'), []);
  assert.deepEqual(rolesForRobot(null, assignments), []);
});

test('validation returns a fresh object and never mutates its input or defaults', () => {
  const assignments = { ...DEFAULT_ROLE_ASSIGNMENTS };
  const copy = validateAssignments(assignments);
  assert.notEqual(copy, assignments);
  copy.drums = 'bot-3';
  assert.equal(assignments.drums, 'bot-1');
  assert.equal(DEFAULT_ROLE_ASSIGNMENTS.drums, 'bot-1');
  const nullPrototype = Object.assign(Object.create(null), assignments);
  assert.deepEqual(validateAssignments(nullPrototype), assignments);
});

test('invalid complete mappings fail atomically without changing existing state', () => {
  const initial = { ...DEFAULT_ROLE_ASSIGNMENTS };
  const missing = { ...initial };
  delete missing.vocals;
  const inherited = Object.create(initial);
  const symbolExtra = { ...initial, [Symbol('extra')]: null };
  for (const invalid of [
    null, undefined, [], 'bot-1', missing, inherited, symbolExtra,
    { ...initial, bass: 'bot-1' },
    { ...initial, vocals: 'bot-4' },
    { ...initial, vocals: undefined },
    { ...initial, vocals: false },
    { ...initial, vocals: { id: 'bot-1' } },
  ]) {
    let current = initial;
    assert.throws(() => { current = validateAssignments(invalid); }, TypeError);
    assert.equal(current, initial);
    assert.deepEqual(current, DEFAULT_ROLE_ASSIGNMENTS);
  }
});
