/*
 * Skill tree definitions. All trees live in one world setting, keyed by id. Node positions are fractions of the
 * background (0 to 1), so a tree draws the same in the wide designer and in a narrow sheet tab, and swapping the
 * background for one with the same shape keeps every node where it was.
 */

import { MODULE_ID, clamp, int, num, randomId } from "./util.mjs";

export const SHAPES = {
  circle: "Circle",
  square: "Square",
  diamond: "Diamond",
  hexagon: "Hexagon",
  octagon: "Octagon"
};

export const ASPECTS = {
  "16:9": [1600, 900],
  "4:3": [1600, 1200],
  "1:1": [1200, 1200],
  "3:4": [1200, 1600],
  "9:16": [900, 1600],
  "21:9": [2100, 900]
};

export const REFUND_POLICIES = {
  none: "Players cannot refund. Only the GM can.",
  leaf: "Players can refund a node nothing else depends on.",
  any: "Players can refund freely (nodes that depend on it are refunded too)."
};

export function defaultTree(name = "New Skill Tree", kind = "actor", equipmentType = "weapon") {
  return normalizeTree({
    id: randomId(),
    name,
    kind,
    equipmentType,
    description: "",
    img: "icons/svg/upgrade.svg",
    background: { src: "", width: 1600, height: 900, color: "#1d1f2b" },
    nodeSize: 6,
    currency: { name: "Skill Points", abbr: "SP" },
    rules: kind === "equipment" ? [] : [{ id: randomId(), event: "level", filter: "", amount: 1, mode: "every", every: 1, start: 2, at: "", max: 0 }],
    refund: "leaf",
    confirmPurchase: true,
    chatCards: true,
    nodes: {},
    links: {},
    grid: { snap: false, size: 40 }
  });
}

export function defaultNode(x = 0.5, y = 0.5, data = {}) {
  return normalizeNode({ id: randomId(), x, y, name: "New Node", ...data });
}

export function normalizeNode(n = {}) {
  return {
    id: n.id || randomId(),
    x: clamp(num(n.x, 0.5), 0, 1),
    y: clamp(num(n.y, 0.5), 0, 1),
    name: String(n.name ?? "Node"),
    img: String(n.img ?? ""),
    description: String(n.description ?? ""),
    cost: Math.max(0, int(n.cost, 1)),
    shape: n.shape in SHAPES ? n.shape : "circle",
    size: clamp(num(n.size, 1), 0.4, 3),
    color: String(n.color ?? ""),
    grants: Array.isArray(n.grants) ? n.grants.map(normalizeGrant).filter(Boolean) : [],
    ownership: n.ownership === "permanent" ? "permanent" : "personal",
    enhancements: Array.isArray(n.enhancements) ? n.enhancements.map(normalizeEnhancement).filter(Boolean) : [],
    requireMode: n.requireMode === "any" ? "any" : "all",
    minLevel: Math.max(0, int(n.minLevel, 0)),
    classReq: { identifier: String(n.classReq?.identifier ?? ""), level: Math.max(0, int(n.classReq?.level, 0)) },
    minSpent: Math.max(0, int(n.minSpent, 0)),
    useReq: {
      nodes: Array.isArray(n.useReq?.nodes) ? n.useReq.nodes.map(String) : [],
      count: Math.max(0, int(n.useReq?.count, 0))
    },
    hidden: !!n.hidden,
    label: n.label === false ? false : true
  };
}

/**
 * Declarative bonuses. Blank group derives a family from target, kind and sorted keys (legacy key fallback).
 * Runtime processes purchase order: add increases the family total, replace sets it, including lower values.
 * keys: ["all"] selects every save/check; key remains available for legacy consumers.
 * Formula strings are kept intact for the runtime's Roll evaluation.
 */
export function normalizeEnhancement(e) {
  if ( !e || !["attack", "damage", "ac", "save", "check"].includes(e.kind) ) return null;
  return {
    id: e.id || randomId(),
    target: e.target === "actor" ? "actor" : "weapon",
    kind: e.kind,
    key: String(e.key ?? (Array.isArray(e.keys) ? e.keys[0] : "") ?? ""),
    keys: [...new Set((Array.isArray(e.keys) ? e.keys : (e.key ? [e.key] : [])).map(String).filter(Boolean))],
    stacking: e.stacking === "replace" ? "replace" : "add",
    group: String(e.group ?? "").trim(),
    value: String(e.value ?? "0"),
    ...(e.damageType ? { damageType: String(e.damageType) } : {})
  };
}

