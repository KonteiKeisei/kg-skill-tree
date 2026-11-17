import { DomApp } from "./base.mjs";
import { esc, h, isCharacter, plural } from "../util.mjs";
import { allTrees, cloneTree, defaultTree, deleteTree, getTree, normalizeTree, saveTree } from "../trees.mjs";
import { pointsSummary, retroactivePoints, treeState } from "../progress.mjs";
import { giveMilestone } from "../events.mjs";
import { confirm, lockFor, unlockFor } from "./dialogs.mjs";
import { attachEquipmentDialog, isEquipmentTree, listedEquipmentItems, openEquipmentItem, recoverEquipmentDialog } from "./equipment.mjs";

const { DialogV2 } = foundry.applications.api;

/** GM home for skill trees: create, design, share between worlds, and unlock for characters. */
export class TreeManager extends DomApp {
  static DEFAULT_OPTIONS = {
    id: "kgst-manager",
    classes: ["kgst-app", "kgst-manager"],
    position: { width: 640, height: "auto" },
    window: { title: "Skill Trees", icon: "fa-solid fa-diagram-project", resizable: true }
  };

  static open() {
    const existing = foundry.applications.instances.get("kgst-manager");
    if ( existing ) return existing.render({ force: true });
    return new this().render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances.get("kgst-manager");
    if ( app?.rendered ) app.render();
  }

  constructor(options = {}) {
    super(options);
    this.equipmentHook = Hooks.on("kg-skill-tree.equipmentChanged", () => {
      clearTimeout(this.equipmentRefresh);
      this.equipmentRefresh = setTimeout(() => { if ( this.rendered ) this.render(); }, 75);
    });
  }

  async close(options) {
    clearTimeout(this.equipmentRefresh);
    Hooks.off("kg-skill-tree.equipmentChanged", this.equipmentHook);
    return super.close(options);
  }

