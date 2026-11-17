import { DomApp } from "./base.mjs";
import { MODULE_ID, TextEditorImpl, dragData, esc, formatDate, h, safeHTML } from "../util.mjs";
import { allTrees, defaultTree, getTree, grantName, saveTree } from "../trees.mjs";
import { grantItemData, nodeStatus } from "../progress.mjs";
import { TreeView, legendElement, nodeIcon, reqsHTML } from "../renderer.mjs";
import { equipmentItems, equipmentView, equipmentRequest } from "../equipment.mjs";
import { confirm, promptGmGrant } from "./dialogs.mjs";

const { DialogV2 } = foundry.applications.api;

function enhancementDescription(b) {
  const label = (config, key) => game.i18n.localize(config?.[key]?.label ?? config?.[key] ?? key);
  const keys = b.keys?.length ? b.keys : b.key ? [b.key] : [];
  const amount = String(b.value).startsWith('-') ? b.value : `+${b.value}`;
  let benefit = ({attack:`${amount} to attack rolls`,damage:`${amount}${b.damageType ? ` ${label(CONFIG.DND5E.damageTypes,b.damageType)}` : ''} damage`,ac:`${amount} AC`})[b.kind];
  if(b.kind==='save')benefit=`${amount} to ${keys.includes('all')?'all':keys.map(k=>label(CONFIG.DND5E.abilities,k)).join(', ')} saving throws`;
  if(b.kind==='check')benefit=`${amount} to ${keys.includes('all')?'all ability checks and skill checks':keys.map(k=>`${label(CONFIG.DND5E.abilities?.[k]?CONFIG.DND5E.abilities:CONFIG.DND5E.skills,k)} checks`).join(', ')}`;
  return `${b.target==='actor'?'Wielder':'This weapon'}: ${benefit ?? amount}. ${b.stacking==='replace'?'Upgrades the earlier bonus':'Cumulative bonus'}${b.group?` (${b.group})`:''}.`;
}

function button(action, label, attrs = {}) {
  return h("button.kgst-btn", { type: "button", dataset: { equipmentAction: action }, ...attrs }, label);
}

export function isEquipmentTree(tree) {
  return tree.kind === "equipment";
}

