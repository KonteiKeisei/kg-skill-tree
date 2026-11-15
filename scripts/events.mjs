/*
 * What can earn points.
 *
 * Every event is a number on the character. Some are read straight off the sheet (character level, class levels,
 * experience). The rest are counters the module keeps in the actor's flags: one more critical hit, one more long rest.
 * A rule turns one of those numbers into points, and the points a character has earned from a tree are worked out
 * from the numbers now minus the numbers when the tree was unlocked. Nothing is ever awarded twice, and a character
 * who loses a level loses the point it gave.
 */

import {
  MODULE_ID, abilityChoices, activeGM, characterLevel, classLevels, isCharacter, knownClasses, skillChoices, toolChoices,
  warn
} from "./util.mjs";

/**
 * The event catalog. `kind` is "level" for values read from the sheet that only go up with progress, and "counter"
 * for things the module counts. `filter` names the extra choice a rule can make (which class, which skill).
 */
export const EVENTS = {
  level: {
    label: "Character level", group: "Progress", kind: "level", unit: ["level", "levels"],
    hint: "The character's total level. Can be awarded for levels gained before the tree was unlocked."
  },
  classLevel: {
    label: "Class level", group: "Progress", kind: "level", unit: ["class level", "class levels"], filter: "class",
    hint: "Levels in one class. Can be awarded for levels gained before the tree was unlocked."
  },
  xp: {
    label: "Experience points", group: "Progress", kind: "level", unit: ["XP", "XP"],
    hint: "The character's experience total. Can be awarded for XP gained before the tree was unlocked."
  },
  milestone: {
    label: "Milestones (given by the GM)", group: "Progress", kind: "counter", unit: ["milestone", "milestones"],
    hint: "The GM gives milestones from the Skill Tree tab or the Skill Trees manager."
  },
  combat: {
    label: "Combat encounters finished", group: "Combat", kind: "counter", unit: ["encounter", "encounters"],
    hint: "Counted for every character in a combat when the GM ends it, if it got past round one's start."
  },
  defeat: {
    label: "Enemies defeated", group: "Combat", kind: "counter", unit: ["enemy", "enemies"],
    hint: "A hostile creature dropping to 0 HP in combat is credited to the character whose turn it is."
  },
  attack: {
    label: "Attack rolls", group: "Combat", kind: "counter", unit: ["attack roll", "attack rolls"]
  },
  crit: {
    label: "Critical hits", group: "Combat", kind: "counter", unit: ["critical hit", "critical hits"],
    hint: "Attack rolls that are critical hits (including expanded crit ranges)."
  },
  damage: {
    label: "Damage rolled", group: "Combat", kind: "counter", unit: ["point of damage", "points of damage"],
    hint: "The total of the character's damage rolls."
  },
  nat20: {
    label: "Natural 20s", group: "Dice", kind: "counter", unit: ["natural 20", "natural 20s"],
    hint: "Any d20 roll by the character: attacks, checks and saves."
  },
  nat1: {
    label: "Natural 1s", group: "Dice", kind: "counter", unit: ["natural 1", "natural 1s"],
    hint: "Any d20 roll by the character: attacks, checks and saves. Learning from failure."
  },
  skill: {
    label: "Skill checks", group: "Checks", kind: "counter", unit: ["skill check", "skill checks"], filter: "skill"
  },
  tool: {
    label: "Tool checks", group: "Checks", kind: "counter", unit: ["tool check", "tool checks"], filter: "tool"
  },
  check: {
    label: "Ability checks", group: "Checks", kind: "counter", unit: ["ability check", "ability checks"], filter: "ability",
    hint: "Plain ability checks. Skill and tool checks are counted separately."
  },
  save: {
    label: "Saving throws", group: "Checks", kind: "counter", unit: ["saving throw", "saving throws"], filter: "ability"
  },
  spell: {
    label: "Spells cast", group: "Magic", kind: "counter", unit: ["spell", "spells"], filter: "spellLevel"
  },
  shortRest: {
    label: "Short rests", group: "Rest", kind: "counter", unit: ["short rest", "short rests"]
  },
  longRest: {
    label: "Long rests", group: "Rest", kind: "counter", unit: ["long rest", "long rests"]
  }
};

/** Choices for an event's filter: [[value, label]], with "" meaning any. */
export function filterChoices(eventId) {
  const ev = EVENTS[eventId];
  switch ( ev?.filter ) {
    case "class": return knownClasses();
    case "skill": return [["", "Any skill"], ...skillChoices()];
    case "tool": return [["", "Any tool"], ...toolChoices()];
    case "ability": return [["", "Any ability"], ...abilityChoices()];
    case "spellLevel": return [
      ["", "Any spell, cantrips included"],
      ...Array.fromRange(9, 1).map(l => [String(l), `Level ${l} or higher`])
    ];
    default: return [];
  }
}

