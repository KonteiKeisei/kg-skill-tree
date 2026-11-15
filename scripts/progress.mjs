/*
 * A character's progress in its trees, kept in the actor's flags:
 *
 *   flags.kg-skill-tree.stats            event counters (see events.mjs)
 *   flags.kg-skill-tree.trees.<treeId>   { unlocked, since, by, retro, baseline, adjust, owned: [...], log: [...] }
 *
 * Everything that can shrink is an array or a scalar, so an update replaces it outright and nothing depends on the
 * key-deletion syntax that changed between Foundry versions.
 *
 * Points are never stored. Earned points are the tree's rules applied to the character's numbers now, minus the same
 * rules applied to the numbers when the tree was unlocked (the baseline), plus any GM adjustment. Spent points are the
 * costs paid for owned nodes, as they were when bought.
 */

import { MODULE_ID, characterLevel, classLevels, esc, isCharacter, plural, setting, warn } from "./util.mjs";
import { EVENTS, currentStats, describeRule, rulePoints, ruleStatKeys, storedStats } from "./events.mjs";
import { allTrees, applyPatch, exclusives, getTree, grantName, prerequisites } from "./trees.mjs";
import { buildSummonItem } from "./summon.mjs";

const LOG_LIMIT = 200;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

export function treeStates(actor) {
  return actor?.getFlag?.(MODULE_ID, "trees") ?? {};
}

export function treeState(actor, treeId) {
  const s = treeStates(actor)[treeId];
  if ( !s ) return null;
  return {
    unlocked: !!s.unlocked,
    since: s.since ?? null,
    by: s.by ?? null,
    retro: !!s.retro,
    baseline: Array.isArray(s.baseline) ? Object.fromEntries(s.baseline) : null,
    adjust: Number(s.adjust) || 0,
    owned: Array.isArray(s.owned) ? s.owned : [],
    log: Array.isArray(s.log) ? s.log : []
  };
}

/** Trees this character can see: unlocked for it and still defined. */
export function unlockedTrees(actor) {
  if ( !isCharacter(actor) ) return [];
  const states = treeStates(actor);
  return allTrees().filter(t => states[t.id]?.unlocked);
}

export function ownedIds(state) {
  return new Set((state?.owned ?? []).map(o => o.id));
}

export function earnedPoints(actor, tree, state = treeState(actor, tree.id)) {
  if ( !state ) return 0;
  const now = currentStats(actor);
  let pts = 0;
  for ( const rule of tree.rules ) {
    if ( !EVENTS[rule.event] ) continue;
    pts += rulePoints(rule, now, state.baseline);
  }
  return pts + state.adjust;
}

/** Earned points broken down by rule, for the points panel. */
export function earnedBreakdown(actor, tree, state = treeState(actor, tree.id)) {
  const now = currentStats(actor);
  const rows = tree.rules.filter(r => EVENTS[r.event]).map(rule => ({
    text: describeRule(rule),
    points: rulePoints(rule, now, state?.baseline ?? null)
  }));
  if ( state?.adjust ) rows.push({ text: "Adjusted by the GM", points: state.adjust });
  return rows;
}

export function spentPoints(state) {
  return (state?.owned ?? []).reduce((n, o) => n + (Number(o.cost) || 0), 0);
}

export function pointsSummary(actor, tree, state = treeState(actor, tree.id)) {
  const earned = earnedPoints(actor, tree, state);
  const spent = spentPoints(state);
  return { earned, spent, available: earned - spent };
}

/** What a character would have earned so far if the tree counted from the start. */
export function retroactivePoints(actor, tree) {
  return earnedPoints(actor, tree, { baseline: null, adjust: 0, owned: [] });
}

/** Do any of a tree's rules read one of these stat keys? */
export function treeUsesStats(tree, keys) {
  const set = new Set(keys);
  return tree.rules.some(r => ruleStatKeys(r).some(k => set.has(k)));
}

/* -------------------------------------------- */
/*  Node status                                 */
/* -------------------------------------------- */

/**
 * Everything the sheet needs to know about one node for one character.
 * @returns {{owned, available, affordable, met, blocked, hidden, reqs: {text, ok}[]}}
 */
