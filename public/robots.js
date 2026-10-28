import { ROLES } from './engine.js';

/** Physical robot identities are separate from the four musical roles. */
export const ROBOTS = Object.freeze([
  Object.freeze({ id: 'bot-1', label: 'Bot 1' }),
  Object.freeze({ id: 'bot-2', label: 'Bot 2' }),
  Object.freeze({ id: 'bot-3', label: 'Bot 3' }),
]);

// Confirmed mapping: drums, guitar and keyboard each have one physical robot.
// An unassigned musical role remains available without addressing a physical bot.
export const DEFAULT_ROLE_ASSIGNMENTS = Object.freeze({
  drums: 'bot-1',
  guitar: 'bot-2',
  keyboard: 'bot-3',
  vocals: null,
});

const ROLE_IDS = ROLES.map(role => role.id);
const ROBOT_IDS = new Set(ROBOTS.map(robot => robot.id));

/** Validate the complete mapping before returning a new, independent object. */
export function validateAssignments(assignments) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(assignments))) {
    throw new TypeError('Role assignments must be a plain object');
  }
  const keys = Reflect.ownKeys(assignments);
  if (keys.length !== ROLE_IDS.length || keys.some(key => !ROLE_IDS.includes(key))) {
    throw new TypeError('Role assignments must contain exactly drums, guitar, keyboard and vocals');
  }
  const validated = {};
  for (const role of ROLE_IDS) {
    const robotId = assignments[role];
    if (robotId !== null && !ROBOT_IDS.has(robotId)) {
      throw new TypeError(`Unknown robot assignment for ${role}`);
    }
    validated[role] = robotId;
  }
  return validated;
}

export function robotForRole(role, assignments = DEFAULT_ROLE_ASSIGNMENTS) {
  const validated = validateAssignments(assignments);
  if (!ROLE_IDS.includes(role)) return null;
  return ROBOTS.find(robot => robot.id === validated[role]) ?? null;
}

export function rolesForRobot(id, assignments = DEFAULT_ROLE_ASSIGNMENTS) {
  const validated = validateAssignments(assignments);
  if (!ROBOT_IDS.has(id)) return [];
  return ROLE_IDS.filter(role => validated[role] === id);
}