/** spellUses is declarative: grant runtime applies uses, innate method and itemUses activity consumption. */
export function normalizeGrant(g) {
  if ( !g?.uuid ) return null;
  const patch = (g.patch && (typeof g.patch === "object") && !Array.isArray(g.patch)) ? foundry.utils.deepClone(g.patch) : {};
  return {
    kind: g.kind === "summon" ? "summon" : "item",
    uuid: String(g.uuid),
    name: String(g.name ?? ""),
    img: String(g.img ?? ""),
    type: String(g.type ?? ""),
    count: String(g.count ?? "1"),
    spellUses: {
      enabled: !!g.spellUses?.enabled,
      max: String(g.spellUses?.max ?? "1"),
      recovery: ["lr", "sr", "day"].includes(g.spellUses?.recovery) ? g.spellUses.recovery : "lr"
    },
    patch
  };
}

/*
 * A grant's patch changes the item as it is granted, without touching its source (a compendium owned by another
 * module, for example). It is a flat map of data paths to values: each value replaces what is at that path, so
 * { "system.prerequisites.level": null } clears a prerequisite. The key "effects" is the exception: its effects are
 * added to the item's own.
 */
export function applyPatch(data, patch) {
  if ( !patch || foundry.utils.isEmpty(patch) ) return data;
  for ( const [key, value] of Object.entries(patch) ) {
    if ( key === "effects" ) {
      // Added once: an effect already on the item (same id, or same name and type) is left alone, so a patch can be
      // applied to an item that already has it, such as a compendium item the patch was written into.
      const have = data.effects ?? [];
      const present = e => have.some(x => (e._id && (x._id === e._id))
        || ((x.name === e.name) && ((x.type ?? "base") === (e.type ?? "base"))));
      const extra = (Array.isArray(value) ? value : []).filter(e => !present(e))
        .map(e => ({ ...foundry.utils.deepClone(e), _id: e._id || foundry.utils.randomID() }));
      data.effects = [...have, ...extra];
      continue;
    }
    foundry.utils.setProperty(data, key, foundry.utils.deepClone(value));
  }
  return data;
}

/** The name a grant shows: its patched name if it has one. */
export function grantName(g) {
  return g?.patch?.name || g?.name || "";
}

export function normalizeLink(l = {}) {
  return {
    id: l.id || randomId(),
    from: String(l.from ?? ""),
    to: String(l.to ?? ""),
    kind: l.kind === "exclusive" ? "exclusive" : "require"
  };
}

export function normalizeRule(r = {}) {
  return {
    id: r.id || randomId(),
    event: String(r.event ?? "level"),
    weaponOnly: !!r.weaponOnly,
    filter: String(r.filter ?? ""),
    amount: int(r.amount, 1),
    mode: r.mode === "at" ? "at" : "every",
    every: Math.max(1, int(r.every, 1)),
    start: (r.start === "" || r.start === null || r.start === undefined) ? "" : Math.max(0, int(r.start, 0)),
    at: String(r.at ?? ""),
    max: Math.max(0, int(r.max, 0))
  };
}