export function nodeStatus(actor, tree, state, nodeId, summary = null) {
  const node = tree.nodes[nodeId];
  const owned = ownedIds(state);
  const pts = summary ?? pointsSummary(actor, tree, state);
  const reqs = [];
  const prereq = prerequisites(tree, nodeId).filter(id => tree.nodes[id]);
  if ( prereq.length ) {
    const names = prereq.map(id => tree.nodes[id].name);
    const have = prereq.filter(id => owned.has(id)).length;
    if ( (node.requireMode === "any") && (prereq.length > 1) ) {
      reqs.push({ text: `Any one of: ${names.join(", ")}`, ok: have > 0 });
    }
    else {
      for ( const id of prereq ) reqs.push({ text: tree.nodes[id].name, ok: owned.has(id) });
    }
  }
  if ( node.minLevel > 0 ) {
    reqs.push({ text: `Character level ${node.minLevel}`, ok: characterLevel(actor) >= node.minLevel });
  }
  if ( node.classReq?.identifier && (node.classReq.level > 0) ) {
    const lv = classLevels(actor)[node.classReq.identifier] ?? 0;
    reqs.push({ text: `${classLabel(node.classReq.identifier)} level ${node.classReq.level}`, ok: lv >= node.classReq.level });
  }
  if ( node.minSpent > 0 ) {
    reqs.push({ text: `${node.minSpent} ${tree.currency.abbr} spent in this tree`, ok: pts.spent >= node.minSpent });
  }
  const useNodes = (node.useReq?.nodes ?? []).filter(id => tree.nodes[id]);
  if ( (node.useReq?.count > 0) && useNodes.length ) {
    const used = featureUses(actor, tree, useNodes);
    const names = useNodes.map(id => tree.nodes[id].name).join(", ");
    reqs.push({
      text: `Use ${useNodes.length === 1 ? names : `features from ${names}`} ${node.useReq.count} times (${Math.min(used, node.useReq.count)}/${node.useReq.count})`,
      ok: used >= node.useReq.count
    });
  }
  const excl = exclusives(tree, nodeId).filter(id => tree.nodes[id]);
  const blockedBy = excl.filter(id => owned.has(id));
  for ( const id of excl ) reqs.push({ text: `Not ${tree.nodes[id].name}`, ok: !owned.has(id), exclusive: true });
  const isOwned = owned.has(nodeId);
  const met = reqs.every(r => r.ok);
  const affordable = pts.available >= node.cost;
  return {
    owned: isOwned,
    met,
    affordable,
    available: !isOwned && met && affordable,
    blocked: blockedBy.length > 0,
    hidden: node.hidden && !isOwned && !met,
    reqs
  };
}

function classLabel(identifier) {
  for ( const a of game.actors ?? [] ) {
    const c = a.items.find(i => (i.type === "class") && (i.system?.identifier === identifier));
    if ( c ) return c.name;
  }
  const c = game.items?.find(i => (i.type === "class") && (i.system?.identifier === identifier));
  if ( c ) return c.name;
  const cfg = CONFIG.DND5E?.classes?.[identifier];
  if ( cfg?.label ) return game.i18n.localize(cfg.label);
  return identifier.replace(/^\w/, ch => ch.toUpperCase());
}

/** Can this node be refunded by this user, and what else would go with it? */
export function refundPlan(actor, tree, state, nodeId, { gm = game.user.isGM } = {}) {
  const owned = ownedIds(state);
  if ( !owned.has(nodeId) ) return { ok: false, reason: "Not owned." };
  if ( !gm && (tree.refund === "none") ) return { ok: false, reason: "Only the GM can refund nodes in this tree." };
  // Walk forward: owned nodes that would lose their last prerequisite go too.
  const removed = new Set([nodeId]);
  let changed = true;
  while ( changed ) {
    changed = false;
    for ( const id of owned ) {
      if ( removed.has(id) ) continue;
      const pre = prerequisites(tree, id).filter(p => tree.nodes[p]);
      if ( !pre.length ) continue;
      const node = tree.nodes[id];
      if ( !node ) continue;
      const left = pre.filter(p => owned.has(p) && !removed.has(p));
      const broken = node.requireMode === "any" ? left.length === 0 : left.length < pre.length;
      if ( broken ) {
        removed.add(id);
        changed = true;
      }
    }
  }
  // Nodes gated on points spent in this tree can lose their footing too.
  const spentAfter = (state.owned ?? []).filter(o => !removed.has(o.id)).reduce((n, o) => n + (Number(o.cost) || 0), 0);
  for ( const o of state.owned ?? [] ) {
    const n = tree.nodes[o.id];
    if ( n && !removed.has(o.id) && (n.minSpent > spentAfter) ) removed.add(o.id);
  }
  const extra = [...removed].filter(id => id !== nodeId);
  if ( !gm && (tree.refund === "leaf") && extra.length ) {
    return {
      ok: false,
      reason: `Other nodes depend on this one: ${extra.map(id => tree.nodes[id]?.name ?? id).join(", ")}.`,
      extra
    };
  }
  return { ok: true, extra, removed: [...removed] };
}

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

