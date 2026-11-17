import { MODULE_ID, esc } from "./util.mjs";

function sourceSetting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; }
  catch { return fallback; }
}

function writablePack(pack, type) {
  return !!pack && pack.documentName === type && !pack.locked
    && (game.user.isGM || pack.testUserPermission?.(game.user, "OWNER"));
}

async function originalSource(doc) {
  const candidates = [doc._stats?.compendiumSource, doc.getFlag?.("core", "sourceId"), doc.getFlag?.("dnd5e", "sourceId")];
  for ( const uuid of candidates ) {
    if ( typeof uuid !== "string" || !uuid.startsWith("Compendium.") ) continue;
    const original = await fromUuid(uuid).catch(() => null);
    if ( original?.documentName === doc.documentName ) return original;
  }
  return null;
}

let creatingPack;
async function saveSource(doc) {
  const packs = [...game.packs.values()].filter(p => writablePack(p, doc.documentName));
  const configured = sourceSetting("sourcePack", "");
  const defaultName = doc.documentName === "Item" ? "skill-tree-sources" : "skill-tree-sources-actors";
  const defaultId = `world.${defaultName}`;
  const preferred = packs.find(p => p.collection === configured) ?? packs.find(p => p.collection === defaultId);
  const createOption = game.user.isGM ? `<option value=""${preferred ? "" : " selected"}>Create or use world Skill Tree Sources</option>` : "";
  if ( !packs.length && !createOption ) throw new Error("A GM must provide a writable source compendium first.");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: "Save Edited Source", icon: "fa-solid fa-book" },
    classes: ["kgst-dialog"],
    content: `<p>Save a copy of <strong>${esc(doc.name)}</strong>. The original document is kept.</p>
      <div class="form-group"><label>Source compendium</label><div class="form-fields"><select name="pack">
      ${packs.map(p => `<option value="${esc(p.collection)}"${p.collection === preferred?.collection ? " selected" : ""}>${esc(p.metadata.label)} (${esc(p.collection)})</option>`).join("")}
      ${createOption}</select></div></div>`,
    buttons: [
      { action: "save", label: "Save Copy", default: true, callback: (event, button) => ({ pack: button.form.elements.pack.value }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });
  if ( !result || typeof result !== "object" ) return null;
  let pack = game.packs.get(result.pack);
  if ( !result.pack ) {
    pack = game.packs.get(defaultId);
    if ( !pack ) {
      // Serialize creation so simultaneous drops cannot create duplicate default packs.
      if ( creatingPack ) await creatingPack;
      pack = game.packs.get(defaultId);
      if ( !pack ) {
        creatingPack = foundry.documents.collections.CompendiumCollection.createCompendium({
          name: defaultName, label: doc.documentName === "Item" ? "Skill Tree Sources" : "Skill Tree Actor Sources",
          type: doc.documentName, package: "world"
        });
        try { pack = await creatingPack; }
        finally { creatingPack = null; }
      }
    }
  }
  if ( !writablePack(pack, doc.documentName) ) throw new Error("Choose an unlocked compendium of the matching document type.");
  const data = doc.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  // A reusable source must not inherit a physical item's ledger identity.
  if ( data.flags?.[MODULE_ID] ) delete data.flags[MODULE_ID].equipment;
  for ( const item of data.items ?? [] ) {
    if ( item.flags?.[MODULE_ID] ) delete item.flags[MODULE_ID].equipment;
  }
  return doc.constructor.create(data, { pack: pack.collection });
}

/** Resolve a stable grant source, returning a Document or null on cancellation/failure. Never deletes the input. */
export async function resolveSource(doc) {
  try {
    if ( !doc || !["Item", "Actor"].includes(doc.documentName) ) return null;
    if ( doc.pack || doc.uuid?.startsWith("Compendium.") ) return doc;
    const original = await originalSource(doc);
    const embedded = !!doc.parent || !!doc.isToken;
    const keepWorld = !embedded && !sourceSetting("strictSources", false);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Choose Grant Source", icon: "fa-solid fa-book" },
      classes: ["kgst-dialog"],
      content: `<p>Choose the source for <strong>${esc(doc.name)}</strong>.</p>
        <p class="hint">Use original follows the compendium version. Save edited copies the current document to a world compendium.
        ${keepWorld ? "Keep world uses this world document directly." : "Embedded items and strict sources require a compendium source."}</p>`,
      buttons: [
        ...(original ? [{ action: "original", label: "Use Original", default: true }] : []),
        { action: "save", label: "Save Edited", default: !original },
        ...(keepWorld ? [{ action: "world", label: "Keep World" }] : []),
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    if ( choice === "original" ) return original;
    if ( choice === "save" ) return await saveSource(doc);
    if ( choice === "world" && keepWorld ) return doc;
    return null;
  } catch(err) {
    ui.notifications.error(`Could not resolve grant source: ${err.message}`);
    return null;
  }
}