export function normalizeTree(t = {}) {
  const nodes = {};
  for ( const n of Object.values(t.nodes ?? {}) ) {
    const node = normalizeNode(n);
    nodes[node.id] = node;
  }
  for ( const node of Object.values(nodes) ) {
    node.useReq.nodes = node.useReq.nodes.filter(id => nodes[id] && (id !== node.id));
  }
  const links = {};
  const seen = new Set();
  for ( const l of Object.values(t.links ?? {}) ) {
    const link = normalizeLink(l);
    if ( !nodes[link.from] || !nodes[link.to] || (link.from === link.to) ) continue;
    const key = link.kind === "exclusive" ? `x:${[link.from, link.to].sort().join(":")}` : `r:${link.from}:${link.to}`;
    if ( seen.has(key) ) continue;
    seen.add(key);
    links[link.id] = link;
  }
  const bg = t.background ?? {};
  const equipmentType = ["weapon", "armor", "equipment"].includes(t.equipmentType) ? t.equipmentType
    : (["weapon", "equipment"].includes(t.baseItem?.type) ? t.baseItem.type : "weapon");
  return {
    id: t.id || randomId(),
    name: String(t.name ?? "Skill Tree"),
    kind: t.kind === "equipment" ? "equipment" : "actor",
    equipmentType,
    baseItem: {
      uuid: String(t.baseItem?.uuid ?? ""),
      name: String(t.baseItem?.name ?? ""),
      img: String(t.baseItem?.img ?? ""),
      type: String(t.baseItem?.type ?? "")
    },
    activation: { equipped: t.activation?.equipped !== false, attuned: t.activation?.attuned !== false },
    description: String(t.description ?? ""),
    img: String(t.img ?? "icons/svg/upgrade.svg"),
    background: {
      src: String(bg.src ?? ""),
      width: Math.max(1, num(bg.width, 1600)),
      height: Math.max(1, num(bg.height, 900)),
      color: String(bg.color || "#1d1f2b")
    },
    nodeSize: clamp(num(t.nodeSize, 6), 2, 20),
    currency: {
      name: String(t.currency?.name || "Skill Points"),
      abbr: String(t.currency?.abbr || "SP")
    },
    rules: Array.isArray(t.rules) ? t.rules.map(r => ({ ...normalizeRule(r),
      weaponOnly: t.kind === "equipment" && equipmentType === "weapon" && !!r.weaponOnly
    })) : [],
    refund: t.refund in REFUND_POLICIES ? t.refund : "leaf",
    confirmPurchase: t.confirmPurchase !== false,
    chatCards: t.chatCards !== false,
    nodes,
    links,
    grid: { snap: !!t.grid?.snap, size: clamp(int(t.grid?.size, 40), 4, 200) }
  };
}

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

export function allTrees() {
  const raw = game.settings.get(MODULE_ID, "trees") ?? {};
  return Object.values(raw).map(normalizeTree).sort((a, b) => a.name.localeCompare(b.name));
}

export function getTree(id) {
  const raw = game.settings.get(MODULE_ID, "trees")?.[id];
  return raw ? normalizeTree(raw) : null;
}

export async function saveTree(tree) {
  if ( !game.user.isGM ) throw new Error("Only a GM can change skill trees.");
  const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "trees") ?? {});
  const clean = normalizeTree(tree);
  const previous = all[clean.id];
  if (previous) {
    const ledgers=[...(game.journal??[])].filter(j=>j.getFlag('kg-skill-tree','equipmentLedger')?.treeId===clean.id);
    const actorUsed=[...(game.actors??[])].some(a=>a.getFlag('kg-skill-tree','trees')?.[clean.id]);
    if((previous.kind??'actor')!==clean.kind && (actorUsed||ledgers.length))throw new Error('This tree already has progress. Duplicate it before changing its kind.');
    if(clean.kind==='equipment'&&normalizeTree(previous).equipmentType!==clean.equipmentType)throw new Error('Equipment type is fixed at creation. Duplicate the design to create a different equipment type.');
    for(const ledger of ledgers){
      const records=[...(ledger.getFlag('kg-skill-tree','equipmentLedger').permanent??[]),...[...ledger.pages].flatMap(p=>p.getFlag('kg-skill-tree','equipmentBond')?.owned??[])];
      if(records.some(o=>!clean.nodes[o.id]))throw new Error('An equipment bond owns a node removed by this design. Refund it before removing the node.');
    }
  }
  all[clean.id] = clean;
  await game.settings.set(MODULE_ID, "trees", all);
  return clean;
}

export async function deleteTree(id) {
  if ( !game.user.isGM ) return;
  const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "trees") ?? {});
  delete all[id];
  await game.settings.set(MODULE_ID, "trees", all);
}

/** A copy with fresh ids for the tree, nodes and links. */
export function cloneTree(tree, name) {
  const t = normalizeTree(foundry.utils.deepClone(tree));
  const ids = new Map();
  const nodes = {};
  for ( const n of Object.values(t.nodes) ) {
    const id = randomId();
    ids.set(n.id, id);
    nodes[id] = { ...n, id };
  }
  for ( const n of Object.values(nodes) ) {
    n.useReq = { ...n.useReq, nodes: n.useReq.nodes.map(id => ids.get(id)).filter(Boolean) };
  }
  const links = {};
  for ( const l of Object.values(t.links) ) {
    const id = randomId();
    links[id] = { ...l, id, from: ids.get(l.from), to: ids.get(l.to) };
  }
  return normalizeTree({
    ...t, id: randomId(), name: name ?? `${t.name} (Copy)`, nodes, links,
    rules: t.rules.map(r => ({ ...r, id: randomId() }))
  });
}