function rawState(actor, treeId) {
  return foundry.utils.deepClone(treeStates(actor)[treeId] ?? {});
}

async function writeState(actor, treeId, data) {
  await actor.update({ [`flags.${MODULE_ID}.trees.${treeId}`]: data });
}

function logEntry(type, data = {}) {
  return { type, at: Date.now(), by: game.user.id, ...data };
}

function withLog(raw, entry) {
  const log = Array.isArray(raw.log) ? raw.log.slice(-(LOG_LIMIT - 1)) : [];
  log.push(entry);
  return log;
}

/**
 * Unlock a tree for a character. The first unlock decides where the points start: from the beginning of the
 * character's career (`retroactive`) or from now. Unlocking a tree that was locked again later picks up where it was.
 */
export async function unlockTree(actor, tree, { retroactive = false, bonus = 0 } = {}) {
  if ( !game.user.isGM ) throw new Error("Only a GM can unlock skill trees.");
  const raw = rawState(actor, tree.id);
  const fresh = !raw.since;
  const data = { unlocked: true };
  if ( fresh ) {
    data.since = Date.now();
    data.by = game.user.id;
    data.retro = !!retroactive;
    data.baseline = retroactive ? null : Object.entries(currentStats(actor));
    data.adjust = Number(bonus) || 0;
    data.owned = [];
    data.log = withLog(raw, logEntry("unlock", {
      retro: !!retroactive, bonus: Number(bonus) || 0, text: retroactive ? "Unlocked, with points earned so far" : "Unlocked, counting from now"
    }));
  }
  else {
    data.log = withLog(raw, logEntry("unlock", { text: "Unlocked again" }));
  }
  await writeState(actor, tree.id, data);
}

export async function lockTree(actor, tree) {
  if ( !game.user.isGM ) return;
  const raw = rawState(actor, tree.id);
  await writeState(actor, tree.id, { unlocked: false, log: withLog(raw, logEntry("lock", { text: "Locked" })) });
}

export async function adjustPoints(actor, tree, delta, reason = "") {
  if ( !game.user.isGM ) return;
  const raw = rawState(actor, tree.id);
  const d = Number(delta) || 0;
  if ( !d ) return;
  await writeState(actor, tree.id, {
    adjust: (Number(raw.adjust) || 0) + d,
    log: withLog(raw, logEntry("adjust", { points: d, text: reason || (d > 0 ? "Points given by the GM" : "Points taken by the GM") }))
  });
}

/** Wipe a character's progress in a tree: refund everything and start the points over as if newly unlocked. */
export async function resetTree(actor, tree, { retroactive = null } = {}) {
  if ( !game.user.isGM ) return;
  const state = treeState(actor, tree.id);
  if ( !state ) return;
  await deleteGrantedItems(actor, tree.id, state.owned.map(o => o.id), state.owned.flatMap(o => o.items ?? []));
  const raw = rawState(actor, tree.id);
  const retro = retroactive ?? state.retro;
  await writeState(actor, tree.id, {
    owned: [],
    adjust: 0,
    retro,
    since: Date.now(),
    baseline: retro ? null : Object.entries(currentStats(actor)),
    log: withLog(raw, logEntry("reset", { text: "Progress reset" }))
  });
}

/** Refund every owned node but keep the points: a respec. */
export async function respecTree(actor, tree) {
  const state = treeState(actor, tree.id);
  if ( !state?.owned.length ) return;
  await deleteGrantedItems(actor, tree.id, state.owned.map(o => o.id), state.owned.flatMap(o => o.items ?? []));
  const raw = rawState(actor, tree.id);
  await writeState(actor, tree.id, {
    owned: [],
    log: withLog(raw, logEntry("respec", { points: spentPoints(state), text: "All nodes refunded" }))
  });
}

