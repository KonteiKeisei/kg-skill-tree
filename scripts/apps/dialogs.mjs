import { esc, isCharacter, plural } from "../util.mjs";
import { EVENTS } from "../events.mjs";
import { adjustPoints, lockTree, retroactivePoints, treeState, unlockTree } from "../progress.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Unlock a tree for some characters. Characters getting it for the first time need a decision on where their points
 * start; the GM is asked once for all of them.
 * @returns {Promise<boolean>} Whether anything was unlocked.
 */
export async function unlockFor(actors, tree) {
  actors = actors.filter(isCharacter);
  if ( !actors.length ) return false;
  const fresh = actors.filter(a => !treeState(a, tree.id)?.since);
  const again = actors.filter(a => !fresh.includes(a));
  let choice = { retroactive: false, bonus: 0 };
  if ( fresh.length ) {
    choice = await askStart(fresh, tree);
    if ( !choice ) return false;
  }
  for ( const a of fresh ) await unlockTree(a, tree, choice);
  for ( const a of again ) await unlockTree(a, tree);
  ui.notifications.info(`${tree.name} unlocked for ${actors.map(a => a.name).join(", ")}.`);
  return true;
}

export async function lockFor(actors, tree) {
  for ( const a of actors ) await lockTree(a, tree);
}

async function askStart(actors, tree) {
  const abbr = tree.currency.abbr;
  const rows = actors.map(a => {
    const pts = retroactivePoints(a, tree);
    return `<tr><td><img src="${esc(a.img)}" alt=""> ${esc(a.name)}</td><td class="num">${pts} ${esc(abbr)}</td></tr>`;
  }).join("");
  const counters = tree.rules.filter(r => EVENTS[r.event]?.kind === "counter").length;
  const content = `
    <p>Should ${actors.length === 1 ? esc(actors[0].name) : "these characters"} get the ${esc(tree.currency.name)}
    they would have earned so far under this tree's rules, or start counting from now?</p>
    <table class="kgst-table"><thead><tr><th>Character</th><th class="num">Earned so far</th></tr></thead><tbody>${rows}</tbody></table>
    ${counters ? "<p class=\"hint\">Event rules (crits, rests, combats and so on) count what the module has recorded on "
      + "each character, which starts when the module was installed.</p>" : ""}
    <div class="kgst-choice">
      <label><input type="radio" name="start" value="retro" checked>
        <span><strong>Award points earned so far</strong><br><span class="hint">The amounts above are added right away.</span></span></label>
      <label><input type="radio" name="start" value="now">
        <span><strong>Start from now</strong><br><span class="hint">Points only come from levels and events after today.</span></span></label>
    </div>
    <div class="form-group"><label>Bonus starting ${esc(abbr)}</label>
      <div class="form-fields"><input type="number" name="bonus" value="0" step="1"></div></div>`;
  const result = await DialogV2.wait({
    window: { title: `Unlock ${tree.name}`, icon: "fa-solid fa-lock-open" },
    classes: ["kgst-dialog"],
    position: { width: 460 },
    content,
    buttons: [
      {
        action: "unlock", label: "Unlock", icon: "fa-solid fa-lock-open", default: true,
        callback: (event, button) => ({
          retroactive: button.form.elements.start.value === "retro",
          bonus: Number(button.form.elements.bonus.value) || 0
        })
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  return (result && (typeof result === "object")) ? result : null;
}

export async function promptAdjust(actor, tree) {
  const result = await DialogV2.wait({
    window: { title: `Adjust ${tree.currency.name}`, icon: "fa-solid fa-plus-minus" },
    classes: ["kgst-dialog"],
    position: { width: 380 },
    content: `<p>Give or take ${esc(tree.currency.name)} for ${esc(actor.name)} in ${esc(tree.name)}. Use a negative number to take points away.</p>
      <div class="form-group"><label>Amount</label><div class="form-fields"><input type="number" name="amount" value="1" step="1" autofocus></div></div>
      <div class="form-group"><label>Reason</label><div class="form-fields"><input type="text" name="reason" placeholder="Optional"></div></div>`,
    buttons: [
      {
        action: "ok", label: "Apply", icon: "fa-solid fa-check", default: true,
        callback: (event, button) => ({
          amount: Number(button.form.elements.amount.value) || 0,
          reason: button.form.elements.reason.value.trim()
        })
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if ( !result?.amount ) return;
  await adjustPoints(actor, tree, result.amount, result.reason);
  ui.notifications.info(`${actor.name}: ${result.amount > 0 ? "+" : ""}${plural(result.amount, tree.currency.abbr, tree.currency.abbr)}.`);
}

/**
 * GM: grant a node outside the normal rules (a story reward, something that happened at the table).
 * @returns {Promise<{free: boolean, level: number, note: string}|null>}
 */
export async function promptGmGrant(actor, tree, node, status, {equipment=null}={}) {
  const level = Number(actor.system?.details?.level) || 0;
  const unmet = (status?.reqs ?? []).filter(r => !r.ok).map(r => r.text);
  const result = await DialogV2.wait({
    window: { title: `Grant ${node.name}`, icon: "fa-solid fa-gift" },
    classes: ["kgst-dialog"],
    position: { width: 440 },
      content: `<p>Give ${esc(actor.name)} <strong>${esc(node.name)}</strong>${equipment ? ` for ${esc(equipment.name)}` : ''} outside the normal rules.</p>
      ${unmet.length ? `<p class="hint">Requirements not met, and ignored: ${unmet.map(esc).join(", ")}.</p>` : ""}
      <label class="kgst-check"><input type="checkbox" name="free" checked>
        <span>Free (spend no ${esc(tree.currency.name)}). Untick to charge its cost of ${node.cost}.</span></label>
      <div class="form-group"><label>Gained at level</label><div class="form-fields">
        <input type="number" name="level" value="${level}" min="0" step="1"></div>
          <p class="hint">${equipment ? 'Recorded with this equipment unlock in its saved progress.' : 'For something that happened earlier. KG PC History records it at this level.'}</p></div>
      <div class="form-group"><label>Note</label><div class="form-fields">
        <input type="text" name="note" placeholder="What happened (optional)"></div></div>`,
    buttons: [
      {
        action: "grant", label: "Grant", icon: "fa-solid fa-gift", default: true,
        callback: (event, button) => ({
          free: button.form.elements.free.checked,
          level: Math.max(0, Math.floor(Number(button.form.elements.level.value) || level)),
          note: button.form.elements.note.value.trim()
        })
      },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  return (result && (typeof result === "object")) ? result : null;
}

export function confirm(title, html, { yes = "Confirm", icon = "fa-solid fa-check", danger = false } = {}) {
  return DialogV2.confirm({
    window: { title, icon },
    classes: ["kgst-dialog"],
    content: html,
    yes: { label: yes, icon, class: danger ? "kgst-danger" : "" },
    no: { label: "Cancel", icon: "fa-solid fa-xmark" },
    rejectClose: false
  });
}
