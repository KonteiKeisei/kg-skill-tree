import { MODULE_ID, h, isCharacter, setting } from "./util.mjs";
import { registerSettings } from "./settings.mjs";
import { registerEventHooks, giveMilestone, setCountListener, currentStats, countUse } from "./events.mjs";
import { patchCoreSheet, registerSheetHooks, registerTidy } from "./tab.mjs";
import { allTrees, getTree, saveTree } from "./trees.mjs";
import {
  checkEarned, pointsSummary, purchaseNode, refundNode, treeState, treeUsesStats, unlockedTrees
} from "./progress.mjs";
import { TreeManager } from "./apps/manager.mjs";
import { TreeDesigner } from "./apps/designer.mjs";
import { SkillTreeViewer, refreshViewers } from "./apps/viewer.mjs";
import { unlockFor } from "./apps/dialogs.mjs";
import { registerEquipment, equipmentRequest, equipmentView, equipmentItems } from './equipment.mjs';

// Tidy fires its ready hook during its own setup; listen before anything else runs.
registerTidy();

Hooks.once("init", () => {
  registerSettings();
  registerSheetHooks();
  registerEventHooks();
  registerEquipment();
  if ( !patchCoreSheet() ) Hooks.once("setup", patchCoreSheet);
  // A counter update only needs to redraw the sheet when one of the character's trees pays out for it.
  setCountListener((actor, keys) => keys.some(k => k.startsWith("use:"))
    || unlockedTrees(actor).some(t => treeUsesStats(t, keys)));
});

Hooks.once("ready", () => {
  for ( const a of game.actors ) if ( isCharacter(a) && a.isOwner ) checkEarned(a, { quiet: true });
  game.modules.get(MODULE_ID).api = {
    trees: allTrees,
    equipment: { request: equipmentRequest, view: equipmentView, items: equipmentItems,
      open: async item => (await import('./apps/equipment.mjs')).openEquipmentItem(item) },
    getTree,
    saveTree,
    openManager: () => TreeManager.open(),
    openDesigner: treeId => TreeDesigner.open(treeId),
    openViewer: actor => SkillTreeViewer.open(actor),
    unlock: (actors, treeId) => unlockFor([actors].flat(), getTree(treeId)),
    points: (actor, treeId) => pointsSummary(actor, getTree(treeId), treeState(actor, treeId)),
    stats: actor => currentStats(actor),
    purchase: (actor, treeId, nodeId, options) => purchaseNode(actor, treeId, nodeId, options),
    refund: (actor, treeId, nodeId) => refundNode(actor, treeId, nodeId),
    giveMilestone: actors => giveMilestone([actors].flat()),
    /** Count a use of a granted feature (for features without an activity, or from a macro). */
    countUse: (actor, itemOrIds, n = 1) => countUse(actor, itemOrIds, n)
  };
});

/*
 * dnd5e's advancement save writes the clone's whole flags object with recursive: false, replacing the actor's flags.
 * A counter or purchase recorded while the advancement window was open would be lost, so the save carries the actor's
 * current skill tree flags instead of the clone's copy.
 */
Hooks.on("dnd5e.preAdvancementManagerComplete", (manager, updates) => {
  if ( !updates?.flags ) return;
  const current = manager.actor?._source?.flags?.[MODULE_ID];
  if ( current ) updates.flags[MODULE_ID] = foundry.utils.deepClone(current);
  else delete updates.flags[MODULE_ID];
});

/* Points can change with the actor's flags, level, XP, or its class items. */
function touched(actor) {
  if ( !isCharacter(actor) ) return;
  checkEarned(actor);
  refreshViewers(actor);
}
Hooks.on("updateActor", actor => touched(actor));
for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
  Hooks.on(hook, item => {
    if ( item.parent ) touched(item.parent);
  });
}

/* GM: a Skill Trees button in the Actors sidebar. */
Hooks.on("renderActorDirectory", (app, element) => {
  if ( !game.user.isGM || !setting("directoryButton") ) return;
  const el = element instanceof HTMLElement ? element : element?.[0];
  const actions = el?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".kgst-directory-btn") ) return;
  const btn = h("button.kgst-directory-btn", { type: "button" }, h("i.fa-solid.fa-diagram-project"), " Skill Trees");
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    TreeManager.open();
  });
  actions.append(btn);
});