/* -------------------------------------------- */
/*  Buying                                      */
/* -------------------------------------------- */

const busy = new Set();

/**
 * Buy a node. Items are granted first; the node is only recorded (and its cost spent) once something it grants is
 * actually on the character, so cancelling an advancement prompt costs nothing.
 * @param {object} [options]
 * @param {boolean} [options.free]   GM: grant without spending points.
 * @param {boolean} [options.force]  GM: ignore requirements.
 * @param {number} [options.level]   GM: the character level it was gained at, for a grant recorded after the fact.
 * @param {string} [options.note]    GM: why it was granted, for the log and the chat card.
 */
export async function purchaseNode(actor, treeId, nodeId, { free = false, force = false, level = null, note = "" } = {}) {
  const key = `${actor.uuid}:${treeId}`;
  if ( busy.has(key) ) return false;
  busy.add(key);
  try {
    const tree = getTree(treeId);
    const node = tree?.nodes[nodeId];
    if ( !tree || !node ) throw new Error("That node no longer exists.");
    const state = treeState(actor, treeId);
    if ( !state?.unlocked && !game.user.isGM ) throw new Error("This skill tree is locked.");
    if ( !state ) throw new Error("Unlock this tree for the character first.");
    if ( !actor.isOwner ) throw new Error("You do not own this character.");
    const status = nodeStatus(actor, tree, state, nodeId);
    if ( status.owned ) throw new Error(`${node.name} is already unlocked.`);
    const gm = game.user.isGM;
    if ( !status.met && !(gm && force) ) throw new Error(`Requirements not met: ${status.reqs.filter(r => !r.ok).map(r => r.text).join(", ")}.`);
    const cost = (gm && free) ? 0 : node.cost;
    if ( (pointsSummary(actor, tree, state).available < cost) && !(gm && force) ) {
      throw new Error(`Not enough ${tree.currency.name}: ${node.name} costs ${cost}.`);
    }

    const atLevel = gm ? level : null;
    const gmGrant = gm && (force || free);
    const itemIds = await grantItems(actor, tree, node, atLevel, gmGrant ? { gm: true, note: String(note ?? "").trim() } : {});
    if ( node.grants.length && !itemIds.length ) {
      ui.notifications.info(`${node.name} was not unlocked. Nothing was granted, so no points were spent.`);
      return false;
    }

    const byGM = gmGrant;
    const why = String(note ?? "").trim();
    const raw = rawState(actor, treeId);
    const owned = Array.isArray(raw.owned) ? raw.owned.filter(o => o.id !== nodeId) : [];
    owned.push({
      id: nodeId, cost, at: Date.now(), by: game.user.id, items: itemIds, free: cost === 0 && node.cost > 0,
      gm: byGM, level: grantFlag(tree, node, actor, atLevel).level, note: why
    });
    const text = byGM ? `GM granted ${node.name}${atLevel ? ` (at level ${atLevel})` : ""}${why ? `: ${why}` : ""}` : `Unlocked ${node.name}`;
    await writeState(actor, treeId, {
      owned,
      log: withLog(raw, logEntry("buy", { node: nodeId, name: node.name, points: -cost, text }))
    });
    if ( tree.chatCards ) postCard(actor, tree, node, byGM ? "grant" : "buy", cost, [], why);
    Hooks.callAll(`${MODULE_ID}.purchase`, actor, tree, node, { cost, itemIds });
    return true;
  } catch(err) {
    ui.notifications.warn(err.message);
    return false;
  } finally {
    busy.delete(key);
  }
}

export async function refundNode(actor, treeId, nodeId) {
  const key = `${actor.uuid}:${treeId}`;
  if ( busy.has(key) ) return false;
  busy.add(key);
  try {
    const tree = getTree(treeId);
    const state = treeState(actor, treeId);
    if ( !tree || !state ) return false;
    const plan = refundPlan(actor, tree, state, nodeId);
    if ( !plan.ok ) throw new Error(plan.reason);
    const removed = new Set(plan.removed);
    const going = state.owned.filter(o => removed.has(o.id));
    await deleteGrantedItems(actor, treeId, [...removed], going.flatMap(o => o.items ?? []));
    const raw = rawState(actor, treeId);
    const owned = (raw.owned ?? []).filter(o => !removed.has(o.id));
    const refunded = going.reduce((n, o) => n + (Number(o.cost) || 0), 0);
    const names = going.map(o => tree.nodes[o.id]?.name ?? "Removed node");
    await writeState(actor, treeId, {
      owned,
      log: withLog(raw, logEntry("refund", { node: nodeId, points: refunded, text: `Refunded ${names.join(", ")}` }))
    });
    if ( tree.chatCards ) postCard(actor, tree, tree.nodes[nodeId], "refund", refunded, names.slice(1));
    Hooks.callAll(`${MODULE_ID}.refund`, actor, tree, [...removed]);
    return true;
  } catch(err) {
    ui.notifications.warn(err.message);
    return false;
  } finally {
    busy.delete(key);
  }
}

