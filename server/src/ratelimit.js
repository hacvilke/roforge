// In-memory sliding-window rate limiter.
// Single-node MVP; for production, swap the Map for Redis with the same API.
const windows = new Map(); // key -> number[] of timestamps (ascending)

export function checkRate(key, limitPerMin, now = Date.now()) {
  const cutoff = now - 60_000;
  let arr = windows.get(key);
  if (!arr) {
    arr = [];
    windows.set(key, arr);
  }
  while (arr.length && arr[0] <= cutoff) arr.shift();
  if (arr.length >= limitPerMin) {
    const retryAfterSec = Math.max(1, Math.ceil((arr[0] + 60_000 - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  arr.push(now);
  return { allowed: true, remaining: limitPerMin - arr.length, retryAfterSec: 0 };
}

export function _reset() {
  windows.clear();
}
