// Tiny IndexedDB store: settings (kv) and saved stamps. No localStorage.
// Documents are never stored; only the stamps you make.
const DB_NAME = 'in-wo-osu'
const KV = 'kv'
const STAMPS = 'stamps'

export type StampKind = 'seal' | 'sign' | 'photo'

export interface Stamp {
  id: string
  kind: StampKind
  png: Blob
  w: number
  h: number
  created: number
}

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
      if (!db.objectStoreNames.contains(STAMPS)) db.createObjectStore(STAMPS, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbp = null
      reject(req.error ?? new Error('idb open'))
    }
  })
  return dbp
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const r = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(r.result as T)
        tx.onerror = () => reject(tx.error ?? r.error)
        tx.onabort = () => reject(tx.error ?? new Error('idb abort'))
      }),
  )
}

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>(KV, 'readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export async function save(key: string, value: unknown): Promise<void> {
  try {
    await run(KV, 'readwrite', (s) => s.put(value, key))
  } catch {
    /* settings are a nicety; never block the app */
  }
}

export async function listStamps(): Promise<Stamp[]> {
  try {
    const all = await run<Stamp[]>(STAMPS, 'readonly', (s) => s.getAll())
    return all.sort((a, b) => a.created - b.created)
  } catch {
    return []
  }
}

export function putStamp(stamp: Stamp): Promise<unknown> {
  return run(STAMPS, 'readwrite', (s) => s.put(stamp))
}

export function deleteStamp(id: string): Promise<unknown> {
  return run(STAMPS, 'readwrite', (s) => s.delete(id))
}

/** Best-effort. A denial must not block the app. */
export async function askPersist(): Promise<void> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist()
    }
  } catch {
    /* ignore */
  }
}
