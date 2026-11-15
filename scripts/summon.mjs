/*
 * Actor grants. Dropping an actor on the designer makes a node that grants a feature with one Summon activity for
 * that actor. The feature is built when the node is bought, so it always points at the actor as it is then.
 *
 * Summoning itself is dnd5e's: the "Allow Summoning" world setting must be on, and players need permission to
 * create tokens, for the activity to place the creature.
 */

import { esc } from "./util.mjs";

export function buildSummonItem(grant, node, tree) {
  const activityId = foundry.utils.randomID();
  const profileId = foundry.utils.randomID();
  const name = node.grants.length > 1 ? `Summon ${grant.name}` : (node.name || `Summon ${grant.name}`);
  const intro = node.description ? `<p>${esc(node.description).replace(/\n/g, "<br>")}</p>` : "";
  return {
    name,
    type: "feat",
    img: grant.img || node.img || "icons/svg/mystery-man.svg",
    system: {
      description: {
        value: `${intro}<p>Summons @UUID[${grant.uuid}]{${esc(grant.name || "a creature")}}.</p>`
          + `<p><em>Granted by the ${esc(tree.name)} skill tree.</em></p>`
      },
      activities: {
        [activityId]: {
          _id: activityId,
          type: "summon",
          name: "",
          activation: { type: "action", value: 1 },
          profiles: [{
            _id: profileId,
            count: String(grant.count || "1"),
            name: grant.name || "",
            uuid: grant.uuid
          }],
          summon: { mode: "", prompt: true }
        }
      }
    }
  };
}

/** A grant entry for an actor dropped on the designer. */
export function summonGrant(actor) {
  return {
    kind: "summon",
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img || actor.prototypeToken?.texture?.src || "",
    type: actor.type,
    count: "1"
  };
}

export function summoningEnabled() {
  try {
    return !!game.settings.get("dnd5e", "allowSummoning");
  } catch(err) {
    return true;
  }
}

export const SUMMON_HINT = "Summons use dnd5e's Summon activity. The world setting \"Allow Summoning\" must be on, and "
  + "players need the \"Create New Tokens\" permission to place them.";
