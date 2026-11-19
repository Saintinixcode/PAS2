# PAS1 → PAS2 item catalogue (inspiration notes)

Source: the original game's `accessories.ts`, `baseArmor.ts`, `baseWeapons.ts`, `consumables.ts`,
`legendary.ts`, `materials.ts`. Not yet seen: `itemIds.ts` itself, recipes, loot tables, enemy drops.
Goal of this note: keep the names, rough ladder and jokes, and make PAS2 clearly **better** than PAS1.
This feeds Step 3 (`data/items.json`) and Step 8 (codex).

## 1. What PAS1 had

| Category | Items |
|---|---|
| Ranged | Slingshot → Improved Slingshot → Crossbow, Bow, Zip Gun → Makeshift Pistol → Makeshift SMG → Makeshift Rifle |
| Melee | Knife (dual-wield), Machete, Baseball Bat, Club (knockback), Scrap/Steel Machete, Scrap/Steel Sword, Spiked Bat, Bladed Bat, Scrap/Steel Claws, Scrap/Steel Mace, Katana |
| Armor (5 slots: head, chest, legs, hands, feet) | Tier 1 Cloth, Tier 2 Leather, Tier 3 Metal (-5% speed each), Tier 4 Military |
| Accessories | Ring of Power (+dmg), Amulet of Speed (+10% speed), Lucky Charm (+15% XP), Survival Manual (+HP), Ring of Protection +1, Loot-o-magnet (pickup range) |
| Consumables | Bandage (2 HP, 10 s CD), Medkit (10 HP, 30 s CD), Food Ration, Water Bottle, Lootbag, Crate (materials, coins, rare diamonds) |
| Materials | Metal Pipe, Duct Tape, Battery, Trigger, Electronics, Gears, Rubber Bands, Wire, Bolts, Screws, Brackets, Rare Metal, Cloth, Plastic, Leather, Kevlar, Glue, Super Glue |
| Legendaries (14, "drop only", orange) | Legendary Rifle, Katana, Loot-o-magnet, Ring of Protection, Boots of Speed, **Metal Bucket**, **Big Floppy**, **Wolvie's Claw**, **Excalibur**, Machete of the Wastes, Military Vest of the Commander, Makeshift Rifle of the Sniper, Spiked Bat of the Berserker, Leather Boots of the Nomad |

Stat vocabulary worth keeping: `damage`, `range`, attack-speed multiplier, `defenseBonus` (flat per-hit block),
`healthBonus`, `speedBonus`, `xpBonus`, `pickupRangeBonus`, `knockbackForce`. Items also had `baseItemId`
(a legendary points at the common item it upgrades) and buy/sell prices.

Rough PAS1 power ladder (melee damage): knife 0.25 · bat 0.7 · machete 2 · scrap 2.5-3 · steel 3.5-4 · katana 5 ·
legendaries 6-18. Ranged: slingshot 1 · crossbow 3 · pistol 6 · SMG 10 · rifle 15 · legendary rifle 30-50.
Armor defense per piece: cloth 0.25 · leather 0.5 · metal 1 · military 1.25-1.5 · legendary 2-8.

### 1b. From `itemIds.ts` (now seen)
- IDs were **numeric ranges by category**: Materials 1-99, Consumables 100-199, Weapons 200-299, Armor 300-399, Accessories 400-499, Legendaries 500-599. `SCRAP` (id 19) was a special-case resource living among the materials.
- **Generated loot (10000+)**: "base item + prefix combinations", i.e. PAS1 already planned random-affix variants of base items (`isGeneratedLoot`). PAS2 should do this properly: **prefix/suffix affixes on Common-to-Epic items** (e.g. "Rusty", "Serrated", "of the Sprinter"), rolled at drop time and stored on the item instance.
- Gaps in the ranges (104 unused; no Tier-5 armor, no ammo ids) mark where new content slots in.
- PAS2 will use **string ids** (`"zip_gun"`, `"legendary_big_floppy"`) in JSON for readability, and keep a `legacyId` field with the PAS1 number for callbacks, codex cross-references and migrating any old data.

## 2. Where PAS1 was weak (what PAS2 fixes)
1. **Legendaries were the common item with bigger numbers.** PAS2 legendaries get a **unique passive or proc** (see §4), so each one changes how you play.
2. **No ammo model.** Magazines were stripped out; "basic_ammo/advanced_ammo" were left as comments. PAS2 brings ammo back as real items with reload.
3. **Flat, tiny-number stats** (0.25 defense, 0.7 damage) and no variance. PAS2 uses whole numbers, rarity tiers, and optional affixes.
4. **Armor was pure upgrades** except metal's speed tax. PAS2 gives each set a trade-off and set bonuses.
5. **Materials were inert.** Many (Kevlar, Rare Metal, Super Glue, Electronics) had no tier to pay off. PAS2 ties every material to recipes and to a tier.
6. **Duplicate-looking items** (e.g. three 🧢 helmets, five 🪖 pieces). Grid sizes and silhouettes make items distinct.
7. **No identity for parts or loot containers.** Crates and Lootbags were instant-use consumables; in PAS2 they are **lootable grids** you open and search.

## 3. PAS2 item catalogue skeleton