/**
 * Lay an imported tree over an existing one, keeping the existing tree's id. Incoming nodes are matched to existing
 * nodes by what they grant (then by name) and take over their ids, so characters keep the nodes they own.
 * @returns {{tree: object, matched: number, added: number, removed: object[]}}
 */
export function importOver(current, raw) {
  const incoming = normalizeTree(raw);
  const grantKey = n => (n.grants[0] ? `${n.grants[0].kind}:${n.grants[0].uuid}` : null);
  const byGrant = new Map();
  const byName = new Map();
  for ( const n of Object.values(current.nodes) ) {
    const k = grantKey(n);
    if ( k && !byGrant.has(k) ) byGrant.set(k, n.id);
    const nm = n.name.trim().toLowerCase();
    if ( !byName.has(nm) ) byName.set(nm, n.id);
  }
  const used = new Set();
  const ids = new Map();
  let matched = 0;
  for ( const n of Object.values(incoming.nodes) ) {
    const k = grantKey(n);
    const nm = n.name.trim().toLowerCase();
    let id = (k && byGrant.has(k) && !used.has(byGrant.get(k))) ? byGrant.get(k) : null;
    if ( !id && byName.has(nm) && !used.has(byName.get(nm)) ) id = byName.get(nm);
    if ( id ) matched++;
    // A new node never borrows the id of an existing node it doesn't match, or it would inherit that node's owners.
    else id = (current.nodes[n.id] || used.has(n.id)) ? randomId() : n.id;
    used.add(id);
    ids.set(n.id, id);
  }
  const nodes = {};
  for ( const n of Object.values(incoming.nodes) ) {
    const id = ids.get(n.id);
    nodes[id] = { ...n, id, useReq: { ...n.useReq, nodes: n.useReq.nodes.map(x => ids.get(x)).filter(Boolean) } };
  }
  const links = {};
  for ( const l of Object.values(incoming.links) ) {
    const id = randomId();
    links[id] = { ...l, id, from: ids.get(l.from), to: ids.get(l.to) };
  }
  const tree = normalizeTree({ ...incoming, id: current.id, nodes, links });
  const removed = Object.values(current.nodes).filter(n => !used.has(n.id));
  return { tree, matched, added: Object.keys(nodes).length - matched, removed };
}

/* -------------------------------------------- */
/*  Graph helpers                               */
/* -------------------------------------------- */

/** Prerequisite node ids of a node (links that point into it). */
export function prerequisites(tree, nodeId) {
  return Object.values(tree.links).filter(l => (l.kind === "require") && (l.to === nodeId)).map(l => l.from);
}

/** Nodes that list this node as a prerequisite. */
export function dependents(tree, nodeId) {
  return Object.values(tree.links).filter(l => (l.kind === "require") && (l.from === nodeId)).map(l => l.to);
}

export function exclusives(tree, nodeId) {
  return Object.values(tree.links).filter(l => (l.kind === "exclusive") && ((l.from === nodeId) || (l.to === nodeId)))
    .map(l => (l.from === nodeId ? l.to : l.from));
}

/** Would a "from requires-into to" link make a loop? */
export function wouldCycle(tree, from, to) {
  if ( from === to ) return true;
  // A loop exists if `from` can already be reached by walking prerequisites forward from `to`.
  const stack = [to];
  const seen = new Set();
  while ( stack.length ) {
    const id = stack.pop();
    if ( id === from ) return true;
    if ( seen.has(id) ) continue;
    seen.add(id);
    stack.push(...dependents(tree, id));
  }
  return false;
}

/** Shape outline as a CSS clip-path, or "" for a circle (border-radius handles it). */
export function shapeClip(shape) {
  switch ( shape ) {
    case "diamond": return "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)";
    case "hexagon": return "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)";
    case "octagon": return "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)";
    default: return "";
  }
}

/** Read an image's natural size. */
export function imageSize(src) {
  return new Promise(resolve => {
    if ( !src ) return resolve(null);
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
