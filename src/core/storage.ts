/**
 * Local persistence (high score + settings). Safe against private-mode /
 * blocked storage: falls back to in-memory values.
 */
export interface SaveData {
  high: number;
  bestDistance: number;
  sound: boolean;
  vibration: boolean;
  runs: number;
}

const KEY = 'oslorush.v1';

const DEFAULTS: SaveData = {
  high: 0,
  bestDistance: 0,
  sound: true,
  vibration: true,
  runs: 0,
};

let cache: SaveData | null = null;

export function loadData(): SaveData {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      cache = { ...DEFAULTS, ...parsed };
    } else {
      cache = { ...DEFAULTS };
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function saveData(patch: Partial<SaveData>): SaveData {
  const data = { ...loadData(), ...patch };
  cache = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — keep in-memory copy */
  }
  return data;
}

export function resetHighScore(): void {
  saveData({ high: 0, bestDistance: 0 });
}
