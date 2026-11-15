/*
 * The tree designer. A working copy of one tree is edited on a canvas with a side panel; nothing is saved until Save.
 *
 * Canvas:
 *   drag a node                    move it (and everything selected with it)
 *   drag a node's small dot        link it: the node you drop on will require it
 *   double-click empty space       add a node
 *   drop an item                   new node that grants it (or add it to the node you drop on)
 *   drop an actor                  new node that grants a feature to summon it
 *   Shift + drag on empty space    select an area
 *   drag empty space / wheel       pan / zoom
 *   Delete, Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+D, arrow keys
 */

import { DomApp } from "./base.mjs";
import { FilePickerImpl, MODULE_ID, clamp, dragData, esc, h, knownClasses, num, plural, randomId } from "../util.mjs";
import {
  ASPECTS, REFUND_POLICIES, SHAPES, defaultNode, exclusives, getTree, grantName, imageSize, importOver,
  normalizeGrant, normalizeRule, normalizeTree, prerequisites, saveTree, wouldCycle
} from "../trees.mjs";
import { grantItemData } from "../progress.mjs";
import { EVENTS, describeRule, filterChoices } from "../events.mjs";
import { TreeView } from "../renderer.mjs";
import { SUMMON_HINT, summonGrant, summoningEnabled } from "../summon.mjs";

const { DialogV2 } = foundry.applications.api;
const HISTORY_LIMIT = 150;

export class TreeDesigner extends DomApp {
  static DEFAULT_OPTIONS = {
    classes: ["kgst-app", "kgst-designer-app"],
    position: { width: 1240, height: 820 },
    window: { resizable: true, icon: "fa-solid fa-pen-ruler" }
  };

  static open(treeId) {
    const id = `kgst-designer-${treeId}`;
    const existing = foundry.applications.instances.get(id);
    if ( existing ) return existing.render({ force: true });
    const tree = getTree(treeId);
    if ( !tree ) return ui.notifications.warn("That skill tree no longer exists.");
    return new this({ id, tree }).render({ force: true });
  }

  constructor(options) {
    super(options);
    this.tree = normalizeTree(foundry.utils.deepClone(options.tree));
    this.savedJSON = JSON.stringify(this.tree);
    this.history = [this.savedJSON];
    this.historyIndex = 0;
    this.selection = new Set();
    this.selectedLink = null;
    this.sideTab = "node";
  }

  get title() {
    return `Skill Tree Designer: ${this.tree.name}${this.dirty ? " *" : ""}`;
  }

  get dirty() {
    return JSON.stringify(this.tree) !== this.savedJSON;
  }

  /* -------------------------------------------- */
  /*  Build                                       */
  /* -------------------------------------------- */

  async build() {
    this.view?.destroy();
    this.view = new TreeView({ tree: this.tree, mode: "design", wheelZoom: true });
    this.#bindCanvas();
    this.toolbar = h("div.kgst-dtoolbar");
    this.side = h("div.kgst-dside");
    this.canvasHost = h("div.kgst-dcanvas", this.view.element, h("div.kgst-dcanvas-hint", {
      text: "Double-click to add a node. Drop items or actors here. Drag a node's dot onto another node to link them."
    }));
    const root = h("div.kgst-designer", { tabindex: "-1" },
      this.toolbar,
      h("div.kgst-dmain", this.canvasHost, this.side));
    root.addEventListener("keydown", ev => this.#onKey(ev));
    this.root = root;
    this.#renderToolbar();
    this.#renderSide();
    return root;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.view?.layout();
  }

  _onPosition(position) {
    super._onPosition?.(position);
    this.view?.layout();
  }

  async close(options = {}) {
    if ( !options.force && this.dirty ) {
      const choice = await DialogV2.wait({
        window: { title: "Unsaved Changes", icon: "fa-solid fa-floppy-disk" },
        classes: ["kgst-dialog"],
        content: `<p>Save your changes to <strong>${esc(this.tree.name)}</strong> before closing?</p>`,
        buttons: [
          { action: "save", label: "Save", icon: "fa-solid fa-floppy-disk", default: true },
          { action: "discard", label: "Discard", icon: "fa-solid fa-trash" },
          { action: "cancel", label: "Keep Editing", icon: "fa-solid fa-pen" }
        ],
        rejectClose: false
      });
      if ( choice === "save" ) await this.save();
      else if ( choice !== "discard" ) return this;
    }
    this.view?.destroy();
    return super.close({ ...options, force: true });
  }

  /* -------------------------------------------- */
  /*  History                                     */
  /* -------------------------------------------- */

  /** Record the current tree as an undo step. Call after every finished change. */
  commit({ side = false, full = false } = {}) {
    const json = JSON.stringify(this.tree);
    if ( json === this.history[this.historyIndex] ) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(json);
    if ( this.history.length > HISTORY_LIMIT ) this.history.shift();
    this.historyIndex = this.history.length - 1;
    if ( full ) this.view.render();
    if ( side ) this.#renderSide();
    this.#refreshChrome();
  }

  undo() {
    if ( this.historyIndex <= 0 ) return;
    this.historyIndex--;
    this.#restore();
  }

  redo() {
    if ( this.historyIndex >= this.history.length - 1 ) return;
    this.historyIndex++;
    this.#restore();
  }

  #restore() {
    this.tree = JSON.parse(this.history[this.historyIndex]);
    this.view.tree = this.tree;
    for ( const id of [...this.selection] ) if ( !this.tree.nodes[id] ) this.selection.delete(id);
    if ( this.selectedLink && !this.tree.links[this.selectedLink] ) this.selectedLink = null;
    this.view.render();
    this.view.setSelection(this.selection, this.selectedLink);
    this.#renderSide();
    this.#refreshChrome();
  }

  async save() {
    try {
      const clean = await saveTree(this.tree);
      this.tree = clean;
      this.view.tree = clean;
      this.savedJSON = JSON.stringify(clean);
      this.history[this.historyIndex] = this.savedJSON;
      this.#refreshChrome();
      ui.notifications.info(`Saved ${clean.name}.`);
    } catch(err) {
      ui.notifications.error(`Could not save: ${err.message}`);
    }
  }