export function filterLabel(eventId, filter) {
  if ( !filter && (EVENTS[eventId]?.filter !== "class") ) return "";
  return filterChoices(eventId).find(([v]) => v === filter)?.[1] ?? filter;
}

/* -------------------------------------------- */
/*  Stats                                       */
/* -------------------------------------------- */

export function storedStats(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, "stats") ?? {});
}

/** All of an actor's numbers right now: the counters plus what is read from the sheet. */
export function currentStats(actor) {
  const stats = storedStats(actor);
  stats.level = characterLevel(actor);
  stats.xp = Number(actor?.system?.details?.xp?.value) || 0;
  for ( const [id, lvl] of Object.entries(classLevels(actor)) ) stats[`class:${id}`] = lvl;
  return stats;
}

/** The number a rule looks at, from a stats object. */
export function statValue(stats, eventId, filter) {
  const s = stats ?? {};
  switch ( eventId ) {
    case "classLevel": return Number(s[`class:${filter}`]) || 0;
    case "spell": {
      if ( !filter ) return Number(s.spell) || 0;
      let n = 0;
      for ( let l = Number(filter); l <= 9; l++ ) n += Number(s[`spell:${l}`]) || 0;
      return n;
    }
    default:
      if ( filter && EVENTS[eventId]?.filter ) return Number(s[`${eventId}:${filter}`]) || 0;
      return Number(s[eventId]) || 0;
  }
}

/** The stat keys a rule reads, to know whether a counter update matters to a tree. */
export function ruleStatKeys(rule) {
  const { event, filter } = rule;
  if ( event === "classLevel" ) return [`class:${filter}`];
  if ( event === "spell" ) return filter ? Array.fromRange(10 - Number(filter), Number(filter)).map(l => `spell:${l}`) : ["spell"];
  if ( filter && EVENTS[event]?.filter ) return [`${event}:${filter}`];
  return [event];
}

/** How many times a rule pays out at a value. */
export function payouts(rule, value) {
  const v = Number(value) || 0;
  if ( rule.mode === "at" ) {
    return parseList(rule.at).filter(t => t <= v).length;
  }
  const every = Math.max(1, Number(rule.every) || 1);
  const start = payoutStart(rule);
  if ( v < start ) return 0;
  return Math.floor((v - start) / every) + 1;
}

export function parseList(text) {
  return String(text ?? "").split(/[\s,;]+/).map(Number).filter(n => Number.isFinite(n) && (n >= 0))
    .sort((a, b) => a - b);
}

/** Points a rule has paid between a baseline and now. */
export function rulePoints(rule, now, baseline) {
  const amount = Number(rule.amount) || 0;
  const a = payouts(rule, statValue(now, rule.event, rule.filter));
  const b = baseline ? payouts(rule, statValue(baseline, rule.event, rule.filter)) : 0;
  let pts = Math.max(0, a - b) * amount;
  const max = Number(rule.max) || 0;
  if ( max > 0 ) pts = Math.min(pts, max);
  return pts;
}

/** A plain-English sentence for a rule, for the designer and the sheet. */
export function describeRule(rule) {
  const ev = EVENTS[rule.event];
  if ( !ev ) return "Unknown event";
  const amount = Number(rule.amount) || 0;
  const pts = `${amount} point${Math.abs(amount) === 1 ? "" : "s"}`;
  const f = filterLabel(rule.event, rule.filter);
  const what = rule.event === "classLevel" ? `${f || "a class"} level` : ev.unit[0];
  const whats = rule.event === "classLevel" ? `${f || "class"} levels` : ev.unit[1];
  let text;
  if ( rule.mode === "at" ) {
    const list = parseList(rule.at);
    text = `${pts} at ${list.length ? list.join(", ") : "(no values set)"} ${list.length === 1 ? what : whats}`;
  }
  else {
    const every = Math.max(1, Number(rule.every) || 1);
    const start = payoutStart(rule);
    const per = every === 1 ? `every ${what}` : `every ${every} ${whats}`;
    if ( rule.event === "level" ) text = `${pts} ${per}, starting at level ${start}`;
    else if ( rule.event === "classLevel" ) text = `${pts} ${per}, starting at ${f || "class"} level ${start}`;
    else if ( rule.event === "xp" ) text = `${pts} ${per}, starting at ${start} XP`;
    else text = start === every ? `${pts} ${per}` : `${pts} at ${start} ${start === 1 ? what : whats}, then ${per}`;
  }
  if ( f && (rule.event !== "classLevel") ) text += ` (${f})`;
  if ( Number(rule.max) > 0 ) text += `, up to ${rule.max} in total`;
  return text;
}

