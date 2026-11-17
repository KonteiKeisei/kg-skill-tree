# Equipment trees: V13 manual test

Install kg-skill-tree 0.3.6 in place of the old module and reload the world. Keep your previous ZIP for rollback.
Actor-tree storage is not migrated.

1. Open Skill Trees > Equipment. Import the accompanying equipment-sword-example.json, or create a design.
2. Attach a mundane weapon to a tree that requires attunement. Magical and Attunement Required should be set automatically. Equip and attune it normally in its own sheet.
3. Attach the design to the weapon from the manager or its sheet's Skill Tree header action.
4. Open the character's Skill Tree tab > Equipment. Award 6 equipment points as GM.
5. Buy Familiar Grip, Tempered Edge and Guardian Bond. Confirm only this weapon gets its attack/damage bonus, and the actor gets AC, Perception and Wisdom save bonuses.
6. Roll attacks with another weapon. It must not receive the first weapon's bonus.
7. Unequip, re-equip, lose attunement and re-attune. Bonuses should toggle without changing purchases or accumulating.
8. Use Transfer in the equipment panel to pass it to a second actor. Personal nodes should be fresh, Tempered Edge inherited, balance zero, and activation reset.
9. Award the second actor 2 points and buy Ember Core. Transfer back. The first actor's bond returns, with Ember Core inherited and its own prior balance unchanged.
10. Reload Foundry and check both progress and bonuses. Try a permanent refund and confirm dependents must be refunded first.
11. Duplicate the item normally. The copy must not inherit the physical identity or progress.
12. Drag the weapon between sheets and use Send/Give. Drop it onto the canvas with Item Piles, then pick it up as another character. Confirm permanent upgrades follow it, personal progress is separate, and returning it restores the original bond. Use Recover Item only for an interrupted handoff.
13. As a player with an active GM, open Equipment, buy an affordable node, and confirm a private request record is processed. Try insufficient points and no ownership.
14. Open an existing Actor tree, buy/refund a node, and verify that neither equipment points nor equipment progress changes.
15. In the designer drop a custom sidebar reward on an actor-tree node. Test Use Original, Save Edited and optional Keep World. Try strict source mode.
16. Create Weapon, Armor and Other equipment trees. Verify the type is fixed and nonweapon trees omit weapon bonuses and weapon-only point conditions.
17. Drag a compendium weapon into Attach to Item. Confirm that a world copy is created only on Attach and that the source pack is untouched.
18. Grant Feather Fall from a compendium. In its editor override uses to 1 and recovery to Long rest. Cast, deactivate/re-activate, then transfer the item: its spent charge must persist. Rest while inactive, then equip: the charge should recover.
19. Add an attack bonus of 1, then another of 2. In Add mode expect 3; change the second to Replace and expect 2. Test multiselect and All for saves, skill checks and ability checks.
20. Add a critical-hit earning rule with Only with this weapon. Crit with another weapon, then this one. Only the attached weapon should earn equipment points. Uncheck it and confirm either can count while the tree is active.
21. Add a spell to a node already purchased. Confirm its usable spell appears without refunding. Edit max uses and confirm spent uses remain spent. Cast from both the spellbook and equipment Activities; both share the same counter.
22. Name an instance when attaching. Verify sidebar/inventory tree badges, physical location and Open Item. Resize its tree window and Tidy sheet, select a node, zoom in, then Fit. The whole background should fit inside the available canvas and details should use the full card width.
23. Enable Sephral's Roll Breakdown 1.0.19. Roll an enhanced skill check, save, weapon attack and damage. Each enhancement should identify only its physical item; cumulative values stay separate and upgrade bonuses replace earlier values. Make a new roll after upgrading: older cards can retain their saved breakdown.
24. Select a locked equipment node with unmet requirements and no available points. GM: grant should offer a free unlock, gained level and note. Grant it, refund it and confirm no points are created. Untick Free and confirm the equipment pool is charged. Players must not be able to use GM grant.
25. Roll an enhanced check with an otherwise empty skill bonus. The equipment adds its labeled term without an extra +0 or Unknown modifier entry. Other existing bonuses should still stack.

## V14 checks performed locally

GM attachment and separate points, scoped attack bonus, actual damage/save/skill rolls, AC activation, repeated
preparation without accumulation, transfer and return, permanent inheritance, independent bond event counters,
duplicate request deduplication, duplicate-item identity stripping, cancelled-transfer rollback, authenticated
request handling, raw socket mutation rejection, actor-tree purchase regression, and missing-item recovery.
Spellbook and equipment activity casting share charges. Editing already unlocked grants preserves spent uses.
Item Piles 3.3.4 checks cover synthetic pile deposit/pickup, canvas drop creating a new pile, pickup from that pile, and Give.
Equipment window Fit, full-width details, instance naming and Tidy inventory badges were checked live.
The 0.3.4 checks verify automatic mgc/Required attunement, repair of existing attachments, actual spell activation after attuning, and unchanged compendium sources.
Sephral's Roll Breakdown 1.0.19 shows equipment names for skill checks, saves, attacks and damage, with cumulative/upgrade behavior. GM grant free/charged accounting and refunds were checked.

## Limits

V13 and real player-client multiplayer are not verified here. Enhancements, spells and simple feature grants are supported.
An active GM must observe transfers. Item Piles synthetic inventories are supported for storage and transfer; purchasing progress on synthetic actors is excluded.
Equipment changes are recorded in their ledger, not as PC History grant entries.
