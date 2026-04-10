/**
 * cache.js — localStorage cache dla danych grafu
 * TTL: 30 minut (dane z API Sejmu rzadko się zmieniają)
 */
const TTL_MS = 30 * 60 * 1000; // 30 minut

function cacheKey(filters) {
  return `prawo_graph_${JSON.stringify(filters)}`;
}

export function saveToCache(filters, data) {
  try {
    const entry = { ts: Date.now(), data };
    localStorage.setItem(cacheKey(filters), JSON.stringify(entry));
  } catch (e) {
    // localStorage może być pełne — ignoruj
    console.warn("Cache save failed:", e.message);
  }
}

export function loadFromCache(filters) {
  try {
    const raw = localStorage.getItem(cacheKey(filters));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) {
      localStorage.removeItem(cacheKey(filters));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearCache() {
  const keys = Object.keys(localStorage).filter((k) =>
    k.startsWith("prawo_graph_")
  );
  keys.forEach((k) => localStorage.removeItem(k));
  return keys.length;
}

export function getCacheInfo() {
  const keys = Object.keys(localStorage).filter((k) =>
    k.startsWith("prawo_graph_")
  );
  let totalBytes = 0;
  keys.forEach((k) => {
    totalBytes += (localStorage.getItem(k) || "").length * 2;
  });
  return {
    entries: keys.length,
    sizeKB: Math.round(totalBytes / 1024),
  };
}