Rarity: **Scrap** (grey) · **Common** (white) · **Uncommon** (green) · **Rare** (blue) · **Epic** (purple) · **Legendary** (orange, keeps PAS1's colour).
Grid sizes (w x h): the shape carries the identity.

| Group | Examples (PAS1 names kept) | Size |
|---|---|---|
| Throwing/sling | Slingshot, Improved Slingshot | 2x1 |
| Bows | Bow, Crossbow | 2x3 / 3x2 |
| Pistols | Zip Gun, Makeshift Pistol | 2x1 |
| Longarms | Makeshift SMG (3x2), Makeshift Rifle (5x2) | |
| Light melee | Knife 1x2, Scrap Claws / Steel Claws 2x2, Machete 1x3 | |
| Heavy melee | Baseball Bat 1x4, Club 1x4, Spiked/Bladed Bat 1x4, Mace 2x3, Katana 1x5, swords 1x4 | |
| Armor | Hat/Helmet 2x2 · Shirt/Jacket/Vest 3x3 · Pants/Braces 2x3 · Gloves 2x1 · Boots 2x2 | |
| Accessories | Rings, charms, Loot-o-magnet | 1x1 |
| Consumables | Bandage 1x1 · Food Ration 1x1 · Water Bottle 1x2 · Medkit 2x2 | |
| Containers (gear that adds grid space) | Satchel, Backpack, Tactical Vest, Belt pouch | new |
| Ammo | Stones (sling), Arrows/Bolts, Scrap Rounds (basic), Military Rounds (advanced) | 1x1 stacks |
| Materials | all PAS1 materials, 1x1 stacks | |

Armor sets keep the 4 PAS1 tiers (Cloth → Leather → Metal → Military) and add a **Tier 5 Kevlar** set (Kevlar finally pays off).
Set bonus idea: wear 3+ pieces of one tier for a small bonus (Leather: +speed; Metal: reduced knockback; Military: +magazine size; Kevlar: pierce resistance).

Scaling to PAS2: PAS1 numbers are tiny; multiply damage x5 and defense x4 as a starting point, then tune in Step 9.
Our current baseline is a 10-damage pistol shot and 20-HP walkers, so e.g. Makeshift Pistol ~30, SMG ~50 per burst-equivalent, Rifle ~75.
Keep the *ratios* between items, not the raw numbers.

## 4. Legendaries with a reason to exist (names kept, behaviour added)
| PAS1 name | PAS2 unique |
|---|---|
| **Big Floppy** (bat) | Home-run: heavy knockback launches a zombie into others, damaging the pile. |
| **Wolvie's Claw** | "Snikt": every 5th hit is a triple strike; heals a little on kill. |
| **Excalibur** | Every 5th hit fires a light beam that pierces the line. |
| Legendary Katana | Dash-slash on a short cooldown; kills reset it. |
| Legendary Rifle / Rifle of the Sniper | Pierces; damage rises with distance (long-range reward). |
| Spiked Bat of the Berserker | Damage scales up as your HP falls. |
| **Metal Bucket** | Blocks the first hit you take each night. Funny and useful. |
| Military Vest of the Commander | Allied turrets within range fire faster. |
| Boots of Speed / Nomad's Boots | Nomad's: no speed penalty from armor and cheaper stamina. |
| Machete of the Wastes | Nest-spawned zombies drop extra parts. |
| Legendary Ring of Protection | Small damage shield that recharges out of combat. |
| Legendary Loot-o-magnet | Pulls ground items and parts from far away. |

Still **drop only**. Sources: nest bosses, rare crates, and the **revenant** that guards a grave (once built). Adding a few brand-new ones is cheap once the proc system exists.

## 5. Callbacks and easter eggs to keep
- Keep the **names**: Zip Gun, Makeshift Pistol/SMG/Rifle, Big Floppy, Wolvie's Claw, Loot-o-magnet, Lucky Charm, Metal Bucket, Survival Manual.
- **Survival Manual** becomes a readable item that unlocks Lore-log entries and a tip tab, as a nod to PAS1.
- **Lootbag** and **Crate** stay as item names; in PAS2 they are 2x2 / 3x3 containers you open into a grid.
- "Diamonds" were a rare crate drop in PAS1; keep as a rare, high-value trade item.
- Lore log can quietly reference the old game ("the first outbreak", old landmarks) without needing to explain PAS1.

## 6. Zombie parts and potions (new in PAS2)
Parts (stack, 1x1): Rotten Flesh, Severed Hand, Eyeball, Fang, Bone Shard, Brain Matter, Tough Hide; rarer: Brute Heart, Spitter Gland, Nest Core.
Potions (1x2) craft from parts plus Glue/Duct Tape/Water Bottle and grant **stat points**: Vigor (END), Might (STR), Fleet (AGI), Focus (PER), Wit.
Each potion also carries a small side effect so crafting choices matter; stronger potions need rarer parts.

## 7. Schema notes for `items.json`
- Keep PAS1 field names where sensible: `id`, `name`, `icon`, `description`, `value`, `slot`, `stats{damage,range,speed,defense,health,xpBonus,pickupRange,knockback}`, `baseItemId`.
- Add: `size:[w,h]`, `rarity`, `stack`, `tags`, `passive` (for legendaries and sets), `ammoType`, `container:{grid:[w,h]}`, `dropWeight`, `lore`.
- Drop the PAS1 buy/sell pair in favour of a single `value`, unless we add a trader (open question).

## 8. Questions for the owner
- Wandering trader / shop? PAS1 had buy and sell prices on every item. If yes, scrap is the currency and the trader sits at Fort Hollow.
- Melee durability, or let weapons last forever?
- Is there anything in PAS1 you want to leave out of PAS2 entirely?