  #refreshChrome() {
    const title = this.element?.querySelector(".window-title");
    if ( title ) title.textContent = this.title;
    this.toolbar?.querySelector("[data-act=save]")?.classList.toggle("dirty", this.dirty);
    const u = this.toolbar?.querySelector("[data-act=undo]");
    const r = this.toolbar?.querySelector("[data-act=redo]");
    if ( u ) u.disabled = this.historyIndex <= 0;
    if ( r ) r.disabled = this.historyIndex >= this.history.length - 1;
  }

  /* -------------------------------------------- */
  /*  Toolbar                                     */
  /* -------------------------------------------- */

  #renderToolbar() {
    const t = this.tree;
    const b = (act, icon, label, tip) => h("button.kgst-btn", { type: "button", dataset: { act }, "data-tooltip": tip ?? null },
      h(`i.${icon.split(" ").join(".")}`), label ? ` ${label}` : null);
    this.toolbar.replaceChildren(
      b("save", "fa-solid fa-floppy-disk", "Save", "Save (Ctrl+S)"),
      b("undo", "fa-solid fa-rotate-left", null, "Undo (Ctrl+Z)"),
      b("redo", "fa-solid fa-rotate-right", null, "Redo (Ctrl+Y)"),
      h("span.kgst-sep"),
      b("add", "fa-solid fa-circle-plus", "Node", "Add a node in the middle of the view"),
      b("background", "fa-solid fa-image", "Background", "Choose a background image"),
      h("label.kgst-toggle", { "data-tooltip": "Snap nodes to a grid while moving them" },
        h("input", { type: "checkbox", dataset: { act: "snap" }, checked: t.grid.snap }), " Snap"),
      h("span.kgst-sep"),
      b("zoom-out", "fa-solid fa-magnifying-glass-minus", null, "Zoom out"),
      b("zoom-in", "fa-solid fa-magnifying-glass-plus", null, "Zoom in"),
      b("fit", "fa-solid fa-expand", null, "Fit to view"),
      h("span.kgst-spacer"),
      b("characters", "fa-solid fa-users", "Characters", "Unlock this tree for characters"),
      b("import", "fa-solid fa-file-import", null, "Import a file over this design (characters keep matching nodes)"),
      b("export", "fa-solid fa-file-export", null, "Export to a file"),
      b("help", "fa-solid fa-circle-question", null, "Designer help"));
    this.toolbar.addEventListener("click", ev => this.#onToolbar(ev));
    this.toolbar.addEventListener("change", ev => {
      if ( ev.target.dataset.act !== "snap" ) return;
      this.tree.grid.snap = ev.target.checked;
      this.commit({ full: true, side: this.sideTab === "tree" });
    });
    this.#refreshChrome();
  }

  async #onToolbar(ev) {
    const el = ev.target.closest("button[data-act]");
    if ( !el ) return;
    ev.preventDefault();
    switch ( el.dataset.act ) {
      case "save": return this.save();
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "add": {
        const r = this.view.viewport.getBoundingClientRect();
        const pos = this.view.toFraction(r.left + (r.width / 2), r.top + (r.height / 2));
        return this.addNode(pos);
      }
      case "background": return this.pickBackground();
      case "zoom-in": return this.view.zoomBy(1.25);
      case "zoom-out": return this.view.zoomBy(1 / 1.25);
      case "fit": return this.view.fit();
      case "characters": {
        if ( this.dirty ) await this.save();
        const { charactersDialog } = await import("./manager.mjs");
        return charactersDialog(getTree(this.tree.id) ?? this.tree);
      }
      case "import": return this.importFile();
      case "export": {
        const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
        return save(JSON.stringify({ kgSkillTree: 1, tree: this.tree }, null, 2), "text/json",
          `skill-tree-${this.tree.name.slugify?.() ?? "export"}.json`);
      }
      case "help": return showHelp();
    }
  }

  /** Pick a tree export and lay it over this design. */
  importFile() {
    const picker = h("input", { type: "file", accept: ".json,application/json" });
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if ( !file ) return;
      try {
        const json = JSON.parse(await file.text());
        const raw = json?.tree ?? json;
        if ( !raw?.nodes ) throw new Error("This file is not a skill tree export.");
        await this.importOver(raw, file.name);
      } catch(err) {
        ui.notifications.error(`Could not import: ${err.message}`);
      }
    });
    picker.click();
  }

  /**
   * Replace the design with an imported one, keeping this tree's id and, where nodes match, their ids, so characters
   * keep what they own. Goes into the undo history and is not saved until Save.
   */
  async importOver(raw, label = "the file") {
    const result = importOver(this.tree, raw);
    // Nodes characters own that the import drops.
    const lost = [];
    for ( const a of game.actors.filter(x => x.type === "character") ) {
      const owned = a.getFlag(MODULE_ID, "trees")?.[this.tree.id]?.owned ?? [];
      const names = owned.map(o => result.removed.find(n => n.id === o.id)?.name).filter(Boolean);
      if ( names.length ) lost.push(`${esc(a.name)}: ${names.map(esc).join(", ")}`);
    }
    const ok = await DialogV2.confirm({
      window: { title: "Import Over This Design", icon: "fa-solid fa-file-import" },
      classes: ["kgst-dialog"],
      position: { width: 480 },
      content: `<p>Replace <strong>${esc(this.tree.name)}</strong> with <strong>${esc(label)}</strong>?</p>
        <ul>
          <li>${plural(result.matched, "node")} match nodes already here (by what they grant, or by name). Characters keep them.</li>
          <li>${plural(result.added, "new node")}.</li>
          <li>${result.removed.length ? `${plural(result.removed.length, "node")} removed: ${result.removed.map(n => esc(n.name)).join(", ")}.` : "No nodes removed."}</li>
        </ul>
        ${lost.length ? `<p><strong>Characters own removed nodes.</strong> Their items stay, and the points they paid stay spent, until you refund those nodes first:</p><ul>${lost.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
        <p class="hint">Undo puts the current design back. Nothing is saved until you press Save.</p>`,
      yes: { label: "Import", icon: "fa-solid fa-file-import" },
      no: { label: "Cancel", icon: "fa-solid fa-xmark" },
      rejectClose: false
    });
    if ( !ok ) return false;
    this.tree = result.tree;
    this.view.tree = this.tree;
    this.selection.clear();
    this.selectedLink = null;
    this.view.positioned = false;
    this.commit({ full: true, side: true });
    this.view.fit();
    ui.notifications.info(`Imported ${label}. Save to keep it, or undo.`);
    return true;
  }

  async pickBackground() {
    const FP = FilePickerImpl();
    const fp = new FP({
      type: "image",
      current: this.tree.background.src || "",
      callback: path => this.setBackground(path)
    });
    return fp.render(true);
  }

  async setBackground(src) {
    const bg = this.tree.background;
    bg.src = src || "";
    if ( src ) {
      const size = await imageSize(src);
      if ( size ) {
        bg.width = size.width;
        bg.height = size.height;
      }
      else ui.notifications.warn("The image could not be loaded to read its size. The canvas keeps its current shape.");
    }
    this.view.positioned = false;
    this.commit({ full: true, side: true });
    this.view.fit();
  }

  /* -------------------------------------------- */
  /*  Canvas                                      */
  /* -------------------------------------------- */

  #bindCanvas() {
    const view = this.view;
    view.on("pointerdown", (ev, { nodeEl }) => this.#onPointerDown(ev, nodeEl));
    view.on("nodeclick", () => {});
    view.on("linkclick", id => this.select([], id));
    view.on("backgroundclick", () => {
      if ( this._skipBackgroundClick ) {
        this._skipBackgroundClick = false;
        return;
      }
      this.select([]);
    });
    view.on("backgrounddblclick", ev => this.addNode(view.toFraction(ev.clientX, ev.clientY)));
    view.on("nodedblclick", id => {
      this.select([id]);
      this.side.querySelector("input[name=name]")?.select();
    });
    const vp = view.viewport;
    vp.addEventListener("dragover", ev => {
      ev.preventDefault();
      vp.classList.add("drop-target");
    });
    vp.addEventListener("dragleave", () => vp.classList.remove("drop-target"));
    vp.addEventListener("drop", ev => {
      vp.classList.remove("drop-target");
      this.#onDrop(ev);
    });
  }

  #onPointerDown(ev, nodeEl) {
    this.root?.focus({ preventScroll: true });
    if ( ev.button !== 0 ) return;
    if ( nodeEl ) {
      const id = nodeEl.dataset.nodeId;
      if ( ev.target.closest(".kgst-handle") ) {
        ev.preventDefault();
        this.#startLink(ev, id);
        return false;
      }
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if ( additive ) {
        const next = new Set(this.selection);
        if ( next.has(id) ) next.delete(id);
        else next.add(id);
        this.select([...next]);
        return false;
      }
      if ( !this.selection.has(id) ) this.select([id]);
      ev.preventDefault();
      this.#startMove(ev, id);
      return false;
    }
    if ( ev.shiftKey && !ev.target.closest(".kgst-link") ) {
      ev.preventDefault();
      this.#startMarquee(ev);
      return false;
    }
  }

  #startMove(ev, anchorId) {
    const view = this.view;
    const rect = view.stageRect();
    const ids = [...this.selection];
    const start = Object.fromEntries(ids.map(id => [id, { x: this.tree.nodes[id].x, y: this.tree.nodes[id].y }]));
    const origin = { x: ev.clientX, y: ev.clientY };
    let moved = false;
    let frame = null;
    const move = e => {
      const dx = (e.clientX - origin.x) / rect.width;
      const dy = (e.clientY - origin.y) / rect.height;
      if ( !moved && (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 3) ) return;
      moved = true;
      // Snap the node under the pointer, and move the rest by the same amount.
      const a = start[anchorId];
      const snapped = view.snap({ x: clamp(a.x + dx, 0, 1), y: clamp(a.y + dy, 0, 1) });
      const sx = snapped.x - a.x;
      const sy = snapped.y - a.y;
      for ( const id of ids ) {
        const n = this.tree.nodes[id];
        n.x = clamp(start[id].x + sx, 0, 1);
        n.y = clamp(start[id].y + sy, 0, 1);
        view.updateNode(id);
      }
      if ( !frame ) frame = requestAnimationFrame(() => {
        frame = null;
        view.drawLinks();
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if ( frame ) cancelAnimationFrame(frame);
      if ( moved ) {
        view.drawLinks();
        view._suppressClick = true;
        setTimeout(() => view._suppressClick = false, 0);
        this.commit();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  #startLink(ev, fromId) {
    const view = this.view;
    view.viewport.classList.add("linking");
    const move = e => view.ghostLink(fromId, view.toFraction(e.clientX, e.clientY));
    const up = e => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      view.ghostLink(null);
      view.viewport.classList.remove("linking");
      view._suppressClick = true;
      setTimeout(() => view._suppressClick = false, 0);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".kgst-node");
      const toId = target?.dataset.nodeId;
      if ( toId && (toId !== fromId) && view.viewport.contains(target) ) this.addLink(fromId, toId, ev.altKey ? "exclusive" : "require");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  #startMarquee(ev) {
    const vp = this.view.viewport;
    const vr = vp.getBoundingClientRect();
    const box = h("div.kgst-marquee");
    vp.append(box);
    const o = { x: ev.clientX, y: ev.clientY };
    const base = new Set(this.selection);
    const move = e => {
      const x1 = Math.min(o.x, e.clientX);
      const y1 = Math.min(o.y, e.clientY);
      const x2 = Math.max(o.x, e.clientX);
      const y2 = Math.max(o.y, e.clientY);
      Object.assign(box.style, { left: `${x1 - vr.left}px`, top: `${y1 - vr.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
      const sr = this.view.stageRect();
      const ids = new Set(base);
      for ( const n of Object.values(this.tree.nodes) ) {
        const cx = sr.left + (n.x * sr.width);
        const cy = sr.top + (n.y * sr.height);
        if ( (cx >= x1) && (cx <= x2) && (cy >= y1) && (cy <= y2) ) ids.add(n.id);
      }
      this.view.setSelection(ids);
      this._marquee = ids;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      box.remove();
      this._skipBackgroundClick = true;
      setTimeout(() => this._skipBackgroundClick = false, 0);
      if ( this._marquee ) this.select([...this._marquee]);
      this._marquee = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async #onDrop(ev) {
    ev.preventDefault();
    const data = dragData(ev);
    if ( !data?.uuid && !data?.type ) return;
    const onNode = ev.target.closest?.(".kgst-node")?.dataset.nodeId;
    const grant = await grantFromDrop(data);
    if ( !grant ) return;
    if ( onNode ) {
      this.addGrant(onNode, grant);
      this.select([onNode]);
      return;
    }
    const pos = this.view.snap(this.view.toFraction(ev.clientX, ev.clientY));
    const doc = grant._doc;
    delete grant._doc;
    this.addNode({ x: clamp(pos.x, 0, 1), y: clamp(pos.y, 0, 1) }, {
      name: grant.kind === "summon" ? `Summon ${grant.name}` : grant.name,
      img: grant.img,
      grants: [grant],
      // Spells and feats with a level prerequisite carry it over.
      minLevel: Number(doc?.system?.prerequisites?.level) || 0
    });
    if ( (grant.kind === "summon") && !summoningEnabled() ) ui.notifications.warn(SUMMON_HINT);
  }

  /* -------------------------------------------- */
  /*  Editing                                     */
  /* -------------------------------------------- */

  select(ids, linkId = null) {
    this.selection = new Set(ids.filter(id => this.tree.nodes[id]));
    this.selectedLink = linkId && this.tree.links[linkId] ? linkId : null;
    this.view.setSelection(this.selection, this.selectedLink);
    if ( this.selection.size || this.selectedLink ) this.sideTab = "node";
    this.#renderSide();
  }

  addNode(pos, data = {}) {
    const p = this.view.snap({ x: clamp(num(pos.x, 0.5), 0, 1), y: clamp(num(pos.y, 0.5), 0, 1) });
    const node = defaultNode(p.x, p.y, data);
    this.tree.nodes[node.id] = node;
    this.view.replaceNode(node.id);
    this.commit();
    this.select([node.id]);
    return node;
  }

  addGrant(nodeId, grant) {
    const node = this.tree.nodes[nodeId];
    const g = normalizeGrant(grant);
    if ( !node || !g ) return;
    if ( node.grants.some(x => (x.uuid === g.uuid) && (x.kind === g.kind)) ) {
      return ui.notifications.info(`${node.name} already grants ${g.name}.`);
    }
    node.grants.push(g);
    if ( !node.img ) node.img = g.img;
    this.view.replaceNode(nodeId);
    this.commit({ side: true });
    if ( (g.kind === "summon") && !summoningEnabled() ) ui.notifications.warn(SUMMON_HINT);
  }

  addLink(from, to, kind = "require") {
    const links = Object.values(this.tree.links);
    if ( kind === "require" ) {
      if ( links.some(l => (l.kind === "require") && (l.from === from) && (l.to === to)) ) return;
      if ( wouldCycle(this.tree, from, to) ) {
        return ui.notifications.warn("That link would make a loop: a node cannot end up requiring itself.");
      }
      // A reversed link would make a two-node loop, so drop it first.
      for ( const l of links ) if ( (l.kind === "require") && (l.from === to) && (l.to === from) ) delete this.tree.links[l.id];
    }
    else if ( links.some(l => (l.kind === "exclusive") && ([l.from, l.to].sort().join() === [from, to].sort().join())) ) return;
    const id = randomId();
    this.tree.links[id] = { id, from, to, kind };
    this.view.drawLinks();
    this.commit();
    this.select([], id);
  }

  deleteSelection() {
    if ( this.selectedLink ) {
      delete this.tree.links[this.selectedLink];
      this.selectedLink = null;
      this.view.drawLinks();
      this.commit({ side: true });
      return;
    }
    if ( !this.selection.size ) return;
    for ( const id of this.selection ) {
      delete this.tree.nodes[id];
      for ( const l of Object.values(this.tree.links) ) if ( (l.from === id) || (l.to === id) ) delete this.tree.links[l.id];
    }
    this.selection.clear();
    this.commit({ full: true, side: true });
  }

  duplicateSelection() {
    if ( !this.selection.size ) return;
    const map = new Map();
    for ( const id of this.selection ) {
      const src = this.tree.nodes[id];
      const copy = foundry.utils.deepClone(src);
      copy.id = randomId();
      copy.x = clamp(src.x + 0.03, 0, 1);
      copy.y = clamp(src.y + 0.03, 0, 1);
      this.tree.nodes[copy.id] = copy;
      map.set(id, copy.id);
    }
    // Keep links between copied nodes.
    for ( const l of Object.values(this.tree.links) ) {
      if ( map.has(l.from) && map.has(l.to) ) {
        const nid = randomId();
        this.tree.links[nid] = { ...l, id: nid, from: map.get(l.from), to: map.get(l.to) };
      }
    }
    this.commit({ full: true });
    this.select([...map.values()]);
  }

  nudge(dx, dy) {
    if ( !this.selection.size ) return;
    for ( const id of this.selection ) {
      const n = this.tree.nodes[id];
      n.x = clamp(n.x + dx, 0, 1);
      n.y = clamp(n.y + dy, 0, 1);
      this.view.updateNode(id);
    }
    this.view.drawLinks();
    clearTimeout(this._nudgeTimer);
    this._nudgeTimer = setTimeout(() => this.commit(), 400);
  }

  #onKey(ev) {
    const typing = ev.target.closest?.("input, textarea, select, [contenteditable]");
    const ctrl = ev.ctrlKey || ev.metaKey;
    if ( ctrl && (ev.key.toLowerCase() === "s") ) {
      ev.preventDefault();
      ev.stopPropagation();
      if ( typing ) ev.target.dispatchEvent(new Event("change", { bubbles: true }));
      return this.save();
    }
    if ( typing ) return;
    if ( ctrl && (ev.key.toLowerCase() === "z") ) {
      ev.preventDefault();
      ev.stopPropagation();
      return ev.shiftKey ? this.redo() : this.undo();
    }
    if ( ctrl && (ev.key.toLowerCase() === "y") ) {
      ev.preventDefault();
      ev.stopPropagation();
      return this.redo();
    }
    if ( ctrl && (ev.key.toLowerCase() === "d") ) {
      ev.preventDefault();
      ev.stopPropagation();
      return this.duplicateSelection();
    }
    if ( (ev.key === "Delete") || (ev.key === "Backspace") ) {
      ev.preventDefault();
      ev.stopPropagation();
      return this.deleteSelection();
    }
    if ( ev.key === "Escape" && (this.selection.size || this.selectedLink) ) {
      ev.preventDefault();
      ev.stopPropagation();
      return this.select([]);
    }
    const step = ev.shiftKey ? 0.02 : 0.004;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if ( arrows[ev.key] && this.selection.size ) {
      ev.preventDefault();
      ev.stopPropagation();
      this.nudge(...arrows[ev.key]);
    }
  }

  /* -------------------------------------------- */
  /*  Side panel                                  */
  /* -------------------------------------------- */

  #renderSide() {
    if ( !this.side ) return;
    const scroll = this.side.querySelector(".kgst-dside-body")?.scrollTop ?? 0;
    const tabs = [["node", "fa-solid fa-circle-nodes", this.selection.size > 1 ? "Selection" : this.selectedLink ? "Link" : "Node"],
      ["tree", "fa-solid fa-sliders", "Tree"], ["points", "fa-solid fa-coins", "Points"]];
    const head = h("nav.kgst-dside-tabs", tabs.map(([id, icon, label]) => h(`span.kgst-dside-tab${this.sideTab === id ? ".active" : ""}`, {
      role: "button", tabindex: "0", dataset: { tab: id }
    }, h(`i.${icon.split(" ").join(".")}`), ` ${label}`)));
    head.addEventListener("click", ev => {
      const t = ev.target.closest("[data-tab]");
      if ( !t ) return;
      this.sideTab = t.dataset.tab;
      this.#renderSide();
    });
    let body;
    if ( this.sideTab === "tree" ) body = this.#treePanel();
    else if ( this.sideTab === "points" ) body = this.#pointsPanel();
    else if ( this.selectedLink ) body = this.#linkPanel(this.tree.links[this.selectedLink]);
    else if ( this.selection.size > 1 ) body = this.#multiPanel();
    else if ( this.selection.size === 1 ) body = this.#nodePanel(this.tree.nodes[[...this.selection][0]]);
    else body = this.#nothingPanel();
    const wrap = h("div.kgst-dside-body", body);
    this.side.replaceChildren(head, wrap);
    wrap.scrollTop = scroll;
  }

  #nothingPanel() {
    const count = Object.keys(this.tree.nodes).length;
    return h("div.kgst-form",
      h("p.kgst-hint", { text: count ? "Select a node or a link to edit it." : "This tree is empty." }),
      h("ul.kgst-tips",
        h("li", { text: "Double-click the canvas to add a node." }),
        h("li", { text: "Drop a feat, item or spell from the sidebar or a compendium to make a node that grants it." }),
        h("li", { text: "Drop an actor to make a node that grants a feature summoning it." }),
        h("li", { text: "Drag the small dot on a node onto another node: the second node will require the first. Hold Alt to make them exclusive instead." }),
        h("li", { text: "Shift-drag to select an area. Drag empty space to pan, use the wheel to zoom." })),
      h("p.kgst-hint", { text: `${plural(count, "node")}, ${plural(Object.keys(this.tree.links).length, "link")}.` }));
  }

  /* -------- Node -------- */

  #nodePanel(node) {
    const t = this.tree;
    const id = node.id;
    const update = (fn, { side = false, redraw = true } = {}) => {
      fn(this.tree.nodes[id]);
      if ( redraw ) {
        this.view.replaceNode(id);
        this.view.drawLinks();
        this.view.setSelection(this.selection);
      }
      this.commit({ side });
    };
    const prereq = prerequisites(t, id);
    const excl = exclusives(t, id);
    const others = Object.values(t.nodes).filter(n => n.id !== id).sort((a, b) => a.name.localeCompare(b.name));
    const classes = knownClasses();

    const nameInput = input("text", "name", node.name);
    nameInput.addEventListener("input", () => {
      this.tree.nodes[id].name = nameInput.value;
      const label = this.view.nodeElement(id)?.querySelector(".kgst-node-label");
      if ( label ) label.textContent = nameInput.value;
    });
    nameInput.addEventListener("change", () => this.commit());

    const desc = h("textarea", { name: "description", rows: "5", placeholder: "Leave empty to show the first granted item's description." });
    desc.value = node.description;
    desc.addEventListener("change", () => update(n => n.description = desc.value, { redraw: false }));

    this._openPatch ??= new Set();
    const grantList = h("ul.kgst-grant-edit", node.grants.flatMap((g, i) => {
      const key = `${id}:${i}`;
      const patched = !foundry.utils.isEmpty(g.patch);
      const row = h("li",
        h("img", { src: g.img || "icons/svg/item-bag.svg", alt: "" }),
        h("span.kgst-grant-name", { text: g.kind === "summon" ? `Summon: ${grantName(g)}` : grantName(g), "data-tooltip": esc(g.uuid) }),
        patched ? h("span.kgst-patched", { text: "Patched", "data-tooltip": "Changed by this tree when granted. The source item is untouched." }) : null,
        g.kind === "summon" ? (() => {
          const c = input("text", "count", g.count, { size: "3", "data-tooltip": "How many to summon (a number or formula)" });
          c.addEventListener("change", () => update(n => n.grants[i].count = c.value || "1", { redraw: false }));
          return c;
        })() : h("span.kgst-muted", { text: typeLabel(g.type) }),
        g.kind === "item" ? iconButton("fa-solid fa-pen", "Adjust what this tree grants", () => {
          if ( this._openPatch.has(key) ) this._openPatch.delete(key);
          else this._openPatch.add(key);
          this.#renderSide();
        }) : null,
        iconButton("fa-solid fa-eye", "Open", async () => {
          const data = (g.kind === "item") && patched ? await grantItemData(g) : null;
          if ( data ) return new CONFIG.Item.documentClass(data).sheet?.render(true);
          return (await fromUuid(g.uuid))?.sheet?.render(true);
        }),
        iconButton("fa-solid fa-xmark", "Remove", () => update(n => n.grants.splice(i, 1), { side: true })));
      return (g.kind === "item") && this._openPatch.has(key) ? [row, this.#patchEditor(id, i)] : [row];
    }));
    const drop = h("div.kgst-dropzone", { text: "Drop items or actors here" });
    drop.addEventListener("dragover", ev => {
      ev.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      drop.classList.remove("over");
      const g = await grantFromDrop(dragData(ev));
      if ( g ) {
        delete g._doc;
        this.addGrant(id, g);
      }
    });

    const prereqRows = prereq.map(pid => h("li", h("span", { text: t.nodes[pid]?.name ?? "?" }),
      iconButton("fa-solid fa-xmark", "Remove", () => {
        for ( const l of Object.values(this.tree.links) ) if ( (l.kind === "require") && (l.from === pid) && (l.to === id) ) delete this.tree.links[l.id];
        this.view.drawLinks();
        this.commit({ side: true });
      })));
    const exclRows = excl.map(pid => h("li", h("span", { text: t.nodes[pid]?.name ?? "?" }),
      iconButton("fa-solid fa-xmark", "Remove", () => {
        for ( const l of Object.values(this.tree.links) ) {
          if ( (l.kind === "exclusive") && ([l.from, l.to].includes(pid)) && ([l.from, l.to].includes(id)) ) delete this.tree.links[l.id];
        }
        this.view.drawLinks();
        this.commit({ side: true });
      })));
    const addPrereq = select("addPrereq", [["", "Add a requirement..."], ...others.filter(n => !prereq.includes(n.id)).map(n => [n.id, n.name])], "");
    addPrereq.addEventListener("change", () => addPrereq.value && this.addLink(addPrereq.value, id, "require"));
    const addExcl = select("addExcl", [["", "Add an exclusive node..."], ...others.filter(n => !excl.includes(n.id)).map(n => [n.id, n.name])], "");
    addExcl.addEventListener("change", () => addExcl.value && this.addLink(id, addExcl.value, "exclusive"));

    const cost = input("number", "cost", node.cost, { min: "0", step: "1" });
    cost.addEventListener("change", () => update(n => n.cost = Math.max(0, Math.floor(num(cost.value, 0)))));

    const imgInput = input("text", "img", node.img, { placeholder: "Uses the first granted item's icon" });
    imgInput.addEventListener("change", () => update(n => n.img = imgInput.value.trim(), { side: true }));
    const pickImg = iconButton("fa-solid fa-file-image", "Browse", () => {
      const FP = FilePickerImpl();
      new FP({ type: "image", current: node.img, callback: path => update(n => n.img = path, { side: true }) }).render(true);
    });

    const mode = select("requireMode", [["all", "All of them"], ["any", "Any one of them"]], node.requireMode);
    mode.addEventListener("change", () => update(n => n.requireMode = mode.value, { redraw: false }));
    const minLevel = input("number", "minLevel", node.minLevel || "", { min: "0", step: "1", placeholder: "None" });
    minLevel.addEventListener("change", () => update(n => n.minLevel = Math.max(0, Math.floor(num(minLevel.value, 0))), { redraw: false }));
    const classSel = select("classId", [["", "No class requirement"], ...classes], node.classReq.identifier);
    const classLvl = input("number", "classLevel", node.classReq.level || "", { min: "0", step: "1", placeholder: "Level" });
    const setClass = () => update(n => n.classReq = { identifier: classSel.value, level: Math.max(0, Math.floor(num(classLvl.value, 0))) || (classSel.value ? 1 : 0) }, { redraw: false, side: true });
    classSel.addEventListener("change", setClass);
    classLvl.addEventListener("change", setClass);
    const minSpent = input("number", "minSpent", node.minSpent || "", { min: "0", step: "1", placeholder: "None" });
    minSpent.addEventListener("change", () => update(n => n.minSpent = Math.max(0, Math.floor(num(minSpent.value, 0))), { redraw: false }));
    const useCount = input("number", "useCount", node.useReq.count || "", { min: "0", step: "1", placeholder: "None" });
    useCount.addEventListener("change", () => update(n => n.useReq.count = Math.max(0, Math.floor(num(useCount.value, 0))), { redraw: false, side: true }));
    const useNodes = node.useReq.count > 0 ? h("div.kgst-use-nodes", others.map(o => {
      const box = h("input", { type: "checkbox", checked: node.useReq.nodes.includes(o.id) });
      box.addEventListener("change", () => update(n => {
        n.useReq.nodes = n.useReq.nodes.filter(x => x !== o.id);
        if ( box.checked ) n.useReq.nodes.push(o.id);
      }, { redraw: false }));
      return h("label", box, h("span", { text: o.name, title: o.name }));
    })) : null;
    const hidden = h("input", { type: "checkbox", name: "hidden", checked: node.hidden });
    hidden.addEventListener("change", () => update(n => n.hidden = hidden.checked));

    const shape = select("shape", Object.entries(SHAPES), node.shape);
    shape.addEventListener("change", () => update(n => n.shape = shape.value));
    const size = input("range", "size", node.size, { min: "0.4", max: "3", step: "0.1" });
    const sizeOut = h("span.kgst-range-val", { text: `${node.size}x` });
    size.addEventListener("input", () => {
      this.tree.nodes[id].size = num(size.value, 1);
      sizeOut.textContent = `${size.value}x`;
      this.view.updateNode(id);
      this.view.drawLinks();
    });
    size.addEventListener("change", () => this.commit());
    const color = input("color", "color", node.color || "#d4a64a");
    color.addEventListener("change", () => update(n => n.color = color.value));
    const clearColor = iconButton("fa-solid fa-eraser", "Default color", () => update(n => n.color = "", { side: true }));
    const label = h("input", { type: "checkbox", name: "label", checked: node.label !== false });
    label.addEventListener("change", () => update(n => n.label = label.checked));

    return h("div.kgst-form",
      section("Node",
        row("Name", nameInput),
        row("Cost", cost, h("span.kgst-muted", { text: t.currency.abbr })),
        row("Icon", imgInput, pickImg),
        h("label.kgst-label", { text: "Description" }), desc),
      section("Grants",
        node.grants.length ? grantList : h("p.kgst-hint", { text: "Nothing yet. A node can also grant nothing and just be a step on the path." }),
        drop,
        node.grants.some(g => g.kind === "summon") ? h("p.kgst-hint", { text: SUMMON_HINT }) : null),
      section("Requirements",
        h("label.kgst-label", { text: "Requires these nodes" }),
        prereqRows.length ? h("ul.kgst-link-list", prereqRows) : h("p.kgst-hint", { text: "None: available from the start." }),
        addPrereq,
        prereq.length > 1 ? row("Needs", mode) : null,
        h("label.kgst-label", { text: "Cannot be taken with" }),
        exclRows.length ? h("ul.kgst-link-list", exclRows) : null,
        addExcl,
        row("Character level", minLevel),
        row("Class", classSel, classLvl),
        row(`${t.currency.abbr} spent in tree`, minSpent),
        row("Feature uses", useCount, h("span.kgst-muted", { text: "times" })),
        useNodes ? [h("label.kgst-label", { text: "Counting uses of features from" }), useNodes,
          h("p.kgst-hint", { text: "Counted whenever the character uses one of these nodes' features. The GM can also count uses by hand on the Skill Tree tab." })] : null,
        h("label.kgst-check", hidden, h("span", { text: "Secret: players only see it once its requirements are met" }))),
      section("Look",
        row("Shape", shape),
        row("Size", size, sizeOut),
        row("Color", color, clearColor),
        h("label.kgst-check", label, h("span", { text: "Show the name under the node" }))),
      h("div.kgst-form-actions",
        h("button.kgst-btn", { type: "button", onclick: () => this.duplicateSelection() }, h("i.fa-solid.fa-copy"), " Duplicate"),
        h("button.kgst-btn.kgst-danger", { type: "button", onclick: () => this.deleteSelection() }, h("i.fa-solid.fa-trash"), " Delete")));
  }

  /**
   * Edit a grant's patch without code: a new name, a new description, and whether to drop the item's level
   * prerequisite. Changes that came in with an import (effects, activities, macros) are listed and can be cleared.
   */
  #patchEditor(nodeId, index) {
    const grant = () => this.tree.nodes[nodeId].grants[index];
    const setKey = (key, value, side = false) => {
      const g = grant();
      if ( (value === undefined) || (value === "") ) delete g.patch[key];
      else g.patch[key] = value;
      this.view.replaceNode(nodeId);
      this.commit({ side });
    };
    const p = grant().patch;
    const name = input("text", "patchName", p.name ?? "", { placeholder: grant().name });
    name.addEventListener("change", () => setKey("name", name.value.trim(), true));
    const desc = h("textarea", { rows: "6", placeholder: "Leave empty to keep the item's own description." });
    desc.value = p["system.description.value"] ?? "";
    desc.addEventListener("change", () => setKey("system.description.value", desc.value.trim()));
    const copy = h("button.kgst-btn", { type: "button" }, h("i.fa-solid.fa-copy"), " Start from the item's text");
    copy.addEventListener("click", async () => {
      const doc = await fromUuid(grant().uuid).catch(() => null);
      desc.value = doc?.system?.description?.value ?? "";
      setKey("system.description.value", desc.value.trim());
    });
    const noLevel = h("input", { type: "checkbox", checked: Object.hasOwn(p, "system.prerequisites.level") });
    noLevel.addEventListener("change", () => setKey("system.prerequisites.level", noLevel.checked ? null : undefined, true));
    const simple = new Set(["name", "system.description.value", "system.prerequisites.level"]);
    const other = Object.keys(p).filter(k => !simple.has(k));
    return h("li.kgst-patch-edit",
      h("p.kgst-hint", { text: "Changes made to the item when this node grants it. The source item is not touched, so updates to it still come through." }),
      row("Name", name),
      h("label.kgst-label", { text: "Description (HTML)" }), desc, copy,
      h("label.kgst-check", noLevel, h("span", { text: "Ignore the item's level prerequisite" })),
      other.length ? h("div.kgst-fields",
        h("span.kgst-muted", { text: `Also changes: ${other.join(", ")}` }),
        iconButton("fa-solid fa-eraser", "Clear these changes", () => {
          const g = grant();
          for ( const k of other ) delete g.patch[k];
          this.commit({ side: true });
        })) : null);
  }

  #multiPanel() {
    const ids = [...this.selection];
    const nodes = ids.map(id => this.tree.nodes[id]);
    const apply = fn => {
      for ( const n of nodes ) fn(this.tree.nodes[n.id]);
      for ( const id of ids ) this.view.replaceNode(id);
      this.view.drawLinks();
      this.view.setSelection(this.selection);
      this.commit({ side: true });
    };
    const same = key => nodes.every(n => n[key] === nodes[0][key]) ? nodes[0][key] : "";
    const shape = select("shape", [["", "Mixed"], ...Object.entries(SHAPES)], same("shape"));
    shape.addEventListener("change", () => shape.value && apply(n => n.shape = shape.value));
    const size = input("number", "size", same("size"), { min: "0.4", max: "3", step: "0.1", placeholder: "Mixed" });
    size.addEventListener("change", () => apply(n => n.size = clamp(num(size.value, 1), 0.4, 3)));
    const cost = input("number", "cost", same("cost"), { min: "0", step: "1", placeholder: "Mixed" });
    cost.addEventListener("change", () => apply(n => n.cost = Math.max(0, Math.floor(num(cost.value, 1)))));
    const color = input("color", "color", same("color") || "#d4a64a");
    color.addEventListener("change", () => apply(n => n.color = color.value));
    const align = (axis, mode) => {
      const vals = nodes.map(n => n[axis]);
      if ( mode === "align" ) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        apply(n => n[axis] = avg);
      }
      else {
        const sorted = nodes.slice().sort((a, b) => a[axis] - b[axis]);
        const min = sorted[0][axis];
        const max = sorted.at(-1)[axis];
        const step = sorted.length > 1 ? (max - min) / (sorted.length - 1) : 0;
        const pos = new Map(sorted.map((n, i) => [n.id, min + (i * step)]));
        apply(n => n[axis] = pos.get(n.id));
      }
    };
    const chain = () => {
      // Link the selection in order, left to right (or top to bottom): each requires the one before.
      const spreadX = Math.max(...nodes.map(n => n.x)) - Math.min(...nodes.map(n => n.x));
      const spreadY = Math.max(...nodes.map(n => n.y)) - Math.min(...nodes.map(n => n.y));
      const axis = spreadX >= spreadY ? "x" : "y";
      const sorted = nodes.slice().sort((a, b) => a[axis] - b[axis]);
      let added = 0;
      for ( let i = 1; i < sorted.length; i++ ) {
        const from = sorted[i - 1].id;
        const to = sorted[i].id;
        if ( Object.values(this.tree.links).some(l => l.kind === "require" && l.from === from && l.to === to) ) continue;
        if ( wouldCycle(this.tree, from, to) ) continue;
        const lid = randomId();
        this.tree.links[lid] = { id: lid, from, to, kind: "require" };
        added++;
      }
      this.view.drawLinks();
      this.commit({ side: true });
      ui.notifications.info(`Added ${plural(added, "link")}.`);
    };
    return h("div.kgst-form",
      section(`${nodes.length} nodes selected`,
        row("Shape", shape),
        row("Size", size),
        row("Cost", cost),
        row("Color", color)),
      section("Arrange",
        h("div.kgst-btn-grid",
          h("button.kgst-btn", { type: "button", onclick: () => align("y", "align") }, h("i.fa-solid.fa-grip-lines"), " Align row"),
          h("button.kgst-btn", { type: "button", onclick: () => align("x", "align") }, h("i.fa-solid.fa-grip-lines-vertical"), " Align column"),
          h("button.kgst-btn", { type: "button", onclick: () => align("x", "spread") }, h("i.fa-solid.fa-arrows-left-right"), " Spread across"),
          h("button.kgst-btn", { type: "button", onclick: () => align("y", "spread") }, h("i.fa-solid.fa-arrows-up-down"), " Spread down"),
          h("button.kgst-btn", { type: "button", onclick: chain, "data-tooltip": "Each node requires the one before it" }, h("i.fa-solid.fa-link"), " Chain"))),
      h("div.kgst-form-actions",
        h("button.kgst-btn", { type: "button", onclick: () => this.duplicateSelection() }, h("i.fa-solid.fa-copy"), " Duplicate"),
        h("button.kgst-btn.kgst-danger", { type: "button", onclick: () => this.deleteSelection() }, h("i.fa-solid.fa-trash"), ` Delete ${nodes.length}`)));
  }

  #linkPanel(link) {
    const t = this.tree;
    const a = t.nodes[link.from]?.name ?? "?";
    const b = t.nodes[link.to]?.name ?? "?";
    const kind = select("kind", [["require", `${b} requires ${a}`], ["exclusive", `${a} and ${b} exclude each other`]], link.kind);
    kind.addEventListener("change", () => {
      const l = this.tree.links[link.id];
      if ( (kind.value === "require") && wouldCycle({ ...this.tree, links: Object.fromEntries(Object.entries(this.tree.links).filter(([k]) => k !== link.id)) }, l.from, l.to) ) {
        kind.value = l.kind;
        return ui.notifications.warn("That would make a loop.");
      }
      l.kind = kind.value;
      this.view.drawLinks();
      this.commit({ side: true });
    });
    const reverse = () => {
      const l = this.tree.links[link.id];
      const others = { ...this.tree, links: Object.fromEntries(Object.entries(this.tree.links).filter(([k]) => k !== link.id)) };
      if ( (l.kind === "require") && wouldCycle(others, l.to, l.from) ) return ui.notifications.warn("That would make a loop.");
      [l.from, l.to] = [l.to, l.from];
      this.view.drawLinks();
      this.commit({ side: true });
    };
    return h("div.kgst-form",
      section("Link",
        row("Meaning", kind),
        h("p.kgst-hint", { text: link.kind === "require"
          ? "The arrow points at the node that needs the other one first. A node with several requirements needs all of them, unless its Needs is set to any one."
          : "Once one of these is taken, the other cannot be." })),
      h("div.kgst-form-actions",
        link.kind === "require" ? h("button.kgst-btn", { type: "button", onclick: reverse }, h("i.fa-solid.fa-right-left"), " Reverse") : null,
        h("button.kgst-btn", { type: "button", onclick: () => this.select([link.from]) }, h("i.fa-solid.fa-arrow-pointer"), ` Select ${a}`),
        h("button.kgst-btn.kgst-danger", { type: "button", onclick: () => this.deleteSelection() }, h("i.fa-solid.fa-trash"), " Delete")));
  }

  /* -------- Tree -------- */

  #treePanel() {
    const t = this.tree;
    const set = (fn, opts = {}) => {
      fn(this.tree);
      if ( opts.full ) this.view.render();
      this.commit({ side: !!opts.side });
    };
    const name = input("text", "treeName", t.name);
    name.addEventListener("change", () => set(tr => tr.name = name.value.trim() || "Skill Tree"));
    const img = input("text", "treeImg", t.img);
    img.addEventListener("change", () => set(tr => tr.img = img.value.trim()));
    const pickImg = iconButton("fa-solid fa-file-image", "Browse", () => {
      const FP = FilePickerImpl();
      new FP({ type: "image", current: t.img, callback: path => set(tr => tr.img = path, { side: true }) }).render(true);
    });
    const desc = h("textarea", { rows: "3", placeholder: "Optional, for your own notes." });
    desc.value = t.description;
    desc.addEventListener("change", () => set(tr => tr.description = desc.value));

    const bgSrc = input("text", "bgSrc", t.background.src, { placeholder: "No image" });
    bgSrc.addEventListener("change", () => this.setBackground(bgSrc.value.trim()));
    const bgPick = iconButton("fa-solid fa-file-image", "Browse", () => this.pickBackground());
    const bgClear = iconButton("fa-solid fa-xmark", "Remove the image", () => this.setBackground(""));
    const ratio = t.background.width / t.background.height;
    const aspectKey = Object.entries(ASPECTS).find(([, [w, hh]]) => Math.abs((w / hh) - ratio) < 0.01)?.[0] ?? "";
    const aspect = select("aspect", [["", "Custom"], ...Object.keys(ASPECTS).map(k => [k, k])], aspectKey);
    aspect.disabled = !!t.background.src;
    aspect.addEventListener("change", () => {
      const a = ASPECTS[aspect.value];
      if ( !a ) return;
      set(tr => {
        tr.background.width = a[0];
        tr.background.height = a[1];
      }, { full: true });
      this.view.fit();
    });
    const bgColor = input("color", "bgColor", t.background.color);
    bgColor.addEventListener("change", () => set(tr => tr.background.color = bgColor.value, { full: true }));

    const nodeSize = input("range", "nodeSize", t.nodeSize, { min: "2", max: "20", step: "0.5" });
    const nsOut = h("span.kgst-range-val", { text: `${t.nodeSize}%` });
    nodeSize.addEventListener("input", () => {
      this.tree.nodeSize = num(nodeSize.value, 6);
      nsOut.textContent = `${nodeSize.value}%`;
      this.view.render();
      this.view.setSelection(this.selection, this.selectedLink);
    });
    nodeSize.addEventListener("change", () => this.commit());
    const gridSize = input("number", "gridSize", t.grid.size, { min: "4", max: "200", step: "1" });
    gridSize.addEventListener("change", () => set(tr => tr.grid.size = clamp(Math.floor(num(gridSize.value, 40)), 4, 200), { full: true }));

    const cur = input("text", "curName", t.currency.name);
    cur.addEventListener("change", () => set(tr => tr.currency.name = cur.value.trim() || "Skill Points"));
    const abbr = input("text", "curAbbr", t.currency.abbr, { size: "4" });
    abbr.addEventListener("change", () => set(tr => tr.currency.abbr = abbr.value.trim() || "SP"));
    const refund = select("refund", Object.entries(REFUND_POLICIES), t.refund);
    refund.addEventListener("change", () => set(tr => tr.refund = refund.value));
    const confirmBox = h("input", { type: "checkbox", checked: t.confirmPurchase });
    confirmBox.addEventListener("change", () => set(tr => tr.confirmPurchase = confirmBox.checked));
    const chat = h("input", { type: "checkbox", checked: t.chatCards });
    chat.addEventListener("change", () => set(tr => tr.chatCards = chat.checked));

    return h("div.kgst-form",
      section("Tree",
        row("Name", name),
        row("Icon", img, pickImg),
        h("label.kgst-label", { text: "Notes" }), desc),
      section("Background",
        row("Image", bgSrc, bgPick, bgClear),
        t.background.src ? h("p.kgst-hint", { text: `${t.background.width} x ${t.background.height} pixels. The canvas takes the image's shape.` }) : null,
        row("Shape", aspect),
        !t.background.src ? null : h("p.kgst-hint", { text: "Remove the image to choose a shape by hand." }),
        row("Color", bgColor)),
      section("Nodes",
        row("Node size", nodeSize, nsOut),
        row("Grid cells across", gridSize)),
      section("Points",
        row("Name", cur),
        row("Short name", abbr),
        row("Refunds", refund),
        h("label.kgst-check", confirmBox, h("span", { text: "Ask players to confirm before unlocking a node" })),
        h("label.kgst-check", chat, h("span", { text: "Post a chat message when a node is unlocked or refunded" }))));
  }

  /* -------- Points (earning rules) -------- */

  #pointsPanel() {
    const t = this.tree;
    const groups = new Map();
    for ( const [id, ev] of Object.entries(EVENTS) ) {
      if ( !groups.has(ev.group) ) groups.set(ev.group, []);
      groups.get(ev.group).push([id, ev.label]);
    }
    const rules = t.rules.map((rule, i) => this.#ruleCard(rule, i, groups));
    const preset = (label, data) => h("button.kgst-btn", { type: "button", onclick: () => {
      this.tree.rules.push(normalizeRule({ ...data, id: randomId() }));
      this.commit({ side: true });
    } }, label);
    return h("div.kgst-form",
      section(`How ${t.currency.name} are earned`,
        h("p.kgst-hint", { text: "Each rule adds points on its own. Rules for levels and XP can also count progress made "
          + "before the tree was unlocked, if you choose that when unlocking." }),
        rules.length ? h("div.kgst-rules", rules) : h("p.kgst-empty", { text: "No rules: points only come from the GM." }),
        h("button.kgst-btn.primary", { type: "button", onclick: () => {
          this.tree.rules.push(normalizeRule({ event: "level", amount: 1, every: 1, start: 2 }));
          this.commit({ side: true });
        } }, h("i.fa-solid.fa-plus"), " Add rule")),
      section("Quick add",
        h("div.kgst-btn-grid",
          preset("1 per level after 1st", { event: "level", amount: 1, every: 1, start: 2 }),
          preset("1 per level, including 1st", { event: "level", amount: 1, every: 1, start: 1 }),
          preset("1 at levels 4, 8, 12, 16, 19", { event: "level", amount: 1, mode: "at", at: "4, 8, 12, 16, 19" }),
          preset("1 per milestone", { event: "milestone", amount: 1, every: 1 }),
          preset("1 per 5 combats", { event: "combat", amount: 1, every: 5 }),
          preset("1 per 10 crits", { event: "crit", amount: 1, every: 10 }))));
  }

  #ruleCard(rule, i, groups) {
    const ev = EVENTS[rule.event];
    const change = (fn, side = true) => {
      fn(this.tree.rules[i]);
      this.tree.rules[i] = normalizeRule(this.tree.rules[i]);
      this.commit({ side });
    };
    const event = h("select", { name: "event" }, [...groups].map(([g, list]) => h("optgroup", { label: g },
      list.map(([id, label]) => h("option", { value: id, selected: id === rule.event, text: label })))));
    event.addEventListener("change", () => change(r => {
      r.event = event.value;
      r.filter = EVENTS[event.value].filter === "class" ? (filterChoices(event.value)[0]?.[0] ?? "") : "";
      if ( EVENTS[event.value].kind === "counter" ) r.start = "";
    }));
    const fc = filterChoices(rule.event);
    const filter = ev?.filter ? select("filter", fc.length ? fc : [["", "No classes found"]], rule.filter) : null;
    filter?.addEventListener("change", () => change(r => r.filter = filter.value));
    const amount = input("number", "amount", rule.amount, { step: "1", size: "3" });
    amount.addEventListener("change", () => change(r => r.amount = Math.floor(num(amount.value, 1))));
    const mode = select("mode", [["every", "every"], ["at", "at these values"]], rule.mode);
    mode.addEventListener("change", () => change(r => r.mode = mode.value));
    const every = input("number", "every", rule.every, { min: "1", step: "1", size: "4" });
    every.addEventListener("change", () => change(r => r.every = Math.max(1, Math.floor(num(every.value, 1)))));
    const start = input("number", "start", rule.start, { min: "0", step: "1", size: "4", placeholder: ev?.kind === "level" && rule.event !== "xp" ? "1" : String(rule.every) });
    start.addEventListener("change", () => change(r => r.start = start.value === "" ? "" : Math.max(0, Math.floor(num(start.value, 0)))));
    const at = input("text", "at", rule.at, { placeholder: "e.g. 4, 8, 12" });
    at.addEventListener("change", () => change(r => r.at = at.value));
    const max = input("number", "max", rule.max || "", { min: "0", step: "1", size: "4", placeholder: "No cap" });
    max.addEventListener("change", () => change(r => r.max = Math.max(0, Math.floor(num(max.value, 0)))));
    const unit = ev ? ev.unit[1] : "";
    return h("div.kgst-rule",
      h("div.kgst-rule-head",
        h("strong.kgst-rule-text", { text: describeRule(rule) }),
        iconButton("fa-solid fa-trash", "Remove rule", () => {
          this.tree.rules.splice(i, 1);
          this.commit({ side: true });
        })),
      row("When", event),
      filter ? row(ev.filter === "class" ? "Class" : "Which", filter) : null,
      row("Gain", amount, h("span", { text: "point(s)" }), mode),
      rule.mode === "every"
        ? [row("Every", every, h("span", { text: unit })),
          row("Starting at", start, h("span", { text: rule.event === "level" ? "character level" : unit }))]
        : row("At", at, h("span", { text: unit })),
      row("Cap", max, h("span.kgst-muted", { text: "points from this rule" })),
      ev?.hint ? h("p.kgst-hint", { text: ev.hint }) : null);
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

