/*
 * The Skill Tree panel: what a character sheet's tab (and the pop-out viewer) shows. Tree switcher, points, the
 * tree itself, and the selected node's details with Unlock and Refund.
 */

import { MODULE_ID, TextEditorImpl, esc, formatDate, h, isCharacter, safeHTML } from "./util.mjs";
import { allTrees, getTree, grantName } from "./trees.mjs";
import {
  earnedBreakdown, featureUses, grantItemData, nodeStatus, pointsSummary, purchaseNode, refundNode, refundPlan,
  resetTree, respecTree, treeState, unlockedTrees
} from "./progress.mjs";
import { countUse, giveMilestone } from "./events.mjs";
import { TreeView, legendElement, nodeIcon, reqsHTML } from "./renderer.mjs";
import { confirm, lockFor, promptAdjust, promptGmGrant, unlockFor } from "./apps/dialogs.mjs";

/* Below this the panel stops shrinking and the sheet scrolls instead: room for the header, a tree and the details. */
const MIN_PANEL = 380;

/** The nearest ancestor that scrolls vertically: the sheet's tab body. */
function scrollParent(el) {
  let node = el.parentElement;
  while ( node && (node !== document.body) ) {
    const oy = getComputedStyle(node).overflowY;
    if ( (oy === "auto") || (oy === "scroll") ) return node;
    node = node.parentElement;
  }
  return null;
}

/* Per-actor view state for the session: which tree, which node, where the camera was. */
const states = new Map();
function stateFor(actor) {
  let s = states.get(actor.uuid);
  if ( !s ) states.set(actor.uuid, s = { treeId: null, nodeId: null, cams: {}, points: false });
  return s;
}

/** Can this user see the Skill Tree tab on this character? */
export function canSeeTab(actor) {
  if ( !isCharacter(actor) ) return false;
  if ( game.user.isGM ) return allTrees().length > 0;
  return unlockedTrees(actor).length > 0;
}

export class SkillTreePanel {
  constructor(root, actor, { big = false } = {}) {
    this.root = root;
    this.actor = actor;
    this.big = big;
    root.classList.add("kgst-root");
    root.classList.toggle("kgst-big", big);
    // Tidy can keep the same root element across re-renders, so the listener always goes to the latest panel.
    if ( !root._kgstBound ) {
      root._kgstBound = true;
      root.addEventListener("click", ev => root._kgstPanel?.onClick(ev));
      root.addEventListener("change", ev => ev.stopPropagation());
      root.addEventListener("submit", ev => ev.stopPropagation());
    }
    root._kgstPanel = this;
  }

