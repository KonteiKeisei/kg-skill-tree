/*
 * One renderer for every place a tree is drawn: the designer, the sheet tab and the pop-out viewer.
 *
 *   .kgst-viewport          the visible box; clips, takes wheel and drag for zoom and pan
 *     .kgst-camera          translate + scale
 *       .kgst-stage         the tree at "fit" size, with the background's aspect ratio
 *         img.kgst-bg
 *         svg.kgst-links    viewBox 1000 wide, height by aspect
 *         .kgst-nodes       nodes placed by percent
 *
 * Node sizes are a percent of the stage width, so a tree looks the same at any size.
 */

import { clamp, esc, h } from "./util.mjs";
import { shapeClip } from "./trees.mjs";

const SVG = "http://www.w3.org/2000/svg";
const VB_W = 1000;
const DEFAULT_ICON = "icons/svg/upgrade.svg";

export function nodeIcon(node, tree) {
  return node.img || node.grants?.[0]?.img || tree?.img || DEFAULT_ICON;
}

export class TreeView {
  /**
   * @param {object} options
   * @param {object} options.tree
   * @param {"design"|"play"} options.mode
   * @param {(nodeId: string) => object} [options.status]  Play mode: nodeStatus for a node.
   * @param {boolean} [options.wheelZoom]  Zoom on a plain wheel. Otherwise the wheel zooms only with Ctrl held.
   */
  constructor({ tree, mode = "play", status = null, wheelZoom = false, showHidden = false } = {}) {
    this.tree = tree;
    this.mode = mode;
    this.status = status;
    this.wheelZoom = wheelZoom;
    this.showHidden = showHidden;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.selected = new Set();
    this.selectedLink = null;
    this.listeners = {};
    this.element = this.#build();
  }

  on(name, fn) {
    this.listeners[name] = fn;
    return this;
  }

  emit(name, ...args) {
    return this.listeners[name]?.(...args);
  }

  get aspect() {
    const bg = this.tree.background;
    return bg.width / bg.height;
  }

  get vbHeight() {
    return VB_W / this.aspect;
  }

  /* -------------------------------------------- */
  /*  Build                                       */
  /* -------------------------------------------- */