  async build() {
    const equipment = this.category === "equipment";
    const trees = allTrees().filter(t => isEquipmentTree(t) === equipment);
    const characters = game.actors.filter(isCharacter);
    const list = trees.length ? h("ul.kgst-tree-list", trees.map(t => {
      const unlocked = characters.filter(a => treeState(a, t.id)?.unlocked);
      return h("li.kgst-tree-row", { dataset: { treeId: t.id } },
        h("img", { src: t.img, alt: "" }),
        h("div.kgst-tree-info",
          h("strong", { text: t.name }),
          h("span.kgst-muted", { text: `${plural(Object.keys(t.nodes).length, "node")}, ${plural(t.rules.length, "earning rule")}` }),
          h("span.kgst-muted", { text: equipment ? "Attach to world or actor items below" : unlocked.length ? `Unlocked for ${unlocked.map(a => a.name).join(", ")}` : "Not unlocked for anyone yet" })),
        h("div.kgst-tree-actions",
          btn("design", "fa-solid fa-pen-ruler", "Design"),
          equipment ? null : btn("characters", "fa-solid fa-users", "Characters"),
          icon("duplicate", "fa-solid fa-copy", "Duplicate"),
          icon("export", "fa-solid fa-file-export", "Export to a file"),
          icon("delete", "fa-solid fa-trash", "Delete")));
    })) : h("p.kgst-empty", { text: "No skill trees yet. Create one to get started." });

    const root = h("div.kgst-manager-body",
      h("nav.kgst-categories", { "aria-label": "Tree category" },
        btn("category-actor", "fa-solid fa-user", "Actor", equipment ? "" : "primary"),
        btn("category-equipment", "fa-solid fa-toolbox", "Equipment", equipment ? "primary" : "")),
      h("div.kgst-toolbar",
        btn("create", "fa-solid fa-plus", "New Tree", "primary"),
        btn("import", "fa-solid fa-file-import", "Import"),
        h("span.kgst-spacer"),
        equipment ? [btn("attach-equipment", "fa-solid fa-link", "Attach to Item"),btn("recover-equipment", "fa-solid fa-rotate-left", "Recover Item")] : btn("milestone", "fa-solid fa-flag-checkered", "Give Milestone")),
      list,
      equipment ? this.#equipmentList() : h("p.kgst-hint", { text: "Design a tree, then unlock it for characters with Characters. Players see unlocked trees on a "
        + "Skill Tree tab on their character sheet." }));
    root.addEventListener("click", ev => this.#onClick(ev).catch(err => ui.notifications.error(err.message)));
    return root;
  }

  #equipmentList() {
    const items = listedEquipmentItems();
    return h("section.kgst-equipment-items", h("h3", { text: "Attached equipment" }),
      items.length ? h("ul.kgst-tree-list", items.map(item => h("li.kgst-tree-row", { dataset: { itemUuid: item.uuid } },
        h("img", { src: item.img, alt: "" }),
        h("div.kgst-tree-info", h("strong", { text: item.name }),
          h("span.kgst-muted", { text: `${item.actor?.name ?? "World item"}: ${getTree(item.flags["kg-skill-tree"].equipment.treeId)?.name ?? "Missing tree"}` })),
        btn("open-equipment", "fa-solid fa-diagram-project", "Open"))))
        : h("p.kgst-empty", { text: "No items have equipment trees attached." }));
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-act]");
    if ( !el ) return;
    ev.preventDefault();
    const treeId = el.closest("[data-tree-id]")?.dataset.treeId;
    const tree = treeId ? getTree(treeId) : null;
    if ( el.dataset.act.startsWith("category-") ) {
      this.category = el.dataset.act === "category-equipment" ? "equipment" : "actor";
      return this.render();
    }
    if ( el.dataset.act === "open-equipment" ) {
      const uuid = el.closest("[data-item-uuid]")?.dataset.itemUuid;
      return openEquipmentItem(listedEquipmentItems().find(item => item.uuid === uuid));
    }
    if ( el.dataset.act === "attach-equipment" ) {
      const item = await attachEquipmentDialog();
      await this.render();
      if ( item ) return openEquipmentItem(item);
      return;
    }
    const { TreeDesigner } = await import("./designer.mjs");
    if(el.dataset.act==='recover-equipment'){await recoverEquipmentDialog();return this.render();}
    switch ( el.dataset.act ) {
      case "create": {
        const draft = defaultTree();
        draft.kind = this.category ?? "actor";
        if ( draft.kind === "equipment" ) {
          const type = await DialogV2.wait({
            window: { title: "New Equipment Tree" }, classes: ["kgst-dialog"],
            content: '<p>Choose the equipment type for this tree. This type is fixed after creation.</p><label>Equipment type<select name="equipmentType"><option value="weapon">Weapon</option><option value="armor">Armor</option><option value="equipment">Other equipment</option></select></label>',
            buttons: [{ action: "create", label: "Create", default: true, callback: (e, b) => b.form.elements.equipmentType.value },
              { action: "cancel", label: "Cancel" }], rejectClose: false
          });
          if ( !["weapon", "armor", "equipment"].includes(type) ) return;
          draft.equipmentType = type;
          draft.rules = [];
        }
        const t = await saveTree(draft);
        return TreeDesigner.open(t.id);
      }
      case "import": return this.#import();
      case "milestone": return milestoneDialog();
      case "design": return TreeDesigner.open(treeId);
      case "characters": return tree && charactersDialog(tree);
      case "duplicate": return tree && saveTree(cloneTree(tree));
      case "export": {
        if ( !tree ) return;
        const data = JSON.stringify({ kgSkillTree: 1, tree }, null, 2);
        const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
        return save(data, "text/json", `skill-tree-${tree.name.slugify?.() ?? "export"}.json`);
      }
      case "delete": {
        if ( !tree ) return;
        const users = game.actors.filter(a => isCharacter(a) && treeState(a, tree.id)?.unlocked);
        if ( !(await confirm(`Delete ${tree.name}`, `<p>Delete the skill tree <strong>${esc(tree.name)}</strong>?</p>`
          + (users.length ? `<p>It is unlocked for ${users.map(a => esc(a.name)).join(", ")}. Items they got from it stay on their sheets.</p>` : "")
          + "<p>This cannot be undone. Export it first to keep a copy.</p>", { yes: "Delete", icon: "fa-solid fa-trash", danger: true })) ) return;
        return deleteTree(tree.id);
      }
    }
  }

  async #import() {
    const input = h("input", { type: "file", accept: ".json,application/json" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if ( !file ) return;
      try {
        const json = JSON.parse(await file.text());
        const raw = json?.tree ?? json;
        if ( !raw?.nodes ) throw new Error("This file is not a skill tree export.");
        const tree = cloneTree(normalizeTree(raw), raw.name ?? "Imported Tree");
        await saveTree(tree);
        ui.notifications.info(`Imported ${tree.name}.`);
      } catch(err) {
        ui.notifications.error(`Could not import: ${err.message}`);
      }
    });
    input.click();
  }
}