/** World and embedded items, without resolving UUIDs or loading journals in the UI. */
export function listedEquipmentItems() {
  return [...(game.items ?? []), ...[...(game.actors ?? [])].flatMap(a => [...a.items])]
    .filter(item => item.flags?.[MODULE_ID]?.equipment?.treeId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** dnd5e stores armor and shields under the equipment item type. */
export function itemEquipmentType(item) {
  if ( item?.type === "weapon" ) return "weapon";
  if ( item?.type === "equipment" && ["light", "medium", "heavy", "shield"].includes(item.system?.type?.value) ) return "armor";
  return "equipment";
}

const equipmentTypeLabel = type => ({ weapon: "Weapon", armor: "Armor", equipment: "Other equipment" })[type] ?? "Other equipment";
const physicalTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/** Each picker owns its drop listeners. Nothing is bound to the document or global drop hooks. */
class EquipmentPicker extends DomApp {
  static DEFAULT_OPTIONS = {
    classes: ["kgst-app", "kgst-dialog", "kgst-item-picker"],
    position: { width: 480, height: "auto" },
    window: { title: "Attach Equipment Tree", resizable: true }
  };

  constructor({ item = null, trees = [], records = [], ...options } = {}) {
    super(options);
    this.item = item;
    this.instanceName = item?.name ?? "";
    this.trees = trees;
    this.records = records;
    this.recovering = records.length > 0;
    this.choiceId = (this.recovering ? records : trees)[0]?.id;
    this.result = new Promise(resolve => { this.resolveResult = resolve; });
    this.dropSequence = 0;
  }

  async close(options) {
    this.dropSequence++;
    await super.close(options);
    this.resolveResult(null);
  }

  selectedTree() {
    if ( !this.recovering ) return allTrees().find(t => t.id === this.choiceId && isEquipmentTree(t));
    const record = this.records.find(j => j.id === this.choiceId);
    return getTree(record?.getFlag(MODULE_ID, "equipmentLedger")?.treeId);
  }

  validation() {
    if ( !this.item ) return "Drop an equipment item to continue.";
    if ( this.item.documentName !== "Item" || !physicalTypes.has(this.item.type) ) return "Choose a physical equipment item, such as a weapon, armor, or tool.";
    if ( !this.item.pack && this.item.flags?.[MODULE_ID]?.equipment ) return "This item already has a tree. Detach it before attaching or recovering another identity.";
    const tree = this.selectedTree();
    if ( !tree ) return "Choose a saved record with an existing tree.";
    const type = tree.equipmentType ?? "equipment";
    if ( itemEquipmentType(this.item) !== type ) return `This tree requires ${equipmentTypeLabel(type).toLowerCase()}. Drop a matching item.`;
    if ( !this.recovering && !this.instanceName.trim() ) return "Enter an item name to continue.";
    return "";
  }

  async build() {
    const root = h("div.kgst-item-picker-body");
    root.append(h("p", { text: this.recovering
      ? "Restore a missing physical item onto a replacement. Its permanent upgrades and saved character bonds return."
      : "Choose an item and the equipment tree to attach." }));
    const zone = h("div.kgst-dropzone.kgst-item-drop", { tabIndex: 0, "aria-label": "Drop equipment item" });
    zone.append(h("p.kgst-hint", { text: "Drag an item here from the Items sidebar, an actor's inventory, or a compendium." }));
    if ( this.item ) zone.append(h("div.kgst-picked-item",
      h("img", { src: this.item.img, alt: "" }),
      h("div.kgst-tree-info", h("strong", { text: this.item.name }), h("span.kgst-muted", {
        text: this.item.pack ? "Compendium item: a new world copy will be created on confirmation."
          : this.item.actor?.name ?? "World item"
      })), button("clear", "Clear", { disabled: this.busy })));
    else zone.append(h("strong", { text: "Drop equipment item here" }));
    zone.addEventListener("dragover", ev => {
      ev.preventDefault(); ev.stopPropagation();
      if ( ev.dataTransfer ) ev.dataTransfer.dropEffect = "copy";
      zone.classList.add("over");
    });
    zone.addEventListener("dragleave", ev => {
      if ( !zone.contains(ev.relatedTarget) ) zone.classList.remove("over");
    });
    zone.addEventListener("drop", ev => {
      ev.preventDefault(); ev.stopPropagation(); zone.classList.remove("over");
      if ( this.busy ) return;
      const data = dragData(ev), sequence = ++this.dropSequence;
      (async () => {
        if ( data?.type !== "Item" ) throw new Error("Drag an Item from the sidebar, actor inventory, or a compendium.");
        const item = await Item.implementation.fromDropData(data);
        if ( sequence !== this.dropSequence ) return;
        if ( item?.documentName !== "Item" || !physicalTypes.has(item.type) ) throw new Error("Choose a physical equipment item.");
        if ( item.uuid !== this.item?.uuid || item !== this.item && !item.uuid ) this.instanceName = item.name;
        this.item = item;
        await this.render();
      })().catch(err => ui.notifications.error(err.message));
    });
    root.append(zone);
    if ( !this.recovering && this.item ) {
      const name = h("input", { type: "text", name: "instanceName", value: this.instanceName, required: true, disabled: this.busy });
      name.addEventListener("input", () => {
        this.instanceName = name.value;
        const error = this.validation();
        root.querySelector('[role="status"]').textContent = error || `${equipmentTypeLabel(this.selectedTree().equipmentType)} item ready.`;
        root.querySelector('[data-equipment-action="confirm"]').disabled = this.busy || !!error;
      });
      root.append(h("label.kgst-picker-choice", "Item name", name), h("p.kgst-hint.kgst-instance-name-hint", {
        text: this.item.pack ? "The new physical copy in the Items sidebar will use this name."
          : "This physical item will use this name when the tree is attached."
      }));
    }
    const choices = this.recovering ? this.records : this.trees;
    const select = h("select", { name: this.recovering ? "ledger" : "treeId", disabled: this.busy }, choices.map(c =>
      h("option", { value: c.id, selected: c.id === this.choiceId,
        text: this.recovering ? c.name : `${c.name} (${equipmentTypeLabel(c.equipmentType)})` })));
    select.addEventListener("change", () => { this.choiceId = select.value; this.render(); });
    root.append(h("label.kgst-picker-choice", this.recovering ? "Saved record" : "Tree", select));
    const error = this.validation();
    root.append(h("p.kgst-hint", { role: "status", text: error || `${equipmentTypeLabel(this.selectedTree().equipmentType)} item ready.` }),
      h("div.kgst-form-actions", button("cancel", "Cancel", { disabled: this.busy }),
        button("confirm", this.busy ? "Saving..." : this.recovering ? "Recover" : "Attach", { disabled: this.busy || !!error })));
    root.addEventListener("click", ev => {
      const action = ev.target.closest("[data-equipment-action]")?.dataset.equipmentAction;
      if ( !action || this.busy ) return;
      if ( action === "clear" ) { this.dropSequence++; this.item = null; this.instanceName = ""; this.render(); }
      if ( action === "cancel" ) this.close();
      if ( action === "confirm" ) this.submit().catch(err => ui.notifications.error(err.message));
    });
    return root;
  }

  async submit() {
    const error = this.validation();
    if ( error ) throw new Error(error);
    this.busy = true;
    this.dropSequence++;
    try {
      await this.render();
      if ( this.item.pack ) {
        const data = this.item.toObject();
        if ( !this.recovering ) data.name = this.instanceName.trim();
        delete data._id;
        delete data.folder;
        // A copied source starts a fresh identity, never the pack's saved ledger identity.
        if ( data.flags?.[MODULE_ID] ) delete data.flags[MODULE_ID].equipment;
        const item = await Item.implementation.create(data);
        if ( !item ) throw new Error("World item creation was cancelled.");
        this.item = item;
      }
      const payload = { itemUuid: this.item.uuid };
      if ( this.recovering ) payload.ledgerUuid = this.records.find(j => j.id === this.choiceId).uuid;
      else { payload.treeId = this.choiceId; payload.name = this.instanceName.trim(); }
      const result = await equipmentRequest(this.recovering ? "recover" : "attach", payload);
      if ( result?.ok === false ) throw new Error(result.reason ?? "Equipment request was rejected.");
      if ( this.recovering ) ui.notifications.info("Equipment identity and saved bonds restored.");
      this.resolveResult(this.item);
      await this.close();
    } finally {
      this.busy = false;
      if ( this.rendered ) await this.render();
    }
  }
}

export async function attachEquipmentDialog(item = null) {
  if ( !game.user.isGM ) return;
  const trees = allTrees().filter(isEquipmentTree);
  if ( !trees.length ) return ui.notifications.info("Create an equipment tree before attaching a tree.");
  const picker = new EquipmentPicker({ item, trees });
  await picker.render({ force: true });
  return picker.result;
}

export async function recoverEquipmentDialog() {
  if ( !game.user.isGM ) return;
  const records = [];
  for ( const journal of game.journal ) {
    const meta = journal.getFlag(MODULE_ID, "equipmentLedger");
    if ( meta && !await fromUuid(meta.itemUuid) ) records.push(journal);
  }
  if ( !records.length ) return ui.notifications.info("No missing physical item records to recover.");
  const picker = new EquipmentPicker({ records, window: { title: "Recover Equipment Identity" } });
  await picker.render({ force: true });
  return picker.result;
}

function ownedList(records) {
  return Array.isArray(records) ? records : [];
}

/** Shared by the actor tab and the item window. All mutations go through equipmentRequest. */
export class EquipmentPanel {
  constructor(root, { actor = null, item = null } = {}) {
    this.root = root;
    this.actor = actor ?? item?.actor ?? null;
    this.fixedItem = item;
    this.itemUuid = item?.uuid ?? null;
    this.nodeId = null;
    this.cameras = new Map();
    this.generation = 0;
    this.root.classList.add("kgst-equipment");
    root.addEventListener("click", ev => {
      if ( !ev.target.closest("[data-equipment-action]") ) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.onClick(ev).catch(err => ui.notifications.error(err.message));
    });
    root.addEventListener("change", ev => {
      if ( ev.target.name !== "equipmentItem" ) return;
      this.itemUuid = ev.target.value;
      this.nodeId = null;
      this.render();
    });
    this.hooks = [`${MODULE_ID}.equipmentChanged`, "updateItem", "deleteItem", "createItem", "updateActor"]
      .map(name => [name, Hooks.on(name, doc => {
        if ( doc?.documentName === "Actor" && doc.uuid !== this.actor?.uuid ) return;
        if ( doc?.documentName === "Item" && (this.fixedItem ? doc.uuid !== this.fixedItem.uuid : doc.actor?.uuid !== this.actor?.uuid) ) return;
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          if ( root.isConnected ) { this.mounted = true; this.render(); }
          else if ( this.mounted ) this.destroy();
        }, 75);
      })]);
    for ( const name of ["closeApplication", "closeApplicationV2"] ) {
      this.hooks.push([name, Hooks.on(name, app => {
        const element = app.element instanceof HTMLElement ? app.element : app.element?.[0];
        if ( element?.contains?.(root) ) this.destroy();
      })]);
    }
  }

  destroy() {
    this.generation++;
    clearTimeout(this.refreshTimer);
    this.view?.destroy();
    for ( const [name, id] of this.hooks ) Hooks.off(name, id);
    this.hooks = [];
  }

  async render() {
    if ( this.root.isConnected ) this.mounted = true;
    const generation = ++this.generation;
    this.view?.destroy();
    this.view = null;
    try {
      const items = this.fixedItem ? [this.fixedItem] : equipmentItems(this.actor);
      this.item = items.find(i => i.uuid === this.itemUuid) ?? items[0] ?? null;
      this.itemUuid = this.item?.uuid ?? null;
      if ( !this.item ) {
        this.root.replaceChildren(h("p.kgst-empty", { text: "This actor has no equipment skill trees." }),
          game.user.isGM ? button("attach", "Attach an equipment tree") : null);
        return;
      }
      const data = await equipmentView(this.item, this.actor) ?? { tree: null, active: false };
      if ( generation !== this.generation ) return;
      this.data = data;
      const { tree, state, summary, active, reason } = data;
      const location = this.item.actor ? `Inventory: ${this.item.actor.name}`
        : this.item.pack ? "Compendium item"
          : `Items sidebar${this.item.folder?.name ? `: ${this.item.folder.name}` : " (no folder)"}`;
      const header = h("div.kgst-head",
        h("div.kgst-equipment-identity", this.fixedItem ? h("h3.kgst-title", { text: this.item.name }) : h("label.kgst-equipment-picker", "Equipment ",
          h("select", { name: "equipmentItem", "aria-label": "Equipment item" }, items.map(i =>
            h("option", { value: i.uuid, selected: i.uuid === this.itemUuid, text: i.name })))),
          h("p.kgst-equipment-location", { text: location })),
        h("div.kgst-detail-meta",
          h("span.kgst-pill", { text: this.item.system?.equipped ? "Equipped" : "Unequipped" }),
          h("span.kgst-pill", { text: this.item.system?.attuned || this.item.system?.attunement === 2 ? "Attuned" : "Not attuned" }),
          h("span.kgst-pill", { text: active ? "Bonuses active" : "Bonuses inactive" })),
        h("div.kgst-head-actions", button("open-item", "Open Item"),
          game.user.isGM ? [tree ? [this.actor ? button("award", "Award points") : null, button("transfer", "Transfer")] : null,
            tree ? button("detach", "Detach") : [button("attach", "Attach tree"),button("new-design", "Create tree")]] : null));
      const body = h("div.kgst-panel", header);
      if ( reason ) body.append(h("p.kgst-hint", { text: reason }));
      const attunement = this.item.system?.attunement;
      const permitsAttunement = attunement === "required" || attunement === "optional" || attunement === 1 || attunement === 2;
      if ( tree && tree.activation?.attuned !== false && !permitsAttunement ) {
        body.append(h("p.kgst-hint.kgst-equipment-attunement-hint", {
          text: "This tree requires attunement, but this item does not permit it. Configure the item as magical and its Attunement as Required in the item sheet."
        }));
      }
      if ( !tree ) {
        body.append(h("p.kgst-empty", { text: "No equipment tree is attached." }));
        this.root.replaceChildren(body);
        return;
      }
      body.append(h("div.kgst-head", h("h3.kgst-title", { text: tree.name }),
        h("span.kgst-points", { text: `${summary?.available ?? 0} ${tree.currency.abbr} available (${summary?.earned ?? 0} earned, ${summary?.spent ?? 0} spent)` })));
      this.status = id => nodeStatus(this.actor, tree, state, id, summary, data.selection);
      this.view = new TreeView({ tree, mode: "play", status: this.status, showHidden: game.user.isGM });
      this.view.on("nodeclick", id => this.select(id).catch(err => ui.notifications.error(err.message)));
      this.view.on("backgroundclick", () => this.select(null));
      this.view.on("camera", cam => { if ( cam ) this.cameras.set(this.itemUuid, cam); else this.cameras.delete(this.itemUuid); });
      body.append(h("div.kgst-frame", { style: { "--kgst-frame-aspect": `${tree.background.width} / ${tree.background.height}` } }, this.view.element,
        h("div.kgst-zoombar", button("zoom-in", "+", { "aria-label": "Zoom in" }), button("zoom-out", "-", { "aria-label": "Zoom out" }), button("zoom-fit", "Fit"))), legendElement());
      this.detail = h("div.kgst-detail");
      body.append(this.detail);
      if ( game.user.isGM ) body.append(this.savedProgress());
      this.root.replaceChildren(body);
      const camera = this.cameras.get(this.itemUuid);
      if ( camera ) this.view.restoreCamera(camera);
      else this.view.layout();
      await this.select(tree.nodes[this.nodeId] ? this.nodeId : null);
    } catch(err) {
      if ( generation !== this.generation ) return;
      this.root.replaceChildren(h("p.kgst-empty", { text: `Equipment tree could not be loaded: ${err.message}` }), button("reload", "Retry"));
    }
  }

  async select(id) {
    this.nodeId = id;
    this.view?.setSelection(id ? [id] : []);
    const detail = this.detail;
    const node = this.data?.tree?.nodes[id];
    if ( !node ) {
      detail?.replaceChildren(h("p.kgst-hint", { text: "Select a node to see its equipment bonuses, spell grants, and requirements." }));
      return;
    }
    const { tree, permanent } = this.data;
    const st = this.status(id);
    const isPermanent = node.ownership === "permanent" || ownedList(permanent).some(o => (typeof o === "string" ? o : o.id) === id);
    const generation = this.generation;
    const enrich = async html => {
      if ( !/<\w/.test(html) ) html = `<p>${esc(html).replace(/\n/g, "<br>")}</p>`;
      return TextEditorImpl().enrichHTML(safeHTML(html), {
        secrets: game.user.isGM, relativeTo: this.actor ?? this.item, rollData: this.actor?.getRollData?.()
      });
    };
    const grants = await Promise.all((node.grants ?? []).map(async (grant, index) => {
      let data = null;
      try { if ( grant.kind !== "summon" ) data = await grantItemData(grant); }
      catch { /* Keep the saved grant visible when its source is unavailable. */ }
      const description = data?.system?.description?.value ?? grant.patch?.["system.description.value"] ?? "";
      const uses = grant.spellUses;
      const usable = this.actor?.items.find(i => {
        const flag = i.getFlag(MODULE_ID, 'equipmentGrant');
        return flag?.instanceId === this.item.getFlag(MODULE_ID, 'equipment')?.instanceId && flag.nodeId === id && flag.index === index;
      });
      return h("li.kgst-equipment-grant",
        h("div.kgst-picked-item", (grant.patch?.img || data?.img || grant.img)
          ? h("img", { src: grant.patch?.img || data?.img || grant.img, alt: "" }) : null,
        h("strong", { text: `${grant.kind === "summon" ? "Summon: " : ""}${grantName(grant) || data?.name || "Granted item"}` }),
        usable && data?.type === 'spell' ? button('cast-grant', 'Cast', {dataset:{equipmentAction:'cast-grant',grantItemId:usable.id}}) : null),
        h("span.kgst-muted", { text: [data?.type ?? grant.type,
          uses?.enabled ? `${uses.max} uses, recovers on ${{ lr: "long rest", sr: "short rest", day: "a new day" }[uses.recovery] ?? "long rest"}` : null,
          !data && grant.kind !== "summon" ? "Source unavailable" : null].filter(Boolean).join(". ") }),
        description ? h("div.kgst-grant-description", { html: await enrich(description) }) : null);
    }));
    let description = node.description || "";
    if ( !/<\w/.test(description) ) description = `<p>${esc(description).replace(/\n/g, "<br>")}</p>`;
    description = await TextEditorImpl().enrichHTML(safeHTML(description), {
      secrets: game.user.isGM, relativeTo: this.actor ?? this.item, rollData: this.actor?.getRollData?.()
    });
    if ( generation !== this.generation || this.nodeId !== id ) return;
    const canUse = this.actor && (game.user.isGM || this.item.isOwner);
    const bonuses = node.enhancements ?? [];
    detail.replaceChildren(h("div.kgst-detail-card",
      h("div.kgst-detail-head", h("img.kgst-detail-icon", { src: nodeIcon(node, tree), alt: "" }),
        h("div", h("h4", { text: node.name }), h("div.kgst-detail-meta",
          h("span.kgst-pill", { text: st.owned ? "Unlocked" : st.available ? "Available" : "Locked" }),
          h("span.kgst-pill", { text: isPermanent ? "Permanent upgrade" : "Personal unlock" }),
          h("span.kgst-pill", { text: `${node.cost} ${tree.currency.abbr}` }))),
        h("div.kgst-detail-actions", !st.owned ? button("buy", "Unlock", { disabled: !canUse || !st.available }) : null,
          !st.owned && game.user.isGM ? button('gm-grant', 'GM: grant', {disabled:!this.actor}) : null,
          canUse && st.owned && (!isPermanent || game.user.isGM) ? button("refund", "Refund") : null)),
      h(`div.kgst-detail-body${node.description?.trim() ? '' : '.kgst-no-description'}`, node.description?.trim() ? h("div.kgst-detail-desc", { html: description }) : null,
        h("div.kgst-detail-side", h("h5", { text: "Bonuses" }),
          h("p.kgst-hint", { text: "Item bonuses apply to this equipment. Wielder bonuses apply to its current actor while active." }),
          bonuses.length ? h("ul.kgst-equipment-bonuses", bonuses.map(b => h("li", {
            text: enhancementDescription(b)
          }))) : h("p.kgst-muted", { text: "No bonuses." }),
          bonuses.length ? h("p.kgst-hint", { text: "Cumulative bonuses stack. An upgrade replaces earlier bonuses to the same rolls, even if smaller. Named enchantments are tracked separately." }) : null,
          grants.length ? [h("h5", { text: "Grants" }),
            h("p.kgst-hint", { text: "Granted spells and items are available to the wielder while this equipment is active." }),
            h("ul.kgst-equipment-grants", grants)] : null,
          h("h5", { text: "Requires" }), h("div", { html: reqsHTML(st.reqs) })))));
  }

  savedProgress() {
    const { ledger, tree } = this.data;
    const permanent = ownedList(ledger?.flags?.[MODULE_ID]?.equipmentLedger?.permanent);
    const bonds = [...(ledger?.pages ?? [])].map(page => page.flags?.[MODULE_ID]?.equipmentBond).filter(Boolean);
    return h("details.kgst-equipment-progress", h("summary", { text: "Saved progress (GM)" }),
      h("p", { text: `Permanent: ${permanent.map(o => tree.nodes[typeof o === "string" ? o : o.id]?.name ?? o.id ?? o).join(", ") || "None"}` }),
      bonds.length ? bonds.map(bond => h("div.kgst-equipment-bond",
        h("strong", { text: game.actors.find(a => a.uuid === bond.actorUuid)?.name ?? bond.actorUuid }),
        h("p", { text: `Personal nodes: ${ownedList(bond.owned).map(o => tree.nodes[o.id]?.name ?? o.id).join(", ") || "None"}. Point adjustment: ${bond.adjust ?? 0}.` }),
        h("details", h("summary", { text: "Baseline and history" }),
          h("pre", { text: JSON.stringify(bond.baseline ?? {}, null, 2) }),
          h("ul", (bond.log ?? []).slice().reverse().map(entry => h("li", {
            text: [formatDate(entry.at), entry.text ?? entry.type ?? "", tree.nodes[entry.node ?? entry.nodeId]?.name,
              entry.amount != null ? `${entry.amount} points` : null].filter(x => x != null && x !== "").join(" ")
          }))))))
        : h("p.kgst-muted", { text: "No saved actor bonds." }));
  }

  async onClick(ev) {
    const action = ev.target.closest("[data-equipment-action]")?.dataset.equipmentAction;
    if ( this.busy ) return;
    if ( action === 'cast-grant' ) {
      const spell = this.actor?.items.get(ev.target.closest('[data-grant-item-id]')?.dataset.grantItemId);
      if (spell?.isOwner) return spell.use();
      return;
    }
    if ( action === "open-item" ) return this.item?.sheet?.render(true);
    if ( action === "reload" ) return this.render();
    if ( action === "zoom-in" ) return this.view?.zoomBy(1.25);
    if ( action === "zoom-out" ) return this.view?.zoomBy(0.8);
    if ( action === "zoom-fit" ) return this.view?.fit();
    if ( ["attach", "award", "transfer", "detach", "new-design", "gm-grant"].includes(action) && !game.user.isGM ) return;
    this.busy = true;
    try {
      if(action==='new-design'){
        const draft=defaultTree(`${this.item.name} Tree`);draft.kind='equipment';draft.rules=[];draft.equipmentType=itemEquipmentType(this.item);
        draft.baseItem={uuid:this.item.uuid,name:this.item.name,img:this.item.img,type:this.item.type};draft.img=this.item.img;
        const tree=await saveTree(draft);
        if(!this.item.pack)await equipmentRequest('attach',{itemUuid:this.item.uuid,treeId:tree.id});
        const {TreeDesigner}=await import('./designer.mjs');TreeDesigner.open(tree.id);return this.render();
      }
      if ( action === "attach" ) {
        await attachEquipmentDialog(this.item);
        return await this.render();
      }
      const payload = { itemUuid: this.item?.uuid, nodeId: this.nodeId, requestId: foundry.utils.randomID() };
      if(action==='gm-grant'){
        const node=this.data?.tree?.nodes[this.nodeId];if(!node||!this.actor)return;
        const choice=await promptGmGrant(this.actor,this.data.tree,node,this.status(node.id),{equipment:this.item});
        if(!choice)return;Object.assign(payload,choice);
        await equipmentRequest('grant',payload);return await this.render();
      }
      if ( action === "award" ) {
        const amount = await DialogV2.wait({
          window: { title: `Award points: ${this.item.name}` }, classes: ["kgst-dialog"],
          content: '<div class="form-group"><label>Points to award (negative to remove)</label><input name="amount" type="number" value="1" step="1" required></div>',
          buttons: [{ action: "award", label: "Apply", default: true, callback: (e, b) => b.form.elements.amount.value }, { action: "cancel", label: "Cancel" }], rejectClose: false
        });
        if ( typeof amount !== "string" || !amount.trim() || !Number.isSafeInteger(Number(amount)) || Number(amount) === 0 ) return;
        payload.amount = Number(amount);
      }
      if ( action === "transfer" ) {
        const actors = game.actors.filter(a => !a.isToken && a.uuid !== this.actor?.uuid);
        if ( !actors.length ) return ui.notifications.info("There are no other destination actors.");
        const target = await DialogV2.wait({
          window: { title: `Transfer ${this.item.name}` }, classes: ["kgst-dialog"],
          content: `<p>Choose the actor who will receive this equipment. Personal progress stays with each actor's saved bond.</p><label>Destination actor<select name="target">${actors.map(a => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("")}</select></label>`,
          buttons: [{ action: "transfer", label: "Transfer", callback: (e, b) => b.form.elements.target.value }, { action: "cancel", label: "Cancel" }], rejectClose: false
        });
        if ( !actors.some(a => a.uuid === target) ) return;
        payload.targetActorUuid = target;
      }
      if ( action === "detach" && !await confirm("Detach Equipment Tree", `<p>Detach the tree from ${esc(this.item.name)}?</p>`, { yes: "Detach", danger: true }) ) return;
      if ( ["buy", "refund"].includes(action) ) {
        const node = this.data?.tree?.nodes[this.nodeId];
        if ( !node ) return;
        if ( action === "buy" && this.data.tree.confirmPurchase && !await confirm(`Unlock ${node.name}`, `<p>Spend ${node.cost} ${esc(this.data.tree.currency.abbr)} to unlock ${esc(node.name)}?</p>`, { yes: "Unlock" }) ) return;
        if ( action === "refund" && !await confirm(`Refund ${node.name}`, "<p>Refund this node? Dependent unlocks may also be refunded.</p>", { yes: "Refund" }) ) return;
      }
      if ( !["buy", "refund", "award", "transfer", "detach"].includes(action) ) return;
      const result = await equipmentRequest(action, payload);
      if ( result?.ok === false ) throw new Error(result.reason ?? "Equipment request was rejected.");
      if ( action === "transfer" && this.fixedItem ) {
        const transferred = [...(game.actors ?? [])].flatMap(a => [...a.items]).find(i => i.uuid === result?.itemUuid);
        if ( transferred ) openEquipmentItem(transferred);
        await this.onTransferred?.();
      }
      else await this.render();
    } finally { this.busy = false; }
  }
}

class EquipmentItemApp extends DomApp {
  static DEFAULT_OPTIONS = {
    classes: ["kgst-app", "kgst-equipment-app"], position: { width: 960, height: 780 },
    window: { title: "Equipment Skill Tree", resizable: true, icon: "fa-solid fa-diagram-project" }
  };

  constructor(options) {
    super(options);
    this.item = options.item;
  }

  get title() { return `Equipment Skill Tree: ${this.item.name}`; }

  async build() {
    this.panel?.destroy();
    const root = h("div.kgst-root.kgst-sized");
    this.panel = new EquipmentPanel(root, { item: this.item });
    this.panel.onTransferred = () => this.close();
    await this.panel.render();
    return root;
  }

  async close(options) {
    this.panel?.destroy();
    return super.close(options);
  }
}

export function openEquipmentItem(item) {
  if ( !item || (!item.actor && !game.user.isGM) || (!game.user.isGM && !item.isOwner) ) return;
  const id = `kgst-equipment-${item.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  return existing ? existing.render({ force: true }) : new EquipmentItemApp({ id, item }).render({ force: true });
}
