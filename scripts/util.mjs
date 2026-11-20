export const MODULE_ID = "kg-skill-tree";
export const TAB_ID = "kgSkillTree";
export const TEMPLATES = `modules/${MODULE_ID}/templates`;

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function isCharacter(actor) {
  return (actor?.documentName === "Actor") && (actor.type === "character");
}

export function randomId() {
  return foundry.utils.randomID(12);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function int(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

export function plural(n, one, many) {
  return `${n} ${Math.abs(n) === 1 ? one : (many ?? `${one}s`)}`;
}

export function renderTemplate(path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return fn(path, data);
}

export function TextEditorImpl() {
  return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

export function FilePickerImpl() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/** Parse drag data from a drop event, across v13 and v14. */
export function dragData(event) {
  const TE = TextEditorImpl();
  try {
    if ( TE?.getDragEventData ) return TE.getDragEventData(event);
  } catch(err) { /* fall through */ }
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch(err) {
    return null;
  }
}

/** Find an open ApplicationV2 by id. */
export function openApp(id) {
  return foundry.applications?.instances?.get(id) ?? null;
}

/** The active GM, or null. Some event bookkeeping is done by exactly one GM. */
export function activeGM() {
  return game.users?.activeGM ?? game.users?.find(u => u.isGM && u.active) ?? null;
}

export function isActiveGM() {
  return !!game.user?.isGM && (activeGM()?.id === game.user.id);
}

/** Character level, from dnd5e's prepared data with a fallback to the class items. */
export function characterLevel(actor) {
  const lvl = Number(actor?.system?.details?.level);
  if ( Number.isFinite(lvl) ) return lvl;
  return (actor?.items ?? []).filter(i => i.type === "class").reduce((n, i) => n + (Number(i.system?.levels) || 0), 0);
}

/** Class levels by class identifier. */
export function classLevels(actor) {
  const out = {};
  for ( const i of actor?.items ?? [] ) {
    if ( i.type !== "class" ) continue;
    const id = i.system?.identifier || i.name?.slugify?.() || i.id;
    out[id] = (out[id] ?? 0) + (Number(i.system?.levels) || 0);
  }
  return out;
}

/** Every class in the world and in compendiums the client has indexed, by identifier. */
export function knownClasses() {
  const out = new Map();
  const add = (identifier, name) => {
    if ( identifier && !out.has(identifier) ) out.set(identifier, name);
  };
  for ( const i of game.items ?? [] ) if ( i.type === "class" ) add(i.system?.identifier || i.name.slugify(), i.name);
  for ( const a of game.actors ?? [] ) {
    for ( const i of a.items ) if ( i.type === "class" ) add(i.system?.identifier || i.name.slugify(), i.name);
  }
  for ( const [key, cfg] of Object.entries(CONFIG.DND5E?.classes ?? {}) ) add(key, game.i18n.localize(cfg?.label ?? key));
  return [...out].sort((a, b) => a[1].localeCompare(b[1]));
}

export function skillChoices() {
  return Object.entries(CONFIG.DND5E?.skills ?? {}).map(([k, v]) => [k, game.i18n.localize(v.label ?? k)])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

export function abilityChoices() {
  return Object.entries(CONFIG.DND5E?.abilities ?? {}).map(([k, v]) => [k, game.i18n.localize(v.label ?? k)]);
}

export function toolChoices() {
  const out = [];
  for ( const [k, v] of Object.entries(CONFIG.DND5E?.tools ?? {}) ) {
    let label = k;
    try {
      label = dnd5e?.documents?.Trait?.keyLabel?.(`tool:${k}`) ?? k;
    } catch(err) { /* fall back to the key */ }
    if ( label === k ) label = k.replace(/^\w/, c => c.toUpperCase());
    out.push([k, label]);
  }
  return out.sort((a, b) => a[1].localeCompare(b[1]));
}

/** Re-render open character sheets. */
export function refreshCharacterSheets(actor = null) {
  for ( const app of foundry.applications?.instances?.values() ?? [] ) {
    const doc = app.document ?? app.actor;
    if ( !isCharacter(doc) || !app.rendered ) continue;
    if ( actor && (doc !== actor) ) continue;
    app.render();
  }
}

export function formatDate(ts) {
  if ( !ts ) return "";
  try {
    return new Date(ts).toLocaleDateString(game.i18n.lang, { year: "numeric", month: "short", day: "numeric" });
  } catch(err) {
    return new Date(ts).toDateString();
  }
}

/**
 * Strip scripts and event handlers from HTML that may come from a tree file someone else made.
 * Uses Foundry's own cleaner where it exists, a small one otherwise.
 */
export function safeHTML(raw) {
  const html = String(raw ?? "");
  const clean = foundry.utils?.cleanHTML;
  if ( typeof clean === "function" ) {
    try { return clean(html); } catch(err) { /* fall through to the small cleaner */ }
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll("script, iframe, object, embed, link, meta, style, base, form").forEach(e => e.remove());
  for ( const el of doc.body.querySelectorAll("*") ) {
    for ( const a of [...el.attributes] ) {
      if ( /^on/i.test(a.name) || /^\s*(javascript|vbscript|data):/i.test(a.value) ) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}

export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export function warn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

/**
 * Wrap a method named by its global path (as libWrapper takes it). `fn(wrapped, ...args)` runs with the
 * instance as `this`. With libWrapper active the wrapper is registered there, so it chains cleanly with
 * other modules' wrappers of the same method (DAE wraps Actor#prepareData, for example) and libWrapper
 * reports no conflict. Without it, the method is replaced in place, as before.
 * Use "WRAPPER" when `fn` always calls `wrapped`, "MIXED" when it sometimes returns without it.
 */
export function wrapMethod(target, fn, type = "WRAPPER") {
  if ( globalThis.libWrapper && game.modules.get("lib-wrapper")?.active ) {
    globalThis.libWrapper.register(MODULE_ID, target, fn, type);
    return true;
  }
  const path = target.split("."), key = path.pop();
  const owner = path.reduce((o, k) => o?.[k], globalThis);
  const original = owner?.[key];
  if ( typeof original !== "function" ) {
    warn(`Cannot wrap ${target}: not found.`);
    return false;
  }
  owner[key] = function(...args) { return fn.call(this, original.bind(this), ...args); };
  return true;
}

/** Small element builder: h("div.cls", { attrs }, children). */
export function h(tag, attrs = {}, ...children) {
  // The second argument is optional: a node, text or list there is the first child.
  if ( (attrs instanceof Node) || Array.isArray(attrs) || (typeof attrs !== "object") || (attrs === null) ) {
    if ( (attrs !== null) && (attrs !== undefined) && (attrs !== false) ) children.unshift(attrs);
    attrs = {};
  }
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if ( classes.length ) el.classList.add(...classes);
  for ( const [k, v] of Object.entries(attrs ?? {}) ) {
    if ( (v === undefined) || (v === null) || (v === false) ) continue;
    if ( k === "dataset" ) Object.assign(el.dataset, v);
    else if ( k === "style" && (typeof v === "object") ) {
      for ( const [prop, val] of Object.entries(v) ) {
        if ( prop.startsWith("--") ) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if ( k.startsWith("on") && (typeof v === "function") ) el.addEventListener(k.slice(2), v);
    else if ( k === "html" ) el.innerHTML = v;
    else if ( k === "text" ) el.textContent = v;
    else if ( v === true ) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for ( const c of children.flat(Infinity) ) {
    if ( (c === null) || (c === undefined) || (c === false) ) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
