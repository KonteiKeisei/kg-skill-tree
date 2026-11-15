/*
 * The Skill Tree tab on dnd5e's character sheet and on Tidy 5e. Both host a SkillTreePanel; the panel draws itself
 * when the tab is first shown, so a closed tab costs nothing on a sheet re-render.
 */

import { TAB_ID, TEMPLATES, isCharacter, warn } from "./util.mjs";
import { SkillTreePanel, canSeeTab } from "./panel.mjs";

const observers = new Map();

function mount(root, actor, sheetId) {
  const panel = new SkillTreePanel(root, actor);
  const slot = sheetId ?? actor.uuid;
  observers.get(slot)?.disconnect();
  observers.delete(slot);
  if ( root.offsetParent !== null ) return panel.render();
  const obs = new IntersectionObserver(entries => {
    if ( !entries.some(e => e.isIntersecting) ) return;
    obs.disconnect();
    if ( observers.get(slot) === obs ) observers.delete(slot);
    panel.render();
  });
  obs.observe(root);
  observers.set(slot, obs);
}

/* -------------------------------------------- */
/*  Default dnd5e sheet                         */
/* -------------------------------------------- */

export function patchCoreSheet() {
  const cls = globalThis.dnd5e?.applications?.actor?.CharacterActorSheet;
  if ( !cls?.TABS || !cls?.PARTS ) {
    warn("dnd5e CharacterActorSheet not found; the Skill Tree tab is only available on Tidy 5e.");
    return false;
  }
  if ( cls.TABS.some(t => t.tab === TAB_ID) ) return true;
  const tab = { tab: TAB_ID, label: "Skill Tree", icon: "fa-solid fa-diagram-project", condition: actor => canSeeTab(actor) };
  const at = cls.TABS.findIndex(t => t.tab === "specialTraits");
  if ( at >= 0 ) cls.TABS.splice(at, 0, tab);
  else cls.TABS.push(tab);
  cls.PARTS[TAB_ID] = {
    container: { classes: ["tab-body"], id: "tabs" },
    template: `${TEMPLATES}/tab-part.hbs`,
    scrollable: [""]
  };
  return true;
}

function onRenderSheet(app, element) {
  const el = element instanceof HTMLElement ? element : element?.[0];
  if ( !el || el.classList.contains("tidy5e-sheet") ) return;
  const actor = app.actor ?? app.document;
  if ( !isCharacter(actor) ) return;
  const root = el.querySelector(`[data-application-part="${TAB_ID}"] .kgst-root`)
    ?? el.querySelector(`.tab[data-tab="${TAB_ID}"] .kgst-root`);
  if ( root ) mount(root, actor, app.id);
}

/* -------------------------------------------- */
/*  Tidy 5e                                     */
/* -------------------------------------------- */

export function registerTidy() {
  Hooks.once("tidy5e-sheet.ready", api => {
    try {
      api.registerCharacterTab(new api.models.HtmlTab({
        title: "Skill Tree",
        tabId: TAB_ID,
        iconClass: "fa-solid fa-diagram-project",
        html: "<div class=\"kgst-root kgst-tidy\"></div>",
        enabled: context => canSeeTab(context?.actor ?? context?.document),
        onRender: params => {
          const actor = params.app?.actor ?? params.app?.document ?? params.data?.actor;
          if ( !isCharacter(actor) ) return;
          const root = params.tabContentsElement?.querySelector?.(".kgst-root")
            ?? params.element?.querySelector?.(".kgst-root.kgst-tidy");
          if ( root ) mount(root, actor, params.app?.id);
        }
      }), { layout: "all" });
    } catch(err) {
      console.error("kg-skill-tree | Could not register the Tidy 5e tab", err);
    }
  });
}

export function registerSheetHooks() {
  Hooks.on("renderCharacterActorSheet", onRenderSheet);
  Hooks.on("closeActorSheetV2", app => {
    observers.get(app.id)?.disconnect();
    observers.delete(app.id);
  });
}
