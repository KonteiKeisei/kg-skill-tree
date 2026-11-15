# KG Skill Trees

KG Skill Trees gives characters something to grow into beyond their class. As the GM, you lay out a tree on any
picture you like (a map, a sigil, a starfield) and fill it with feats, spells, items or summoned companions, dragging
them in straight from your compendiums. You decide what each one costs, what has to come before it, and how characters
earn points: leveling up, finishing fights, rolling natural 20s, taking long rests, or points you hand out yourself.
When you open a tree for a character, you choose whether they get the points they would already have earned or start
fresh from today. Players get a Skill Tree tab on their character sheet. It shows what they can afford now, what's
still out of reach and why, and lets them spend points to unlock new abilities, which go straight onto their sheet.

Tested on Foundry V14 with dnd5e 6.0.6, on the default character sheet and Tidy 5e. Written for Foundry V13 with
dnd5e 5.3.3 too.

## Designing a tree

Open **Skill Trees** from the button at the top of the Actors sidebar (or Game Settings, Configure Settings, KG Skill
Trees). Create a tree and press **Design**.

- **Add nodes**: double-click the canvas, or press **Node**.
- **Grant something**: drop a feat, spell or item from the sidebar or a compendium onto the canvas. A node is created
  where you drop it, named after the item, and a feat's level prerequisite carries over. Drop onto an existing node to
  add the item to it.
- **Summons**: drop an actor. The node grants a feature with a Summon activity for that actor. The dnd5e setting
  "Allow Summoning" must be on, and players need permission to create tokens.
- **Requirements**: drag the small dot on a node onto another node. The arrow points at the node that needs the first.
  Hold Alt while dropping to make the two exclusive (taking one locks the other). A node with several requirements can
  need all of them or any one. Nodes can also need a character level, a class level, or points spent in the tree, and
  can be secret until their requirements are met.
- **Patch what a node grants**: the pencil next to a granted item changes its name, its description, or drops its
  level prerequisite, only for what this tree grants. The source item (a compendium owned by another module, say) is
  never touched, so its updates still come through. Imported trees can carry bigger patches (effects, activities,
  macros); the designer lists them and can clear them. A patch value of `@actorItem[Channel Divinity]` becomes the id
  of that item on the character when the node is granted, so a granted feature can spend another feature's uses.
- **Feature uses**: a node can require the features of other nodes to have been used a number of times ("use your
  infernal features 3 times"). Uses of granted features are counted automatically; the GM can count uses by hand on
  the Skill Tree tab for features that trigger on their own. Macros can call `api.countUse(actor, item)`.
- **Move** nodes freely; links follow. Shift-drag selects an area, and a selection can be aligned, spread or chained.
- **Background**: any image. The canvas takes the image's shape. Without an image, pick a shape and a color.
- **Undo** with Ctrl+Z, **save** with Ctrl+S.
- **Import over a design**: the designer's Import button loads a tree file over the tree you are editing. Nodes that
  grant the same thing (or share a name) keep their identity, so characters keep what they bought. It can be undone,
  and nothing is saved until you press Save. (Import in the Skill Trees window always makes a new tree.)

## Earning points

The designer's **Points** tab lists the tree's rules, each a plain sentence such as "1 point every level, starting at
level 2". A rule can pay out every so many of something or at chosen values, and can be capped.

| Progress | Combat | Dice | Checks | Other |
| --- | --- | --- | --- | --- |
| Character level | Combats finished | Natural 20s | Skill checks (any or one skill) | Spells cast (by level) |
| Class level | Enemies defeated | Natural 1s | Tool checks | Short rests |
| Experience points | Attack rolls | | Ability checks | Long rests |
| Milestones (GM) | Critical hits | | Saving throws | |
| | Damage rolled | | | |

The GM can also give or take points on any character's Skill Tree tab.

Points are worked out from the character, not stored: losing a level takes its point back, and nothing is counted
twice.

## Unlocking

Use **Characters** in the manager (or the designer), or the Skill Tree tab on a GM's view of a sheet. The first time a
tree is unlocked for a character, the GM chooses:

- **Award points earned so far**: the character gets what the rules would have paid for its levels and recorded
  events up to now.
- **Start from now**: points only come from progress after the unlock.

A bonus number of starting points can be added either way. Locking a tree hides it from the player; their nodes and
items stay, and unlocking again picks up where it left off.

## For players

The Skill Tree tab shows the tree, the points available, and what each node does. Nodes you own glow in their color
with a check, nodes you can unlock now pulse white with a gold cost, and locked nodes are gray with a lock; a legend
under the tree explains the badges. The tab fits the sheet as it is resized. Zoom with the buttons or Ctrl and the mouse wheel, and drag to pan; the fit
button brings the whole tree back into view. Select a node to read it, see its requirements, and unlock it. Feats with choices (such as Ability Score Improvement)
open dnd5e's advancement prompt; closing it without finishing costs nothing. Refunds follow the tree's refund rule.

## GM grants

On the Skill Tree tab, **GM: grant** gives a character any node outside the normal rules: requirements are ignored,
it can be free, and it can be recorded at an earlier character level with a note ("saved the shrine at level 7").
The node shows "Granted by the GM", and KG PC History files it at that level.

## KG PC History

With KG PC History active, everything a tree grants or refunds is recorded in the character's history as a Skill Tree
entry naming the tree and node, at the level it was bought.

## For other modules

Granted items carry `flags["kg-skill-tree"].grant = { treeId, treeName, nodeId, nodeName, cost, level }`, plus
`gm: true` and `note` for GM grants.
`game.modules.get("kg-skill-tree").api` has `trees()`, `getTree(id)`, `points(actor, treeId)`, `stats(actor)`,
`purchase(actor, treeId, nodeId, { free, force, level, note })`, `refund(actor, treeId, nodeId)`,
`unlock(actors, treeId)`, `giveMilestone(actors)`, `countUse(actor, item, n)`,
`openManager()`, `openDesigner(treeId)` and `openViewer(actor)`. The hooks `kg-skill-tree.purchase` and
`kg-skill-tree.refund` fire after a node is bought or refunded.

## Install

Manifest URL: `https://github.com/KonteiKeisei/kg-skill-tree/releases/latest/download/module.json`

## License

PolyForm Noncommercial 1.0.0. See [LICENSE](LICENSE).
