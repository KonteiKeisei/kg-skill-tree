import { DomApp } from "./base.mjs";
import { SkillTreePanel } from "../panel.mjs";
import { h } from "../util.mjs";

/** The Skill Tree panel in its own, larger window. */
export class SkillTreeViewer extends DomApp {
  static DEFAULT_OPTIONS = {
    classes: ["kgst-app", "kgst-viewer"],
    position: { width: 1000, height: 760 },
    window: { resizable: true, icon: "fa-solid fa-diagram-project" }
  };

  static open(actor) {
    const id = `kgst-viewer-${actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if ( existing ) return existing.render({ force: true });
    return new this({ id, actor }).render({ force: true });
  }

  constructor(options) {
    super(options);
    this.actor = options.actor;
  }

  get title() {
    return `Skill Tree: ${this.actor.name}`;
  }

  async build() {
    const root = h("div.kgst-root");
    this.panel = new SkillTreePanel(root, this.actor, { big: true });
    return root;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.panel?.render();
  }
}

/** Re-render open viewers, for one actor or all. */
export function refreshViewers(actor = null) {
  for ( const app of foundry.applications.instances.values() ) {
    if ( !(app instanceof SkillTreeViewer) ) continue;
    if ( actor && (app.actor !== actor) ) continue;
    app.panel?.render();
  }
}
