import { vi } from "vitest"

// Avoid Node's experimental localStorage shadowing jsdom's browser storage.
export function installBrowserStorage() {
  const entries = new Map<string, string>()
  const storage: Storage = {
    get length() { return entries.size },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, String(value)) },
    removeItem: (key) => { entries.delete(key) },
    key: (index) => Array.from(entries.keys())[index] ?? null,
  }
  vi.stubGlobal("localStorage", storage)
}
