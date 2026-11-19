export const UPGRADES = [
  { id: 'rapid', name: 'Rapid Fire', desc: '+18% fire rate', max: 8, apply: (s) => (s.rate *= 0.85) },
  { id: 'heavy', name: 'Heavy Rounds', desc: '+25% damage', max: 8, apply: (s) => (s.damage *= 1.25) },
  { id: 'multi', name: 'Multishot', desc: '+1 projectile', max: 4, apply: (s) => s.count++ },
  { id: 'pierce', name: 'Piercing', desc: 'Bullets pass through +1 enemy', max: 4, apply: (s) => s.pierce++ },
  { id: 'range', name: 'Long Barrel', desc: '+20% range', max: 4, apply: (s) => (s.range *= 1.2) },
  { id: 'boots', name: 'Fleet Foot', desc: '+10% move speed', max: 5, apply: (s) => (s.speed *= 1.1) },
  { id: 'vital', name: 'Vitality', desc: '+30 max HP', max: 6, apply: (s) => (s.maxHp += 30) },
  { id: 'regen', name: 'Regeneration', desc: '+1 HP per second', max: 5, apply: (s) => (s.regen += 1) },
  { id: 'magnet', name: 'Magnet', desc: '+50% pickup range', max: 4, apply: (s) => (s.magnet *= 1.5) },
  { id: 'gather', name: 'Gatherer', desc: '+30% harvest speed', max: 4, apply: (s) => (s.harvest *= 1.3) },
  { id: 'blades', name: 'Orbit Blades', desc: '+1 spinning blade', max: 5, apply: (s) => s.blades++ },
];
