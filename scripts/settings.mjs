import { MODULE_ID, refreshCharacterSheets } from "./util.mjs";
import { TreeManager } from "./apps/manager.mjs";
import { refreshViewers } from "./apps/viewer.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "trees", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      refreshCharacterSheets();
      refreshViewers();
      TreeManager.refresh();
    }
  });

  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "Skill Trees",
    label: "Open Skill Trees",
    hint: "Design skill trees, set how points are earned, and unlock trees for characters.",
    icon: "fa-solid fa-diagram-project",
    type: TreeManager,
    restricted: true
  });

  game.settings.register(MODULE_ID, "trackEvents", {
    name: "Count events for points",
    hint: "Count crits, rests, skill checks, spells and other events on every character, so trees can award points "
      + "for them. Turn off if no tree uses event rules.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "notifyPoints", {
    name: "Announce earned points",
    hint: "Show a notification to a character's owner when the character earns skill tree points.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "directoryButton", {
    name: "Skill Trees button in the Actors sidebar",
    hint: "GM only: a button at the top of the Actors sidebar that opens the Skill Trees manager.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.actors?.render()
  });
}
