# Changelog

## 0.3.6

- Equipment bonuses omit empty or zero base terms instead of adding an unnecessary +0. This removes the extra zero entry shown as Unknown modifier in roll breakdowns.
- Publishes the equipment-tree enhancements developed in 0.3.0 through 0.3.5: separate equipment points, personal/permanent unlocks, transfer support, spell grants, GM grants, automatic attunement configuration and named roll sources.

## 0.3.5 (local test build)

- Enhancement formula and breakdown labels show only the equipment's name, without a skill-tree prefix or node name.
- Roll terms preserve the equipment source in their metadata. GMs using an older Sephral's Roll Breakdown without its adapter API receive an update notice; 1.0.19 supports Foundry V13 and the integration API.

## 0.3.4 (local test build)

- Equipment node details include GM: grant, matching actor trees. GMs can bypass requirements, grant free or charge the equipment pool, and record the level and a note. Free grants refund no points; personal/permanent ownership still applies.

- Trees requiring attunement automatically add the attached item's Magical (`mgc`) property and set Attunement to Required. Existing attachments are repaired when an active GM loads the world; design changes apply the same configuration. Characters must still attune normally.
- Enhancement rolls identify their equipment and unlocked node. Optional Sephral's Roll Breakdown integration preserves these labels instead of generic skill or saving throw bonus labels. Cumulative sources remain individually named; upgrades replace their earlier sources.

## 0.3.3 (local test build)

- Equipment canvases use the available sheet/window height so Fit shows the whole tree. Node details use the card width with bounded scrolling.
- Already unlocked grants reconcile with design edits without restoring spent charges. Granted spells appear in the spellbook and equipment Cast a Spell activities, sharing one charge counter, with a Cast button in node details.
- Physical handoffs retain identity through sheet drops and create/delete transfers, including Item Piles storage and pickup. Powers stop in piles, and personal bonds return to their original actors.
- Attached items show tree badges in the sidebar and inventory. Attachment prompts allow an instance name; equipment windows show location and Open Item.
- Local V14 checks use dnd5e 6.0.6 and Item Piles 3.3.4. V13 and real player-client multiplayer remain manual checks.

## 0.3.2 (local test build)

- Replaced developer jargon in equipment bonus controls with Cumulative bonus, Upgrade bonus and Enchantment.
- Bonus descriptions use full ability/skill names, attack rolls, saving throws and AC rather than internal keys.

## 0.3.1 (local equipment-tree test build)

- Spell grant overrides: independent uses and long-rest, short-rest or daily recovery. Equipment spells appear only while the item is active; usage persists through deactivation and transfer. Permanent grant charges follow the physical item.
- Explicit Add or Replace stacking, with optional named bonus families. Save and skill/ability check enhancements support multiple selections or All.
- Attachment and recovery use item drop areas, including compendium sources instantiated as physical world copies on confirmation.
- Equipment designs choose Weapon, Armor or Other equipment at creation. Type is locked; nonweapon designs hide weapon enhancements and weapon-only earning rules.
- Weapon attack, critical-hit and damage point rules can be limited to the attached weapon. Unchecked rules count the wielder's events while active.
- V14 live tests cover spell casting and charge preservation, inactive long-rest recovery, replacement/multiselect bonuses, weapon event filtering and attachment type rejection. V13 and real player-client multiplayer remain manual checks.

## 0.3.0 (local equipment-tree test build)

- Actor and Equipment categories in the manager and character Skill Tree tab. Equipment uses the existing designer and renderer.
- Equipment nodes can grant personal or permanent enhancements: this weapon's attacks/damage, or the wielder's AC, skill checks and ability saves. Activation can require equipped and attuned.
- One private Journal record per physical item, with saved character bonds, separate points, permanent unlocks, transaction recovery and bounded logs. Actor tree progress stays in its existing storage.
- GM attachment, point awards, transfer and missing-item recovery. Copies receive no live identity; use Transfer to preserve identity and progress.
- Reward source chooser supports compendium originals, saved edits and optional world references. Strict compendium reward sources is optional. New source packs are world compendiums.
- This initial build supports enhancement-only equipment nodes. Equipment item/spell grants, synthetic token actors and automatic transfer through third-party inventory modules are not supported.
- Verified in local Foundry V14.370 / dnd5e 6.0.6 as GM. V13 and multiplayer player-client testing remain manual acceptance checks.

## 0.2.2

- The tree stays sharp when zoomed in. It was drawn once at the fitted size and stretched, so text, rings and the
  background went soft; now it is drawn again at the zoomed size as soon as you stop panning or zooming.

## 0.2.1

- Node names, GM notes and item links are escaped in tooltips, so a name with HTML in it shows as text.

## 0.2.0

First public release. Tested on Foundry V14 (build 370) with dnd5e 6.0.6, on the default character sheet and Tidy 5e,
as a GM and as a player, with and without Tidy 5e and KG PC History. Written for Foundry V13 with dnd5e 5.3.3 too,
not yet tested there.

- Node descriptions are cleaned of scripts before they are shown. (A tree file can still carry grant patches with
  macros, by design, so only import trees from people you trust.)
- Secret text in a granted item's description (GM notes in compendium items) shows to the GM only.
- Grant patches: a node can change the item it grants (name, description, level prerequisite, and from imports
  effects, activities and macros) without touching the source compendium.
- The Skill Tree tab sizes itself to what the sheet shows, so it doesn't need scrolling: the tree shrinks to the room
  left and the node details stay in view at the bottom (scrolling inside themselves when long). It follows the sheet
  as it is resized. The tree stays fitted until you zoom or pan; the fit button returns to fitting.
- Patches apply cleanly to items that already have them (no duplicate effects).
- Patch values can name an item the character already has (`@actorItem[Channel Divinity]`); it becomes that item's id
  when the node is granted, for features that spend another feature's uses.
- A background whose shape differs from the canvas (an imported tree, say) is cropped to fit instead of stretched,
  and a background image that can't be loaded falls back to the canvas color.
- Import over a design: the designer's Import button lays a tree file over the tree being edited. Nodes are matched by
  what they grant (or by name), so characters keep what they own. Undoable, and saved only with Save.
- Clearer node states on the sheet: unlocked nodes glow in their color with a check badge, available nodes pulse white
  with a gold cost, locked nodes are gray with a lock, and blocked or unaffordable nodes have their own badges. Links
  between unlocked nodes glow, links to available nodes flow, and a legend sits under the tree.
- Feature-use requirements: a node can need other nodes' features used a number of times. Uses are counted
  automatically, and the GM can adjust the count on the Skill Tree tab.
- GM grant: one button that grants a node outside the rules, free or charged, at a chosen character level, with a note.
- The Skill Tree tab's click handling always reaches the current panel when Tidy 5e reuses the tab element.
- Unlocked nodes glow again (the glow used an invalid shadow size).

## 0.1.0

- First version: tree designer with any background image, drag-and-drop nodes for items, feats, spells and summons,
  requirement and exclusive links, point rules for levels, XP, milestones, combat, dice, checks, spells and rests,
  unlocking with or without past points, and a Skill Tree tab on dnd5e and Tidy 5e character sheets.