async function grantFromDrop(data) {
  if ( !data ) return null;
  const type = data.type;
  if ( (type !== "Item") && (type !== "Actor") ) {
    ui.notifications.warn("Drop an item (feat, spell, equipment...) or an actor.");
    return null;
  }
  const doc = data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
  if ( !doc ) {
    ui.notifications.warn("That could not be found. Items and actors must be in the world or a compendium.");
    return null;
  }
  if ( doc.documentName === "Actor" ) {
    if ( doc.isToken || doc.parent ) {
      ui.notifications.warn("Drop an actor from the Actors sidebar or a compendium, not a token.");
      return null;
    }
    return { ...summonGrant(doc), _doc: doc };
  }
  if ( doc.documentName !== "Item" ) return null;
  if ( ["class", "subclass"].includes(doc.type) ) {
    ui.notifications.warn("Classes and subclasses cannot be granted by a skill tree node.");
    return null;
  }
  return { kind: "item", uuid: doc.uuid, name: doc.name, img: doc.img, type: doc.type, _doc: doc };
}

function typeLabel(type) {
  const key = CONFIG.Item?.typeLabels?.[type];
  return key ? game.i18n.localize(key) : (type ?? "");
}

function input(type, name, value, attrs = {}) {
  const el = h("input", { type, name, ...attrs });
  el.value = value ?? "";
  return el;
}

