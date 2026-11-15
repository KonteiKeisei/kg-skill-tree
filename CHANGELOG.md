# Changelog

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