function btn(act, iconCls, label, extra = "") {
  return h(`button.kgst-btn${extra ? `.${extra}` : ""}`, { type: "button", dataset: { act } }, h(`i.${iconCls.split(" ").join(".")}`), ` ${label}`);
}

function icon(act, iconCls, tip) {
  return h("button.kgst-icon", { type: "button", dataset: { act }, "data-tooltip": tip, "aria-label": tip }, h(`i.${iconCls.split(" ").join(".")}`));
}

/** Pick which characters have a tree unlocked. */
export async function charactersDialog(tree) {
  const characters = game.actors.filter(isCharacter).sort((a, b) => {
    const pa = a.hasPlayerOwner ? 0 : 1;
    const pb = b.hasPlayerOwner ? 0 : 1;
    return (pa - pb) || a.name.localeCompare(b.name);
  });
  if ( !characters.length ) return ui.notifications.info("There are no player characters in this world.");
  const rows = characters.map(a => {
    const st = treeState(a, tree.id);
    const on = !!st?.unlocked;
    const pts = st ? pointsSummary(a, tree, st) : null;
    const info = st
      ? `${pts.available} ${tree.currency.abbr} available, ${plural(st.owned.length, "node")}${on ? "" : " (locked)"}`
      : `Would get ${retroactivePoints(a, tree)} ${tree.currency.abbr} counting past progress`;
    return `<label class="kgst-char-row"><input type="checkbox" name="a.${esc(a.id)}" ${on ? "checked" : ""}>
      <img src="${esc(a.img)}" alt=""><span><strong>${esc(a.name)}</strong>${a.hasPlayerOwner ? "" : " <em class=\"kgst-muted\">(no player)</em>"}<br>
      <span class="kgst-muted">${esc(info)}</span></span></label>`;
  }).join("");
  const result = await DialogV2.wait({
    window: { title: `${tree.name}: Characters`, icon: "fa-solid fa-users" },
    classes: ["kgst-dialog"],
    position: { width: 480 },
    content: `<p>Tick the characters who have this tree. Unticking locks it: the player stops seeing it, and their nodes and items stay.</p>
      <div class="kgst-char-list">${rows}</div>`,
    buttons: [
      {
        action: "save", label: "Save", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => characters.filter(a => button.form.elements[`a.${a.id}`]?.checked).map(a => a.id)
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if ( !Array.isArray(result) ) return;
  const want = new Set(result);
  const toUnlock = characters.filter(a => want.has(a.id) && !treeState(a, tree.id)?.unlocked);
  const toLock = characters.filter(a => !want.has(a.id) && treeState(a, tree.id)?.unlocked);
  if ( toUnlock.length ) await unlockFor(toUnlock, tree);
  if ( toLock.length ) await lockFor(toLock, tree);
  TreeManager.refresh();
}

/** Give a milestone to some characters. */
export async function milestoneDialog() {
  const characters = game.actors.filter(a => isCharacter(a) && a.hasPlayerOwner);
  if ( !characters.length ) return ui.notifications.info("There are no player characters in this world.");
  const usesMilestones = allTrees().some(t => t.rules.some(r => r.event === "milestone"));
  const result = await DialogV2.wait({
    window: { title: "Give Milestone", icon: "fa-solid fa-flag-checkered" },
    classes: ["kgst-dialog"],
    position: { width: 420 },
    content: `<p>Give a milestone to:</p><div class="kgst-char-list">${characters.map(a =>
      `<label class="kgst-char-row"><input type="checkbox" name="a.${esc(a.id)}" checked><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span></label>`).join("")}</div>
      ${usesMilestones ? "" : "<p class=\"hint\">No tree has a milestone rule yet, so this earns nothing until one does.</p>"}`,
    buttons: [
      {
        action: "give", label: "Give", icon: "fa-solid fa-flag-checkered", default: true,
        callback: (event, button) => characters.filter(a => button.form.elements[`a.${a.id}`]?.checked)
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if ( !Array.isArray(result) || !result.length ) return;
  await giveMilestone(result);
  ui.notifications.info(`Milestone given to ${result.map(a => a.name).join(", ")}.`);
}