function select(name, choices, value) {
  return h("select", { name }, choices.map(([v, label]) => h("option", { value: v, selected: String(v) === String(value ?? ""), text: label })));
}

function row(label, ...fields) {
  return h("div.kgst-row", h("label", { text: label }), h("div.kgst-fields", ...fields));
}

function section(title, ...children) {
  return h("fieldset.kgst-section", h("legend", { text: title }), ...children);
}

function iconButton(icon, tip, fn) {
  const b = h("button.kgst-icon", { type: "button", "data-tooltip": tip, "aria-label": tip }, h(`i.${icon.split(" ").join(".")}`));
  b.addEventListener("click", ev => {
    ev.preventDefault();
    fn(ev);
  });
  return b;
}

function showHelp() {
  return DialogV2.prompt({
    window: { title: "Designer Help", icon: "fa-solid fa-circle-question" },
    classes: ["kgst-dialog"],
    position: { width: 520 },
    content: `<ul class="kgst-tips">
      <li><strong>Add a node:</strong> double-click the canvas, or press Node in the toolbar.</li>
      <li><strong>Grant something:</strong> drop a feat, item or spell from the sidebar or a compendium on the canvas
        (a new node) or on a node (added to it). Drop an actor to grant a feature that summons it.</li>
      <li><strong>Link nodes:</strong> drag the small dot on a node onto another node. The arrow points at the node that
        needs the first one. Hold Alt while dropping to make the two exclusive instead.</li>
      <li><strong>Move:</strong> drag nodes. Shift-drag empty space to select an area, Shift-click to add to the selection.
        Arrow keys nudge (Shift for bigger steps).</li>
      <li><strong>View:</strong> drag empty space to pan, wheel to zoom.</li>
      <li><strong>Keys:</strong> Delete removes, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+D duplicates, Ctrl+S saves.</li>
      <li><strong>Points:</strong> the Points tab sets how characters earn points. The Tree tab sets the background,
        node size, point name and refund rules.</li>
      <li><strong>Players:</strong> use Characters to unlock the tree for them. They get a Skill Tree tab on their sheet.</li>
    </ul>`,
    ok: { label: "Got it", icon: "fa-solid fa-check" },
    rejectClose: false
  });
}