  #build() {
    this.viewport = h("div.kgst-viewport", { dataset: { mode: this.mode } });
    this.camera = h("div.kgst-camera");
    this.stage = h("div.kgst-stage");
    this.bg = h("img.kgst-bg", { alt: "", draggable: "false" });
    // A missing background shows the canvas color, not a broken-image icon.
    this.bg.addEventListener("error", () => this.bg.hidden = true);
    this.bg.addEventListener("load", () => this.bg.hidden = false);
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.classList.add("kgst-links");
    this.svg.setAttribute("preserveAspectRatio", "none");
    this.nodesLayer = h("div.kgst-nodes");
    this.overlay = h("div.kgst-overlay");
    this.stage.append(this.bg, this.svg, this.nodesLayer, this.overlay);
    this.camera.append(this.stage);
    this.viewport.append(this.camera);
    this.#bindViewport();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.viewport);
    this.render();
    return this.viewport;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.viewport.remove();
  }

  /** Redraw everything from the tree. */
  render() {
    const t = this.tree;
    this.stage.style.setProperty("--kgst-aspect", `${t.background.width} / ${t.background.height}`);
    this.stage.style.setProperty("--kgst-ns", String(t.nodeSize));
    this.stage.style.backgroundColor = t.background.color;
    this.stage.classList.toggle("no-image", !t.background.src);
    if ( t.background.src ) {
      // A new image is shown until it fails to load; the same image keeps whatever state it already has.
      if ( this.bg.getAttribute("src") !== t.background.src ) {
        this.bg.hidden = false;
        this.bg.src = t.background.src;
      }
    }
    else {
      this.bg.removeAttribute("src");
      this.bg.hidden = true;
    }
    this.svg.setAttribute("viewBox", `0 0 ${VB_W} ${this.vbHeight}`);
    this.#renderGrid();
    this.nodesLayer.replaceChildren(...Object.values(t.nodes).filter(n => this.#visible(n)).map(n => this.#nodeElement(n)));
    this.drawLinks();
    this.layout();
  }

  #visible(node) {
    if ( this.mode === "design" || this.showHidden ) return true;
    return !this.status?.(node.id)?.hidden;
  }

  #renderGrid() {
    const g = this.tree.grid;
    const show = (this.mode === "design") && g.snap;
    this.stage.classList.toggle("show-grid", show);
    if ( show ) {
      const rows = g.size / this.aspect;
      this.stage.style.setProperty("--kgst-gx", `${100 / g.size}%`);
      this.stage.style.setProperty("--kgst-gy", `${100 / rows}%`);
    }
  }

  /** Snap a position to the grid, when the tree has snapping on. Grid cells are square on screen. */
  snap(pos) {
    const g = this.tree.grid;
    if ( !g.snap ) return pos;
    const cols = g.size;
    const rows = g.size / this.aspect;
    return { x: clamp(Math.round(pos.x * cols) / cols, 0, 1), y: clamp(Math.round(pos.y * rows) / rows, 0, 1) };
  }

  #nodeElement(node) {
    const st = this.mode === "play" ? (this.status?.(node.id) ?? {}) : {};
    const classes = ["kgst-node", `shape-${node.shape}`];
    if ( this.mode === "play" ) {
      if ( st.owned ) classes.push("owned");
      else if ( st.available ) classes.push("available");
      else if ( st.met ) classes.push("unaffordable");
      else classes.push("locked");
      if ( st.blocked ) classes.push("blocked");
      if ( st.hidden ) classes.push("secret");
    }
    if ( this.selected.has(node.id) ) classes.push("selected");
    const el = h(`div.${classes.join(".")}`, {
      dataset: { nodeId: node.id },
      tabindex: this.mode === "play" ? "0" : null,
      role: this.mode === "play" ? "button" : null,
      "aria-label": node.name,
      "data-tooltip": this.mode === "play" ? tooltipText(node, st, this.tree) : null
    });
    this.#placeNode(el, node);
    const clip = shapeClip(node.shape);
    const face = h("div.kgst-node-face", { style: { backgroundImage: `url("${nodeIcon(node, this.tree)}")` } });
    const ring = h("div.kgst-node-ring");
    if ( clip ) {
      face.style.clipPath = clip;
      ring.style.clipPath = clip;
    }
    if ( node.color ) el.style.setProperty("--kgst-node-color", node.color);
    el.append(ring, face);
    if ( this.mode === "play" ) {
      // One corner badge says the state at a glance: owned, blocked, locked, or the cost.
      if ( st.owned ) el.append(h("span.kgst-node-badge.is-owned", { html: "<i class=\"fa-solid fa-check\"></i>" }));
      else if ( st.blocked ) el.append(h("span.kgst-node-badge.is-blocked", { html: "<i class=\"fa-solid fa-ban\"></i>" }));
      else if ( !st.met ) el.append(h("span.kgst-node-badge.is-locked", { html: "<i class=\"fa-solid fa-lock\"></i>" }));
      else if ( node.cost > 0 ) el.append(h(`span.kgst-node-cost${st.available ? ".is-available" : ".is-short"}`, { text: String(node.cost) }));
    }
    else if ( node.cost > 0 ) el.append(h("span.kgst-node-cost", { text: String(node.cost) }));
    if ( node.label !== false ) el.append(h("span.kgst-node-label", { text: node.name }));
    if ( this.mode === "design" ) {
      el.append(h("span.kgst-handle", { dataset: { handle: "1" }, "data-tooltip": "Drag to another node: that node will require this one" }));
      if ( node.hidden ) el.append(h("span.kgst-node-flag", { html: "<i class=\"fa-solid fa-eye-slash\"></i>" }));
    }
    return el;
  }

  #placeNode(el, node) {
    el.style.left = `${node.x * 100}%`;
    el.style.top = `${node.y * 100}%`;
    el.style.setProperty("--kgst-size", String(node.size));
  }

  nodeElement(id) {
    return this.nodesLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  }

  /** Move one node's element after its data changed, without a full render. */
  updateNode(id) {
    const node = this.tree.nodes[id];
    const el = this.nodeElement(id);
    if ( node && el ) this.#placeNode(el, node);
  }

  replaceNode(id) {
    const node = this.tree.nodes[id];
    const el = this.nodeElement(id);
    if ( !node ) {
      el?.remove();
      return;
    }
    const fresh = this.#nodeElement(node);
    if ( el ) el.replaceWith(fresh);
    else this.nodesLayer.append(fresh);
  }

  setSelection(ids, linkId = null) {
    this.selected = new Set(ids);
    this.selectedLink = linkId;
    for ( const el of this.nodesLayer.children ) el.classList.toggle("selected", this.selected.has(el.dataset.nodeId));
    for ( const el of this.svg.querySelectorAll(".kgst-link") ) el.classList.toggle("selected", el.dataset.linkId === linkId);
  }

  /* -------------------------------------------- */
  /*  Links                                       */
  /* -------------------------------------------- */

  #radius(node) {
    // Node width is nodeSize percent of the stage width; the viewBox is 1000 wide.
    return (this.tree.nodeSize * node.size * VB_W) / 100 / 2;
  }

  #point(node) {
    return { x: node.x * VB_W, y: node.y * this.vbHeight };
  }

  drawLinks() {
    const t = this.tree;
    const ns = this.svg.namespaceURI;
    const frag = document.createDocumentFragment();
    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = `<marker id="kgst-arrow-${this.uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4"
      orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"></path></marker>`;
    frag.append(defs);
    const sw = Math.max(1.5, t.nodeSize * 0.45);
    for ( const link of Object.values(t.links) ) {
      const a = t.nodes[link.from];
      const b = t.nodes[link.to];
      if ( !a || !b ) continue;
      if ( !this.#visible(a) || !this.#visible(b) ) continue;
      const p = this.#point(a);
      const q = this.#point(b);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const ra = this.#radius(a) * 1.08;
      const rb = this.#radius(b) * 1.08 + (link.kind === "require" ? sw * 1.2 : 0);
      if ( len <= ra + rb ) continue;
      const x1 = p.x + (dx / len) * ra;
      const y1 = p.y + (dy / len) * ra;
      const x2 = q.x - (dx / len) * rb;
      const y2 = q.y - (dy / len) * rb;
      const g = document.createElementNS(ns, "g");
      g.classList.add("kgst-link", `kind-${link.kind}`, ...this.#linkState(link));
      if ( link.id === this.selectedLink ) g.classList.add("selected");
      g.dataset.linkId = link.id;
      const color = b.color || a.color;
      if ( color ) g.style.setProperty("--kgst-link-c", color);
      const hit = document.createElementNS(ns, "line");
      hit.classList.add("kgst-link-hit");
      // A wide, soft copy under the line: shown as a glow on links between unlocked nodes.
      const glow = document.createElementNS(ns, "line");
      glow.classList.add("kgst-link-glow");
      glow.setAttribute("stroke-width", sw * 4);
      const line = document.createElementNS(ns, "line");
      line.classList.add("kgst-link-line");
      for ( const el of [hit, glow, line] ) {
        el.setAttribute("x1", x1);
        el.setAttribute("y1", y1);
        el.setAttribute("x2", x2);
        el.setAttribute("y2", y2);
      }
      line.setAttribute("stroke-width", sw);
      hit.setAttribute("stroke-width", sw * 5);
      if ( link.kind === "require" ) line.setAttribute("marker-end", `url(#kgst-arrow-${this.uid})`);
      else line.setAttribute("stroke-dasharray", `${sw * 2.5} ${sw * 2}`);
      g.append(hit, glow, line);
      frag.append(g);
    }
    this.svg.replaceChildren(frag);
  }

  get uid() {
    this._uid ??= foundry.utils.randomID(6);
    return this._uid;
  }

  #linkState(link) {
    if ( this.mode !== "play" || !this.status ) return [];
    if ( link.kind === "exclusive" ) return [];
    const a = this.status(link.from);
    const b = this.status(link.to);
    if ( a?.owned && b?.owned ) return ["owned"];
    if ( a?.owned && b?.available ) return ["ready"];
    if ( a?.owned ) return ["partial"];
    return ["locked"];
  }

  /** A temporary line from a node to a point, while linking in the designer. */
  ghostLink(fromId, frac) {
    let g = this.svg.querySelector(".kgst-ghost");
    if ( !fromId ) {
      g?.remove();
      return;
    }
    const a = this.tree.nodes[fromId];
    if ( !a ) return;
    if ( !g ) {
      g = document.createElementNS(this.svg.namespaceURI, "line");
      g.classList.add("kgst-ghost");
      this.svg.append(g);
    }
    const p = this.#point(a);
    g.setAttribute("x1", p.x);
    g.setAttribute("y1", p.y);
    g.setAttribute("x2", frac.x * VB_W);
    g.setAttribute("y2", frac.y * this.vbHeight);
    g.setAttribute("stroke-width", Math.max(1.5, this.tree.nodeSize * 0.45));
  }

  /* -------------------------------------------- */
  /*  Camera                                      */
  /* -------------------------------------------- */

  /** Size the stage to fit the viewport at zoom 1, and apply the camera. */
  layout() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if ( !vw || !vh ) return;
    const fit = Math.min(vw, vh * this.aspect);
    if ( this.baseWidth && (Math.abs(this.baseWidth - fit) > 0.5) ) {
      // Keep the same view when the viewport changes size.
      const k = fit / this.baseWidth;
      this.pan.x *= k;
      this.pan.y *= k;
    }
    this.baseWidth = fit;
    this.stage.style.width = `${fit}px`;
    this.stage.style.height = `${fit / this.aspect}px`;
    if ( this.pendingCamera ) {
      const cam = this.pendingCamera;
      this.pendingCamera = null;
      this.zoom = clamp(Number(cam.zoom) || 1, 0.3, 8);
      this.pan.x = (Number(cam.x) || 0) * fit;
      this.pan.y = (Number(cam.y) || 0) * fit;
      this.positioned = true;
      this.autoFit = false;
      this.#clampPan();
    }
    // Until someone zooms or pans by hand, the whole tree stays fitted to the viewport as it changes size.
    else if ( this.autoFit !== false ) return this.fit();
    else this.#clampPan();
    this.#applyCamera();
  }

  /** Fit the whole tree in view, and keep it fitted while the viewport changes size. */
  fit() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if ( !vw || !vh || !this.baseWidth ) return;
    this.zoom = 1;
    this.pan.x = (vw - this.baseWidth) / 2;
    this.pan.y = (vh - (this.baseWidth / this.aspect)) / 2;
    this.positioned = true;
    this.autoFit = true;
    this.#applyCamera();
  }

  setZoom(z, cx = null, cy = null) {
    const rect = this.viewport.getBoundingClientRect();
    const px = cx ?? (rect.left + (rect.width / 2));
    const py = cy ?? (rect.top + (rect.height / 2));
    const lx = px - rect.left;
    const ly = py - rect.top;
    const next = clamp(z, 0.3, 8);
    const k = next / this.zoom;
    this.pan.x = lx - ((lx - this.pan.x) * k);
    this.pan.y = ly - ((ly - this.pan.y) * k);
    this.zoom = next;
    this.positioned = true;
    this.autoFit = false;
    this.#clampPan();
    this.#applyCamera();
  }

  zoomBy(factor, cx, cy) {
    this.setZoom(this.zoom * factor, cx, cy);
  }

  #clampPan() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const w = this.baseWidth * this.zoom;
    const hgt = (this.baseWidth / this.aspect) * this.zoom;
    // Keep at least a quarter of the viewport showing the tree.
    const mx = vw * 0.25;
    const my = vh * 0.25;
    this.pan.x = clamp(this.pan.x, mx - w, vw - mx);
    this.pan.y = clamp(this.pan.y, my - hgt, vh - my);
  }

  #applyCamera() {
    this.camera.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    this.viewport.style.setProperty("--kgst-zoom", String(this.zoom));
    // Smooth while moving, sharp once still (see .kgst-camera.moving in the styles).
    this.camera.classList.add("moving");
    clearTimeout(this._settle);
    this._settle = setTimeout(() => this.camera.classList.remove("moving"), 200);
    // A fitted view isn't remembered as a camera: it is simply fitted again next time.
    if ( this.positioned && this.baseWidth ) this.emit("camera", this.autoFit ? null : this.camera_);
  }

  /** The camera in stage-relative terms, so it survives the viewport changing size. */
  get camera_() {
    return { zoom: this.zoom, x: this.pan.x / this.baseWidth, y: this.pan.y / this.baseWidth };
  }

  /** Restore a camera from `camera_`. Applied on the next layout if the viewport has no size yet. */
  restoreCamera(cam) {
    if ( !cam ) return;
    this.pendingCamera = cam;
    this.layout();
  }

  /** Viewport client point to tree fractions (0 to 1). */
  toFraction(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }

  /** The stage's on-screen size, for turning pixel drags into fractions. */
  stageRect() {
    return this.stage.getBoundingClientRect();
  }

  #bindViewport() {
    const vp = this.viewport;
    vp.addEventListener("wheel", ev => {
      if ( !this.wheelZoom && !ev.ctrlKey ) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY);
    }, { passive: false });

    vp.addEventListener("pointerdown", ev => {
      const nodeEl = ev.target.closest(".kgst-node");
      const linkEl = ev.target.closest(".kgst-link");
      // Let the owner (the designer) take the event first.
      if ( this.emit("pointerdown", ev, { nodeEl, linkEl }) === false ) return;
      const pan = (ev.button === 1) || ((ev.button === 0) && !nodeEl && !linkEl);
      if ( !pan ) return;
      ev.preventDefault();
      this.#startPan(ev);
    });

    vp.addEventListener("click", ev => {
      if ( this._suppressClick ) {
        this._suppressClick = false;
        return;
      }
      const nodeEl = ev.target.closest(".kgst-node");
      if ( nodeEl ) return this.emit("nodeclick", nodeEl.dataset.nodeId, ev);
      const linkEl = ev.target.closest(".kgst-link");
      if ( linkEl ) return this.emit("linkclick", linkEl.dataset.linkId, ev);
      this.emit("backgroundclick", ev);
    });

    vp.addEventListener("dblclick", ev => {
      const nodeEl = ev.target.closest(".kgst-node");
      if ( nodeEl ) return this.emit("nodedblclick", nodeEl.dataset.nodeId, ev);
      this.emit("backgrounddblclick", ev);
    });

    vp.addEventListener("keydown", ev => {
      const nodeEl = ev.target.closest?.(".kgst-node");
      if ( nodeEl && ((ev.key === "Enter") || (ev.key === " ")) ) {
        ev.preventDefault();
        this.emit("nodeclick", nodeEl.dataset.nodeId, ev);
      }
    });
  }

  #startPan(ev) {
    const start = { x: ev.clientX, y: ev.clientY, px: this.pan.x, py: this.pan.y };
    let moved = false;
    const move = e => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if ( !moved && (Math.hypot(dx, dy) < 4) ) return;
      moved = true;
      this.viewport.classList.add("panning");
      this.pan.x = start.px + dx;
      this.pan.y = start.py + dy;
      this.positioned = true;
      this.autoFit = false;
      this.#clampPan();
      this.#applyCamera();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.viewport.classList.remove("panning");
      if ( moved ) this._suppressClick = true;
      setTimeout(() => this._suppressClick = false, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

/* Foundry reads a data-tooltip as HTML, so names from the tree are escaped. */
function tooltipText(node, st, tree) {
  const name = esc(node.name);
  const abbr = esc(tree.currency.abbr);
  const cost = node.cost ? `${node.cost} ${abbr}` : "free";
  if ( st.owned ) return `${name}: unlocked`;
  if ( st.available ) return `${name}: available, ${cost}`;
  if ( st.blocked ) return `${name}: blocked by an exclusive choice`;
  if ( st.met ) return `${name}: needs more ${abbr} (${cost})`;
  return `${name}: locked, ${cost}`;
}

/** The state legend shown under a tree on the sheet. */
export function legendElement() {
  const item = (cls, text) => h("span.kgst-legend-item", h(`span.kgst-legend-swatch.${cls}`), text);
  return h("div.kgst-legend",
    item("is-owned", "Unlocked"),
    item("is-available", "Available"),
    item("is-short", "Needs points"),
    item("is-locked", "Locked"),
    item("is-blocked", "Blocked"));
}

/** HTML for a node's requirement list. */
export function reqsHTML(reqs) {
  if ( !reqs.length ) return "<p class=\"kgst-muted\">No requirements.</p>";
  return `<ul class="kgst-reqs">${reqs.map(r => `<li class="${r.ok ? "ok" : "no"}"><i class="fa-solid ${r.ok ? "fa-check" : "fa-xmark"}"></i> ${esc(r.text)}</li>`).join("")}</ul>`;
}