/**
 * Mark item data as granted by a node. Refunds and other modules (KG PC History) read this flag, so its shape is a
 * contract: { treeId, treeName, nodeId, nodeName, cost, level } where level is the character level at purchase, plus
 * { gm: true, note } when the GM granted it outside the rules.
 */
export function grantFlag(tree, node, actor = null, level = null) {
  return {
    treeId: tree.id, treeName: tree.name, nodeId: node.id, nodeName: node.name, cost: node.cost,
    level: Number.isFinite(Number(level)) && (level !== null) && (level !== "") ? Number(level) : (actor ? characterLevel(actor) : null)
  };
}

async function itemDataFor(grant, tree, node) {
  if ( grant.kind === "summon" ) return applyPatch(buildSummonItem(grant, node, tree), grant.patch);
  const data = await grantItemData(grant);
  if ( !data ) {
    warn(`Granted item ${grant.uuid} could not be found.`);
    ui.notifications.warn(`${grantName(grant) || "An item"} for ${node.name} could not be found and was skipped.`);
    return null;
  }
  return data;
}

/** The item a grant gives, as it would be granted now: the source item's data with the grant's patch applied. */
export async function grantItemData(grant) {
  const doc = await fromUuid(grant.uuid).catch(() => null);
  if ( !doc || (doc.documentName !== "Item") ) return null;
  const data = doc.toObject();
  delete data._id;
  data._stats ??= {};
  data._stats.compendiumSource = doc.pack ? doc.uuid : (doc._stats?.compendiumSource ?? doc.uuid);
  return applyPatch(data, grant.patch);
}

/** How many times the features granted by some nodes have been used. */
export function featureUses(actor, tree, nodeIds) {
  const stats = storedStats(actor);
  return nodeIds.reduce((n, id) => n + (Number(stats[`use:${tree.id}:${id}`]) || 0), 0);
}

function canAdvance(actor, data) {
  if ( game.settings.get("dnd5e", "disableAdvancements") ) return false;
  if ( !actor.system?.metadata?.supportsAdvancement && (actor.type !== "character") ) return false;
  if ( foundry.utils.isEmpty(data.system?.advancement ?? {}) ) return false;
  return !!globalThis.dnd5e?.applications?.advancement?.AdvancementManager?.forNewItem;
}

function grantedItems(actor, treeId, nodeId) {
  return actor.items.filter(i => {
    const f = i.getFlag(MODULE_ID, "grant");
    return f && (f.treeId === treeId) && (f.nodeId === nodeId);
  });
}

/** Create a node's items on the character. Items with advancements go through dnd5e's advancement prompt. */
/**
 * A grant patch can point at an item the character already has with "@actorItem[Name]" (or its identifier), for
 * example a feature that spends a use of Channel Divinity. When the node is granted, the token becomes that item's id.
 */
const ACTOR_ITEM = /^@actorItem\[(.+)\]$/;
function resolveActorItems(data, actor, node) {
  const find = ref => {
    const key = ref.trim().toLowerCase();
    const slug = key.slugify?.() ?? key;
    return actor.items.find(i => i.name.toLowerCase() === key)
      ?? actor.items.find(i => [key, slug].includes(String(i.system?.identifier ?? "").toLowerCase()));
  };
  const walk = obj => {
    for ( const [k, v] of Object.entries(obj ?? {}) ) {
      if ( typeof v === "string" ) {
        const m = v.match(ACTOR_ITEM);
        if ( !m ) continue;
        const item = find(m[1]);
        if ( !item ) ui.notifications.warn(`${node.name}: ${actor.name} has no "${m[1]}". Link it on the granted item by hand.`);
        obj[k] = item?.id ?? "";
      }
      else if ( v && (typeof v === "object") ) walk(v);
    }
  };
  walk(data.system);
}

