// Save slots live in localStorage; any slot can also be exported to / imported
// from a .json file so worlds survive clearing browser data or moving devices.

export const SLOTS = 3;
const KEY = (i) => `pasurvivors.slot.${i}`;
const store = () => globalThis.localStorage;

export function readSlot(i) {
  try {
    const raw = store().getItem(KEY(i));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function slotMetas() {
  return Array.from({ length: SLOTS }, (_, i) => {
    const d = readSlot(i);
    return d ? { slot: i, ...d.meta } : null;
  });
}

export function writeSlot(i, data) {
  try {
    store().setItem(KEY(i), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function deleteSlot(i) { try { store().removeItem(KEY(i)); } catch { /* ignore */ } }

export function exportSlot(i) {
  const d = readSlot(i);
  if (!d) return;
  const blob = new Blob([JSON.stringify(d)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pa-survivors-${(d.meta.name || 'world').replace(/\W+/g, '-')}-day${d.meta.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFile(file) {
  const d = JSON.parse(await file.text());
  if (!d || d.v !== 1 || !d.world || !d.player) throw new Error('Not a PA Survivors save');
  const slots = slotMetas();
  const free = slots.findIndex((m) => !m);
  if (free < 0) throw new Error('All slots are full. Delete one first.');
  writeSlot(free, d);
  return free;
}