function payoutStart(rule) {
  const every = Math.max(1, Number(rule.every) || 1);
  const s = Number(rule.start);
  if ( (rule.start === "") || (rule.start === null) || (rule.start === undefined) || !Number.isFinite(s) ) {
    return ["level", "classLevel"].includes(rule.event) ? 1 : every;
  }
  return s;
}

/* -------------------------------------------- */
/*  Counting                                    */
/* -------------------------------------------- */

const queues = new Map();
let onCounted = null;

/** Set by the store: told after counters change, to decide whether the sheet should re-render. */
export function setCountListener(fn) {
  onCounted = fn;
}

/**
 * Add to an actor's counters. Updates to one actor are chained so quick rolls do not overwrite each other.
 * @param {Actor} actor
 * @param {Record<string, number>} deltas
 */
export function bump(actor, deltas, { force = false } = {}) {
  if ( !isCharacter(actor) || !actor.isOwner ) return;
  if ( !force && !game.settings.get(MODULE_ID, "trackEvents") ) return;
  const entries = Object.entries(deltas).filter(([, d]) => Number(d));
  if ( !entries.length ) return;
  const key = actor.uuid;
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const stats = storedStats(actor);
    for ( const [k, d] of entries ) stats[k] = (Number(stats[k]) || 0) + Number(d);
    const render = onCounted ? onCounted(actor, entries.map(([k]) => k)) : true;
    await actor.update({ [`flags.${MODULE_ID}.stats`]: stats }, { render, kgSkillTreeCount: true });
  }).catch(err => warn("Could not count an event", err));
  queues.set(key, next);
  next.finally(() => {
    if ( queues.get(key) === next ) queues.delete(key);
  });
  return next;
}

/** GM: give characters a milestone. */
export async function giveMilestone(actors) {
  if ( !game.user.isGM ) return;
  await Promise.all(actors.filter(isCharacter).map(a => bump(a, { milestone: 1 }, { force: true })));
}

function actorOf(subject) {
  if ( !subject ) return null;
  if ( subject.documentName === "Actor" ) return subject;
  return subject.actor ?? subject.item?.actor ?? subject.parent?.actor ?? null;
}

/** dnd5e calls both the old and the V2 hook names with the same rolls; count each set once. */
const seen = new WeakSet();
function firstTime(rolls) {
  if ( !rolls || (typeof rolls !== "object") ) return false;
  if ( seen.has(rolls) ) return false;
  seen.add(rolls);
  return true;
}

function d20Natural(roll) {
  const die = roll?.d20 ?? roll?.dice?.find?.(d => d.faces === 20);
  if ( !die || (die.faces !== 20) ) return null;
  const n = Number(die.total);
  return Number.isFinite(n) ? n : null;
}

function d20Deltas(rolls) {
  const out = {};
  for ( const r of rolls ) {
    const n = d20Natural(r);
    if ( n === 20 ) out.nat20 = (out.nat20 ?? 0) + 1;
    if ( n === 1 ) out.nat1 = (out.nat1 ?? 0) + 1;
  }
  return out;
}

function onD20(type, rolls, data) {
  if ( !Array.isArray(rolls) || !rolls.length || !firstTime(rolls) ) return;
  const actor = actorOf(data?.subject);
  if ( !isCharacter(actor) ) return;
  const deltas = d20Deltas(rolls);
  if ( type === "skill" ) {
    deltas.skill = 1;
    if ( data.skill ) deltas[`skill:${data.skill}`] = 1;
  }
  else if ( type === "tool" ) {
    deltas.tool = 1;
    if ( data.tool ) deltas[`tool:${data.tool}`] = 1;
  }
  else if ( type === "check" ) {
    deltas.check = 1;
    if ( data.ability ) deltas[`check:${data.ability}`] = 1;
  }
  else if ( type === "save" ) {
    deltas.save = 1;
    if ( data.ability ) deltas[`save:${data.ability}`] = 1;
  }
  else if ( type === "attack" ) {
    deltas.attack = 1;
    if ( rolls.some(r => r?.isCritical) ) deltas.crit = 1;
  }
  bump(actor, deltas);
}

