/**
 * Gen 3 ability ID → name + short description.
 *
 * Source: pret/pokeemerald `data/abilities.h` + Bulbapedia ability table.
 * Gen 3 introduced 76 abilities (IDs 1..76); ID 0 is the sentinel "no
 * ability" used by eggs and the unused slot 0. The vendored table here
 * is purely cosmetic — used by the FR/LG-style stat-screen renderer to
 * print "Static" / "Levitate" instead of "ability 56".
 *
 * Descriptions are the in-game flavour text from FR/LG/Emerald. Most
 * are 1-3 sentences; we keep them short since the FR/LG SKILLS page
 * only has a 1-2 line description area.
 */

export interface AbilityInfo {
  readonly name: string;
  readonly description: string;
}

const TABLE: Readonly<Record<number, AbilityInfo>> = {
  0: { name: '—', description: '' },
  1: { name: 'Stench', description: 'Helps repel wild POKéMON.' },
  2: { name: 'Drizzle', description: 'Summons rain in battle.' },
  3: { name: 'Speed Boost', description: 'Gradually boosts SPEED.' },
  4: { name: 'Battle Armor', description: 'Blocks critical hits.' },
  5: { name: 'Sturdy', description: 'Negates 1-hit KO attacks.' },
  6: { name: 'Damp', description: 'Prevents self-destruction.' },
  7: { name: 'Limber', description: 'Prevents paralysis.' },
  8: { name: 'Sand Veil', description: 'Raises evasion in a sandstorm.' },
  9: { name: 'Static', description: 'May paralyze on contact.' },
  10: { name: 'Volt Absorb', description: 'Turns electricity into HP.' },
  11: { name: 'Water Absorb', description: 'Changes water into HP.' },
  12: { name: 'Oblivious', description: 'Prevents attraction.' },
  13: { name: 'Cloud Nine', description: 'Negates weather effects.' },
  14: { name: 'Compound Eyes', description: 'Raises move accuracy.' },
  15: { name: 'Insomnia', description: 'Prevents sleep.' },
  16: { name: 'Color Change', description: 'Changes type to match a foe.' },
  17: { name: 'Immunity', description: 'Prevents poisoning.' },
  18: { name: 'Flash Fire', description: 'Powers up if hit by FIRE.' },
  19: { name: 'Shield Dust', description: 'Prevents added effects.' },
  20: { name: 'Own Tempo', description: 'Prevents confusion.' },
  21: { name: 'Suction Cups', description: 'Firmly anchors the body.' },
  22: { name: 'Intimidate', description: "Lowers the foe's ATTACK." },
  23: { name: 'Shadow Tag', description: "Prevents the foe's escape." },
  24: { name: 'Rough Skin', description: 'Hurts to touch.' },
  25: { name: 'Wonder Guard', description: 'Only super-effective hits work.' },
  26: { name: 'Levitate', description: 'Not affected by GROUND moves.' },
  27: { name: 'Effect Spore', description: 'Contact may cause status.' },
  28: { name: 'Synchronize', description: 'Passes status to the foe.' },
  29: { name: 'Clear Body', description: 'Prevents stat reduction.' },
  30: { name: 'Natural Cure', description: 'Heals upon switching out.' },
  31: { name: 'Lightning Rod', description: 'Draws electrical moves.' },
  32: { name: 'Serene Grace', description: 'Promotes added effects.' },
  33: { name: 'Swift Swim', description: 'Raises SPEED in rain.' },
  34: { name: 'Chlorophyll', description: 'Raises SPEED in sunshine.' },
  35: { name: 'Illuminate', description: 'Encounters POKéMON often.' },
  36: { name: 'Trace', description: "Copies a foe's ability." },
  37: { name: 'Huge Power', description: 'Raises ATTACK.' },
  38: { name: 'Poison Point', description: 'Contact may poison.' },
  39: { name: 'Inner Focus', description: 'Prevents flinching.' },
  40: { name: 'Magma Armor', description: 'Prevents freezing.' },
  41: { name: 'Water Veil', description: 'Prevents burns.' },
  42: { name: 'Magnet Pull', description: 'Traps STEEL POKéMON.' },
  43: { name: 'Soundproof', description: 'Avoids sound-based moves.' },
  44: { name: 'Rain Dish', description: 'Slowly recovers HP in rain.' },
  45: { name: 'Sand Stream', description: 'Summons a sandstorm.' },
  46: { name: 'Pressure', description: "Raises foe's PP usage." },
  47: { name: 'Thick Fat', description: 'Heat & cold are weakened.' },
  48: { name: 'Early Bird', description: 'Wakes up quickly.' },
  49: { name: 'Flame Body', description: 'Contact may burn.' },
  50: { name: 'Run Away', description: 'Enables a sure getaway.' },
  51: { name: 'Keen Eye', description: 'Prevents loss of accuracy.' },
  52: { name: 'Hyper Cutter', description: 'Prevents ATTACK loss.' },
  53: { name: 'Pickup', description: 'May pick up items.' },
  54: { name: 'Truant', description: 'Moves only every 2 turns.' },
  55: { name: 'Hustle', description: 'Trades accuracy for power.' },
  56: { name: 'Cute Charm', description: 'May infatuate on contact.' },
  57: { name: 'Plus', description: 'Powers up with MINUS.' },
  58: { name: 'Minus', description: 'Powers up with PLUS.' },
  59: { name: 'Forecast', description: 'Changes with the weather.' },
  60: { name: 'Sticky Hold', description: 'Prevents item theft.' },
  61: { name: 'Shed Skin', description: 'May heal own status.' },
  62: { name: 'Guts', description: 'Raises ATTACK if statused.' },
  63: { name: 'Marvel Scale', description: 'Raises DEFENSE if statused.' },
  64: { name: 'Liquid Ooze', description: 'Drainers take damage.' },
  65: { name: 'Overgrow', description: 'Powers up GRASS in a pinch.' },
  66: { name: 'Blaze', description: 'Powers up FIRE in a pinch.' },
  67: { name: 'Torrent', description: 'Powers up WATER in a pinch.' },
  68: { name: 'Swarm', description: 'Powers up BUG in a pinch.' },
  69: { name: 'Rock Head', description: 'Prevents recoil damage.' },
  70: { name: 'Drought', description: 'Summons sunlight in battle.' },
  71: { name: 'Arena Trap', description: "Prevents the foe's escape." },
  72: { name: 'Vital Spirit', description: 'Prevents sleep.' },
  73: { name: 'White Smoke', description: 'Prevents stat reduction.' },
  74: { name: 'Pure Power', description: 'Raises ATTACK.' },
  75: { name: 'Shell Armor', description: 'Blocks critical hits.' },
  76: { name: 'Cacophony', description: 'Avoids sound-based moves.' },
  77: { name: 'Air Lock', description: 'Negates weather effects.' },
};

export function getAbilityName(id: number): string {
  return TABLE[id]?.name ?? `Ability ${id}`;
}

export function getAbilityDescription(id: number): string {
  return TABLE[id]?.description ?? '';
}