async function grantItems(actor, tree, node, level = null, extra = {}) {
  const plain = [];
  const advancing = [];
  for ( const grant of node.grants ) {
    const data = await itemDataFor(grant, tree, node);
    if ( !data ) continue;
    resolveActorItems(data, actor, node);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.grant`, { ...grantFlag(tree, node, actor, level), ...extra });
    if ( canAdvance(actor, data) ) advancing.push(data);
    else plain.push(data);
  }
  if ( plain.length ) await actor.createEmbeddedDocuments("Item", plain, { kgSkillTree: { treeId: tree.id, nodeId: node.id } });
  for ( const data of advancing ) await runAdvancement(actor, data);
  return grantedItems(actor, tree.id, node.id).map(i => i.id);
}

function runAdvancement(actor, data) {
  const AM = dnd5e.applications.advancement.AdvancementManager;
  const manager = AM.forNewItem(actor, data);
  if ( !manager.steps.length ) {
    return actor.createEmbeddedDocuments("Item", [data]);
  }
  return new Promise(resolve => {
    const done = app => {
      if ( app !== manager ) return;
      Hooks.off("closeApplicationV2", hookId);
      // The manager applies its changes before closing; give the update a moment to land.
      setTimeout(resolve, 50);
    };
    const hookId = Hooks.on("closeApplicationV2", done);
    manager.render(true);
  });
}

async function deleteGrantedItems(actor, treeId, nodeIds, itemIds) {
  const ids = new Set(itemIds.filter(id => actor.items.has(id)));
  const nodes = new Set(nodeIds);
  for ( const i of actor.items ) {
    const f = i.getFlag(MODULE_ID, "grant");
    if ( f && (f.treeId === treeId) && nodes.has(f.nodeId) ) ids.add(i.id);
  }
  if ( ids.size ) await actor.deleteEmbeddedDocuments("Item", [...ids], { kgSkillTree: { refund: true } });
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

async function postCard(actor, tree, node, kind, points, also = [], note = "") {
  if ( !node ) return;
  try {
    const verb = { buy: "unlocked", grant: "was granted", refund: "refunded" }[kind];
    const pts = kind === "refund"
      ? `${points} ${esc(tree.currency.abbr)} returned`
      : (points ? `for ${points} ${esc(tree.currency.abbr)}` : (kind === "grant" ? "by the GM" : "for free"));
    const img = node.img || node.grants[0]?.img || tree.img;
    const content = `<div class="kgst-card">
      <header>${img ? `<img src="${esc(img)}" alt="">` : ""}<div><strong>${esc(node.name)}</strong>
      <span>${esc(tree.name)}</span></div></header>
      <p>${esc(actor.name)} ${verb} <strong>${esc(node.name)}</strong> ${pts}.</p>
      ${also.length ? `<p class="kgst-card-also">Also refunded: ${also.map(esc).join(", ")}.</p>` : ""}
      ${note ? `<p class="kgst-card-also">${esc(note)}</p>` : ""}
    </div>`;
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content,
      flags: { [MODULE_ID]: { card: kind, treeId: tree.id, nodeId: node.id } }
    });
  } catch(err) {
    warn("Could not post the chat card", err);
  }
}

/* -------------------------------------------- */
/*  Notifications                               */
/* -------------------------------------------- */

const lastEarned = new Map();

/** Remember what an actor has earned, and tell its owner when that goes up. */
export function checkEarned(actor, { quiet = false } = {}) {
  if ( !isCharacter(actor) || !actor.isOwner ) return;
  for ( const tree of unlockedTrees(actor) ) {
    const key = `${actor.uuid}:${tree.id}`;
    const earned = earnedPoints(actor, tree);
    const before = lastEarned.get(key);
    lastEarned.set(key, earned);
    if ( quiet || (before === undefined) || (earned <= before) ) continue;
    if ( !setting("notifyPoints") ) continue;
    // Tell the player; the GM only hears about characters nobody else owns.
    const players = game.users.filter(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
    if ( game.user.isGM && players.length ) continue;
    ui.notifications.info(`${actor.name} earned ${plural(earned - before, tree.currency.abbr, tree.currency.abbr)} in ${tree.name}.`);
  }
}