function onDamage(rolls, data) {
  if ( !Array.isArray(rolls) || !rolls.length || !firstTime(rolls) ) return;
  const actor = actorOf(data?.subject);
  if ( !isCharacter(actor) ) return;
  const total = rolls.reduce((n, r) => n + (Number(r?.total) || 0), 0);
  if ( total > 0 ) bump(actor, { damage: total });
}

function onUseActivity(activity, usageConfig) {
  const item = activity?.item;
  const actor = item?.actor;
  if ( !isCharacter(actor) ) return;
  const deltas = {};
  // Features a skill tree granted count toward "use these features N times" requirements.
  const key = useKey(item.getFlag?.(MODULE_ID, "grant"));
  if ( key ) deltas[key] = 1;
  if ( item.type === "spell" ) {
    const base = Number(item.system?.level) || 0;
    const scaling = Number(usageConfig?.scaling) || 0;
    const level = Math.min(9, base + (base > 0 ? scaling : 0));
    deltas.spell = 1;
    deltas[`spell:${level}`] = 1;
  }
  bump(actor, deltas);
}

function useKey(grant) {
  return (grant?.treeId && grant?.nodeId) ? `use:${grant.treeId}:${grant.nodeId}` : null;
}

/**
 * Count a use of a skill tree feature by hand or from a macro, for features that trigger without an activity.
 * @param {Actor} actor
 * @param {Item|{treeId: string, nodeId: string}} source  The granted item, or the tree and node ids.
 * @param {number} [n=1]  Negative to take uses back (GM correction).
 */
export function countUse(actor, source, n = 1) {
  const grant = source?.documentName === "Item" ? source.getFlag(MODULE_ID, "grant") : source;
  const key = useKey(grant);
  if ( !key || !Number(n) ) return;
  return bump(actor, { [key]: Number(n) }, { force: true });
}

function onRest(actor, result, config) {
  if ( !isCharacter(actor) ) return;
  const long = result?.longRest ?? ((config?.type === "long") || (config?.type === "longRest"));
  bump(actor, long ? { longRest: 1 } : { shortRest: 1 });
}

/** A hostile creature in combat dropped to 0 HP: credit the character whose turn it is. Runs on the updating client. */
function onDamageActor(actor, changes, update, userId) {
  if ( (userId !== game.user.id) || isCharacter(actor) ) return;
  const now = Number(actor.system?.attributes?.hp?.value);
  const before = now - (Number(changes?.hp) || 0);
  if ( !(now <= 0) || !(before > 0) ) return;
  const combat = game.combat;
  if ( !combat?.started ) return;
  const victim = combat.combatants.find(c => (c.actor === actor) || (c.actorId === actor.id && c.token?.actorLink));
  if ( !victim ) return;
  const hostile = CONST.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
  if ( (victim.token?.disposition ?? hostile) !== hostile ) return;
  const credited = combat.combatant?.actor;
  if ( isCharacter(credited) && credited.isOwner ) bump(credited, { defeat: 1 });
}

function onDeleteCombat(combat) {
  if ( !game.user.isGM || (activeGM()?.id !== game.user.id) ) return;
  if ( !combat.started && !(combat.round > 0) ) return;
  const actors = new Set();
  for ( const c of combat.combatants ) if ( isCharacter(c.actor) ) actors.add(c.actor);
  for ( const a of actors ) bump(a, { combat: 1 });
}

export function registerEventHooks() {
  const on = (names, fn) => names.forEach(n => Hooks.on(n, fn));
  on(["dnd5e.rollSkillV2", "dnd5e.rollSkill"], (rolls, data) => onD20("skill", rolls, data));
  on(["dnd5e.rollToolCheckV2", "dnd5e.rollToolCheck"], (rolls, data) => onD20("tool", rolls, data));
  on(["dnd5e.rollAbilityCheckV2", "dnd5e.rollAbilityCheck"], (rolls, data) => onD20("check", rolls, data));
  on(["dnd5e.rollSavingThrowV2", "dnd5e.rollSavingThrow"], (rolls, data) => onD20("save", rolls, data));
  on(["dnd5e.rollAttackV2", "dnd5e.rollAttack"], (rolls, data) => onD20("attack", rolls, data));
  on(["dnd5e.rollDamageV2", "dnd5e.rollDamage"], onDamage);
  Hooks.on("dnd5e.postUseActivity", onUseActivity);
  Hooks.on("dnd5e.restCompleted", onRest);
  Hooks.on("dnd5e.damageActor", onDamageActor);
  Hooks.on("deleteCombat", onDeleteCombat);
}