  /**
   * Size the panel to what the sheet shows, so the tab never needs scrolling: the tree takes the room that is left and
   * the details bar stays in view. Follows the sheet as it is resized. The pop-out window fills itself with CSS.
   */
  #fitToSheet() {
    const root = this.root;
    if ( this.big ) {
      root.classList.add("kgst-sized");
      return;
    }
    const scroller = scrollParent(root);
    if ( !scroller ) {
      root.classList.remove("kgst-sized");
      root.style.height = "";
      return;
    }
    const apply = () => {
      if ( !root.isConnected ) return;
      const sr = scroller.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      if ( !sr.height ) return;
      const offset = (rr.top - sr.top) + scroller.scrollTop;
      const pad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      const height = Math.max(MIN_PANEL, Math.floor(scroller.clientHeight - offset - pad - 2));
      if ( Math.abs((parseFloat(root.style.height) || 0) - height) < 1 ) return;
      root.style.height = `${height}px`;
      root.classList.add("kgst-sized");
    };
    apply();
    // One observer per root; a sheet re-render makes a new root and a new observer.
    root._kgstResize?.disconnect();
    const obs = new ResizeObserver(() => apply());
    obs.observe(scroller);
    root._kgstResize = obs;
  }

  get state() {
    return stateFor(this.actor);
  }

  /* -------------------------------------------- */

  render() {
    const actor = this.actor;
    const isGM = game.user.isGM;
    const trees = unlockedTrees(actor);
    const s = this.state;
    if ( !trees.some(t => t.id === s.treeId) ) s.treeId = trees[0]?.id ?? null;
    const tree = trees.find(t => t.id === s.treeId) ?? null;
    this.view?.destroy();
    this.view = null;

    if ( !tree ) {
      this.root.replaceChildren(this.#emptyState());
      return;
    }
    const tstate = treeState(actor, tree.id);
    const pts = pointsSummary(actor, tree, tstate);
    const statusCache = new Map();
    const status = id => {
      if ( !statusCache.has(id) ) statusCache.set(id, nodeStatus(actor, tree, tstate, id, pts));
      return statusCache.get(id);
    };
    this.ctx = { tree, tstate, pts, status };
    if ( s.nodeId && !tree.nodes[s.nodeId] ) s.nodeId = null;

    const header = h("div.kgst-head",
      trees.length > 1 ? h("div.kgst-treetabs", trees.map(t => h(`span.kgst-treetab${t.id === tree.id ? ".active" : ""}`, {
        role: "button", tabindex: "0", dataset: { kgst: "tree", treeId: t.id }
      }, h("img", { src: t.img, alt: "" }), h("span", { text: t.name })))) : h("h3.kgst-title", h("img", { src: tree.img, alt: "" }), tree.name),
      h(`div.kgst-points${pts.available > 0 ? ".has" : ""}`, {
        role: "button", tabindex: "0", dataset: { kgst: "points" }, "data-tooltip": "How points are earned"
      },
      h("span.kgst-points-num", { text: String(pts.available) }),
      h("span.kgst-points-label", h("strong", { text: tree.currency.name }), h("span", { text: `${pts.earned} earned, ${pts.spent} spent` }))),
      h("div.kgst-head-actions",
        isGM ? [
          iconBtn("adjust", "fa-solid fa-plus-minus", `Give or take ${tree.currency.name}`),
          iconBtn("milestone", "fa-solid fa-flag-checkered", "Give a milestone"),
          iconBtn("respec", "fa-solid fa-rotate-left", "Refund every node (keeps the points)"),
          iconBtn("reset", "fa-solid fa-eraser", "Reset this character's progress in this tree"),
          iconBtn("lock", "fa-solid fa-lock", "Lock this tree for this character"),
          iconBtn("unlock-other", "fa-solid fa-plus", "Unlock another tree")
        ] : null,
        this.big ? null : iconBtn("popout", "fa-solid fa-up-right-from-square", "Open in a window"))
    );

    const breakdown = s.points ? this.#breakdown(tree, tstate) : null;

    this.view = new TreeView({ tree, mode: "play", status, showHidden: isGM });
    const frame = h("div.kgst-frame", { style: { "--kgst-frame-aspect": `${tree.background.width} / ${tree.background.height}` } },
      this.view.element,
      h("div.kgst-zoombar",
        iconBtn("zoom-in", "fa-solid fa-plus", "Zoom in (or Ctrl + wheel)"),
        iconBtn("zoom-out", "fa-solid fa-minus", "Zoom out"),
        iconBtn("zoom-fit", "fa-solid fa-expand", "Fit")));
    this.view.on("nodeclick", id => this.select(id));
    this.view.on("backgroundclick", () => this.select(null));
    this.view.on("camera", cam => {
      if ( cam ) s.cams[tree.id] = cam;
      else delete s.cams[tree.id];
    });
    this.detail = h("div.kgst-detail");

    this.root.replaceChildren(h("div.kgst-panel", header, breakdown, frame, legendElement(), this.detail));
    this.#fitToSheet();
    if ( s.cams[tree.id] ) this.view.restoreCamera(s.cams[tree.id]);
    else this.view.layout();
    this.view.setSelection(s.nodeId ? [s.nodeId] : []);
    this.#renderDetail();
  }

  select(nodeId) {
    this.state.nodeId = nodeId;
    this.view?.setSelection(nodeId ? [nodeId] : []);
    this.#renderDetail();
  }

  #emptyState() {
    const isGM = game.user.isGM;
    const all = allTrees();
    if ( !isGM ) return h("p.kgst-empty", { text: "No skill trees are unlocked for this character." });
    if ( !all.length ) {
      return h("div.kgst-empty-box",
        h("p", { text: "There are no skill trees yet." }),
        h("span.kgst-btn", { role: "button", tabindex: "0", dataset: { kgst: "manager" } }, h("i.fa-solid.fa-diagram-project"), " Open the Skill Trees manager"));
    }
    return h("div.kgst-empty-box",
      h("p", { text: `No skill trees are unlocked for ${this.actor.name}.` }),
      h("div.kgst-unlock-row",
        h("select.kgst-unlock-select", all.map(t => h("option", { value: t.id, text: t.name }))),
        h("span.kgst-btn", { role: "button", tabindex: "0", dataset: { kgst: "unlock-selected" } }, h("i.fa-solid.fa-lock-open"), " Unlock")),
      h("span.kgst-link", { role: "button", tabindex: "0", dataset: { kgst: "manager" } }, "Open the Skill Trees manager"));
  }

  #breakdown(tree, tstate) {
    const rows = earnedBreakdown(this.actor, tree, tstate);
    const log = (tstate?.log ?? []).slice(-8).reverse();
    return h("div.kgst-breakdown",
      h("div.kgst-breakdown-col",
        h("h4", { text: "Earning" }),
        rows.length ? h("ul", rows.map(r => h("li", h("span", { text: r.text }), h("strong", { text: `${r.points >= 0 ? "+" : ""}${r.points}` }))))
          : h("p.kgst-muted", { text: "This tree has no earning rules. The GM gives points by hand." }),
        tstate?.retro === false ? h("p.kgst-muted", { text: `Counting since ${formatDate(tstate.since)}.` }) : null),
      game.user.isGM ? h("div.kgst-breakdown-col",
        h("h4", { text: "Recent" }),
        log.length ? h("ul", log.map(e => h("li",
          h("span", { text: e.text ?? e.type }),
          h("span.kgst-muted", { text: formatDate(e.at) })))) : h("p.kgst-muted", { text: "Nothing yet." })) : null);
  }

  async #renderDetail() {
    const el = this.detail;
    if ( !el ) return;
    const { tree, tstate, pts, status } = this.ctx;
    const id = this.state.nodeId;
    const node = id ? tree.nodes[id] : null;
    if ( !node ) {
      el.replaceChildren(h("p.kgst-hint", { text: pts.available > 0
        ? `Select a node to see what it does. Glowing nodes can be unlocked now.`
        : "Select a node to see what it does." }));
      return;
    }
    const st = status(id);
    const isGM = game.user.isGM;
    const token = el._token = (el._token ?? 0) + 1;
    const stateLabel = st.owned ? "Unlocked" : st.available ? "Available" : !st.met ? "Locked" : `Needs ${node.cost - pts.available} more ${tree.currency.abbr}`;
    const description = await this.#description(node);
    if ( el._token !== token ) return;

    const actions = [];
    if ( st.owned ) {
      const plan = refundPlan(this.actor, tree, tstate, id);
      if ( plan.ok ) actions.push(btn("refund", "fa-solid fa-rotate-left", plan.extra.length ? `Refund (and ${plan.extra.length} more)` : "Refund"));
      else if ( !isGM ) actions.push(h("span.kgst-muted", { text: plan.reason }));
    }
    else {
      if ( st.available ) actions.push(btn("buy", "fa-solid fa-lock-open", node.cost ? `Unlock for ${node.cost} ${tree.currency.abbr}` : "Unlock", "primary"));
      if ( isGM ) actions.push(btn("gm-grant", "fa-solid fa-gift", "GM: grant"));
    }

    const grants = node.grants.map((g, i) => h("li", h("span.kgst-grant", {
      role: "button", tabindex: "0", dataset: { kgst: "open-grant", index: String(i) }
    }, h("img", { src: g.img || "icons/svg/item-bag.svg", alt: "" }),
    h("span", { text: g.kind === "summon" ? `Summon: ${grantName(g)}` : grantName(g) }))));

    // GM: a use counter on nodes whose features another node needs used a number of times.
    const counted = Object.values(tree.nodes).some(n => (n.useReq?.count > 0) && n.useReq.nodes.includes(id));
    const uses = (isGM && counted) ? h("div.kgst-uses",
      h("span", { text: `Times used: ${featureUses(this.actor, tree, [id])}` }),
      iconBtn("use-minus", "fa-solid fa-minus", "Take back a use"),
      iconBtn("use-plus", "fa-solid fa-plus", "Count a use (for features that trigger on their own)")) : null;

    el.replaceChildren(h("div.kgst-detail-card",
      h("div.kgst-detail-head",
        h("img.kgst-detail-icon", { src: nodeIcon(node, tree), alt: "" }),
        h("div",
          h("h4", { text: node.name }),
          h("div.kgst-detail-meta",
            h(`span.kgst-pill.state-${st.owned ? "owned" : st.available ? "available" : "locked"}`, { text: stateLabel }),
            h("span.kgst-pill", { text: node.cost ? `${node.cost} ${tree.currency.abbr}` : "Free" }),
            node.hidden && isGM ? h("span.kgst-pill", { text: "Secret" }) : null,
            (() => {
              const o = tstate?.owned.find(x => x.id === id);
              if ( !o?.gm ) return null;
              const tip = [o.level ? `Gained at level ${o.level}` : "", o.note].filter(Boolean).join(". ");
              return h("span.kgst-pill", { text: "Granted by the GM", "data-tooltip": tip || null });
            })())),
        h("div.kgst-detail-actions", actions)),
      h("div.kgst-detail-body",
        h("div.kgst-detail-desc", { html: description || "<p class=\"kgst-muted\">No description.</p>" }),
        h("div.kgst-detail-side",
          grants.length ? [h("h5", { text: "Grants" }), h("ul.kgst-grants", grants)] : null,
          uses,
          h("h5", { text: "Requires" }),
          h("div", { html: reqsHTML(st.reqs) })))));
  }

  async #description(node) {
    let html = node.description || "";
    if ( !html && node.grants.length ) {
      const g = node.grants[0];
      const data = g.kind === "item" ? await grantItemData(g) : null;
      html = data?.system?.description?.value ?? "";
    }
    if ( !html ) return "";
    if ( !/<\w/.test(html) ) html = `<p>${esc(html).replace(/\n/g, "<br>")}</p>`;
    else html = safeHTML(html);
    try {
      return await TextEditorImpl().enrichHTML(html, { secrets: game.user.isGM, rollData: this.actor.getRollData?.(), relativeTo: this.actor });
    } catch(err) {
      return html;
    }
  }

  /* -------------------------------------------- */

  async onClick(ev) {
    const el = ev.target.closest("[data-kgst]");
    if ( !el || !this.root.contains(el) ) return;
    ev.preventDefault();
    ev.stopPropagation();
    const actor = this.actor;
    const s = this.state;
    const tree = this.ctx?.tree ? getTree(this.ctx.tree.id) : null;
    switch ( el.dataset.kgst ) {
      case "tree":
        s.treeId = el.dataset.treeId;
        s.nodeId = null;
        return this.render();
      case "points":
        s.points = !s.points;
        return this.render();
      case "zoom-in": return this.view?.zoomBy(1.25);
      case "zoom-out": return this.view?.zoomBy(1 / 1.25);
      case "zoom-fit": return this.view?.fit();
      case "popout": {
        const { SkillTreeViewer } = await import("./apps/viewer.mjs");
        return SkillTreeViewer.open(actor);
      }
      case "manager": {
        const { TreeManager } = await import("./apps/manager.mjs");
        return TreeManager.open();
      }
      case "open-grant": {
        const g = this.ctx?.tree?.nodes[s.nodeId]?.grants[Number(el.dataset.index)];
        if ( !g ) return;
        // The character's own copy if it has one; otherwise the item as the tree would grant it, patch included.
        const owned = actor.items.find(i => i.getFlag(MODULE_ID, "grant")?.nodeId === s.nodeId
          && ((i._stats?.compendiumSource === g.uuid) || (i.name === grantName(g))));
        if ( owned ) return owned.sheet?.render(true);
        if ( (g.kind === "item") && !foundry.utils.isEmpty(g.patch) ) {
          const data = await grantItemData(g);
          if ( data ) return new CONFIG.Item.documentClass(data).sheet?.render(true);
        }
        const doc = await fromUuid(g.uuid).catch(() => null);
        if ( !doc ) return ui.notifications.warn("That item or actor could not be found.");
        return doc.sheet?.render(true);
      }
      case "unlock-selected": {
        const select = this.root.querySelector(".kgst-unlock-select");
        const t = getTree(select?.value);
        if ( t && await unlockFor([actor], t) ) s.treeId = t.id;
        return;
      }
      case "unlock-other": return this.#unlockOther();
    }
    if ( !tree ) return;
    const node = tree.nodes[s.nodeId];
    switch ( el.dataset.kgst ) {
      case "buy": {
        if ( !node ) return;
        if ( tree.confirmPurchase && !(await confirm(`Unlock ${node.name}`,
          `<p>Spend <strong>${node.cost} ${esc(tree.currency.abbr)}</strong> to unlock <strong>${esc(node.name)}</strong>?</p>`
          + (node.grants.length ? `<p>${esc(actor.name)} gains: ${node.grants.map(g => esc(grantName(g))).join(", ")}.</p>` : ""),
        { yes: "Unlock", icon: "fa-solid fa-lock-open" })) ) return;
        return purchaseNode(actor, tree.id, node.id);
      }
      case "gm-grant": {
        if ( !node || !game.user.isGM ) return;
        const st = nodeStatus(actor, tree, treeState(actor, tree.id), node.id);
        const choice = await promptGmGrant(actor, tree, node, st);
        if ( choice ) return purchaseNode(actor, tree.id, node.id, { force: true, ...choice });
        return;
      }
      case "refund": {
        if ( !node ) return;
        const plan = refundPlan(actor, tree, treeState(actor, tree.id), node.id);
        if ( !plan.ok ) return ui.notifications.warn(plan.reason);
        const extra = plan.extra.map(id => tree.nodes[id]?.name).filter(Boolean);
        if ( !(await confirm(`Refund ${node.name}`,
          `<p>Refund <strong>${esc(node.name)}</strong>${extra.length ? ` and the nodes that depend on it (${extra.map(esc).join(", ")})` : ""}? `
          + "The items they granted are removed from the character.</p>", { yes: "Refund", icon: "fa-solid fa-rotate-left" })) ) return;
        return refundNode(actor, tree.id, node.id);
      }
      case "use-plus":
      case "use-minus":
        if ( node && game.user.isGM ) await countUse(actor, { treeId: tree.id, nodeId: node.id }, el.dataset.kgst === "use-plus" ? 1 : -1);
        return;
      case "adjust": return promptAdjust(actor, tree);
      case "milestone":
        await giveMilestone([actor]);
        return ui.notifications.info(`${actor.name} got a milestone.`);
      case "respec":
        if ( await confirm("Refund Every Node", `<p>Refund every node ${esc(actor.name)} has in ${esc(tree.name)}? `
          + "Granted items are removed and the points can be spent again.</p>", { yes: "Refund All", icon: "fa-solid fa-rotate-left", danger: true }) ) {
          await respecTree(actor, tree);
        }
        return;
      case "reset":
        if ( await confirm("Reset Progress", `<p>Reset ${esc(actor.name)}'s progress in ${esc(tree.name)}? Every node is refunded, `
          + "GM adjustments are cleared and points are counted again as if the tree had just been unlocked, keeping the "
          + "earlier choice of awarding past points or counting from the unlock.</p>", { yes: "Reset", icon: "fa-solid fa-eraser", danger: true }) ) {
          await resetTree(actor, tree);
        }
        return;
      case "lock":
        if ( await confirm("Lock Tree", `<p>Lock ${esc(tree.name)} for ${esc(actor.name)}? The player stops seeing it. `
          + "Unlocked nodes and their items stay, and unlocking it again picks up where it left off.</p>", { yes: "Lock", icon: "fa-solid fa-lock" }) ) {
          await lockFor([actor], tree);
        }
    }
  }

  async #unlockOther() {
    const actor = this.actor;
    const have = new Set(unlockedTrees(actor).map(t => t.id));
    const others = allTrees().filter(t => !have.has(t.id));
    if ( !others.length ) return ui.notifications.info("Every skill tree is already unlocked for this character.");
    const { DialogV2 } = foundry.applications.api;
    const id = await DialogV2.wait({
      window: { title: "Unlock a Skill Tree", icon: "fa-solid fa-lock-open" },
      classes: ["kgst-dialog"],
      content: `<div class="form-group"><label>Tree</label><div class="form-fields"><select name="tree">${
        others.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div></div>`,
      buttons: [
        { action: "ok", label: "Continue", icon: "fa-solid fa-check", default: true, callback: (e, b) => b.form.elements.tree.value },
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
      ],
      rejectClose: false
    });
    const t = getTree(id);
    if ( t && await unlockFor([actor], t) ) this.state.treeId = t.id;
  }
}

function iconBtn(action, icon, tip) {
  return h("span.kgst-icon", { role: "button", tabindex: "0", dataset: { kgst: action }, "data-tooltip": tip, "aria-label": tip }, h(`i.${icon.split(" ").join(".")}`));
}

function btn(action, icon, label, extra = "") {
  return h(`span.kgst-btn${extra ? `.${extra}` : ""}`, { role: "button", tabindex: "0", dataset: { kgst: action } }, h(`i.${icon.split(" ").join(".")}`), ` ${label}`);
}

/** Keyboard: role=button spans act like buttons. */
document.addEventListener("keydown", ev => {
  if ( (ev.key !== "Enter") && (ev.key !== " ") ) return;
  const el = ev.target.closest?.(".kgst-root [role=button][data-kgst]");
  if ( !el ) return;
  ev.preventDefault();
  el.click();
});
