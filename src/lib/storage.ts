export interface Repository<T extends { id: string }> {
  getAll(): T[];
  getById(id: string): T | undefined;
  create(item: T): T;
  update(id: string, patch: Partial<T>): T | undefined;
  remove(id: string): void;
}

function readCollection<T>(key: string): T[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function writeCollection<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

export interface DocumentStore<T> {
  get(): T;
  save(patch: Partial<T>): T;
}

/**
 * Single-document counterpart to Repository<T>, for settings-like state that
 * is one object rather than a collection. Unknown/missing keys fall back to
 * `defaults`, so adding a field later never breaks an existing saved value.
 */
export function createLocalStorageDocument<T extends object>(
  key: string,
  defaults: T,
): DocumentStore<T> {
  function read(): T {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    try {
      return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      return { ...defaults };
    }
  }

  return {
    get: read,
    save(patch) {
      const updated = { ...read(), ...patch };
      localStorage.setItem(key, JSON.stringify(updated));
      return updated;
    },
  };
}

/**
 * localStorage-backed implementation of Repository<T>. Swapping this factory
 * for a remote-API-backed one later keeps every caller (which only depends
 * on the Repository<T> interface) unchanged.
 */
export function createLocalStorageRepository<T extends { id: string }>(
  key: string,
): Repository<T> {
  return {
    getAll() {
      return readCollection<T>(key);
    },
    getById(id) {
      return readCollection<T>(key).find((item) => item.id === id);
    },
    create(item) {
      const items = readCollection<T>(key);
      items.push(item);
      writeCollection(key, items);
      return item;
    },
    update(id, patch) {
      const items = readCollection<T>(key);
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      const updated = { ...items[index], ...patch };
      items[index] = updated;
      writeCollection(key, items);
      return updated;
    },
    remove(id) {
      writeCollection(
        key,
        readCollection<T>(key).filter((item) => item.id !== id),
      );
    },
  };
}
