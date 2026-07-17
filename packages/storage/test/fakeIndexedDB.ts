// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Minimal in-memory IndexedDB shim for unit tests.
 *
 * happy-dom does not implement IndexedDB, and the real browser API is
 * callback-based and awkward to mock per-call. This fake mirrors the small
 * subset of the IndexedDB surface that `IndexedDBStorage` relies on:
 * `open` / `onupgradeneeded` / `transaction` / `objectStore` / `get` / `put` /
 * `delete` / `openCursor` + the `IDBRequest` success/error callbacks.
 *
 * Callbacks fire on a microtask so `await` resolves the same way it would in
 * a browser. `failNextOpen` lets a test simulate a connection failure.
 */

type Value = unknown;

class FakeRequest<T> {
    result: T | undefined;
    error: unknown;
    onsuccess: ((event: { target: FakeRequest<T> }) => void) | null = null;
    onerror: ((event: { target: FakeRequest<T> }) => void) | null = null;

    constructor() {
        this.result = undefined;
        this.error = undefined;
    }

    succeed(value: T): void {
        this.result = value;
        queueMicrotask(() => this.onsuccess?.({ target: this }));
    }

    fail(error: unknown): void {
        this.error = error;
        queueMicrotask(() => this.onerror?.({ target: this }));
    }
}

class FakeCursor {
    value: Value;
    primaryKey: IDBValidKey;
    private store: FakeObjectStore;
    private keys: IDBValidKey[];
    private index: number;
    private emit: (cursor: FakeCursor | null) => void;

    constructor(
        store: FakeObjectStore,
        keys: IDBValidKey[],
        index: number,
        emit: (cursor: FakeCursor | null) => void,
    ) {
        this.store = store;
        this.keys = keys;
        this.index = index;
        this.emit = emit;
        this.primaryKey = keys[index];
        this.value = store.records.get(keys[index]);
    }

    private moveTo(index: number): void {
        if (index < this.keys.length) {
            this.index = index;
            this.primaryKey = this.keys[index];
            this.value = this.store.records.get(this.keys[index]);
            queueMicrotask(() => this.emit(this));
        } else {
            queueMicrotask(() => this.emit(null));
        }
    }

    continue(): void {
        this.moveTo(this.index + 1);
    }

    advance(count: number): void {
        this.moveTo(this.index + count);
    }
}

class FakeObjectStore {
    name: string;
    records: Map<IDBValidKey, Value> = new Map();

    constructor(name: string) {
        this.name = name;
    }

    get(key: IDBValidKey): FakeRequest<Value> {
        const request = new FakeRequest<Value>();
        queueMicrotask(() => request.succeed(this.records.get(key)));
        return request;
    }

    put(value: Value, key: IDBValidKey): FakeRequest<IDBValidKey> {
        const request = new FakeRequest<IDBValidKey>();
        queueMicrotask(() => {
            this.records.set(key, value);
            request.succeed(key);
        });
        return request;
    }

    delete(key: IDBValidKey): FakeRequest<undefined> {
        const request = new FakeRequest<undefined>();
        queueMicrotask(() => {
            this.records.delete(key);
            request.succeed(undefined);
        });
        return request;
    }

    openCursor(): FakeRequest<FakeCursor | null> {
        const request = new FakeRequest<FakeCursor | null>();
        queueMicrotask(() => {
            const keys = Array.from(this.records.keys());
            if (keys.length === 0) {
                request.succeed(null);
                return;
            }
            const emit = (cursor: FakeCursor | null) => {
                request.result = cursor;
                request.onsuccess?.({ target: request });
            };
            emit(new FakeCursor(this, keys, 0, emit));
        });
        return request;
    }
}

class FakeTransaction {
    stores: Map<string, FakeObjectStore> = new Map();

    constructor(names: string[], db: FakeDatabase) {
        for (const name of names) {
            const store = db.stores.get(name);
            if (store) {
                this.stores.set(name, store);
            }
        }
    }

    objectStore(name: string): FakeObjectStore {
        const store = this.stores.get(name);
        if (!store) {
            throw new Error(`objectStore "${name}" not found`);
        }
        return store;
    }
}

class FakeDatabase {
    name: string;
    version: number;
    stores: Map<string, FakeObjectStore> = new Map();
    objectStoreNames = {
        contains: (name: string) => this.stores.has(name),
    };
    closed = false;

    constructor(name: string, version = 1) {
        this.name = name;
        this.version = version;
    }

    transaction(names: string[], _mode: string): FakeTransaction {
        return new FakeTransaction(names, this);
    }

    createObjectStore(name: string): FakeObjectStore {
        if (this.stores.has(name)) {
            throw new Error(`objectStore "${name}" already exists`);
        }
        const store = new FakeObjectStore(name);
        this.stores.set(name, store);
        return store;
    }

    close(): void {
        this.closed = true;
    }
}

export interface FakeIndexedDB {
    databases: Map<string, FakeDatabase>;
    /** If set, the next `open` rejects with this value (connection failure). */
    failNextOpen: unknown;
    open(name: string, version?: number): FakeRequest<FakeDatabase>;
    reset(): void;
}

export function createFakeIndexedDB(): FakeIndexedDB {
    const databases = new Map<string, FakeDatabase>();

    const fake: FakeIndexedDB = {
        databases,
        failNextOpen: undefined,

        open(name: string, version?: number) {
            const request = new FakeRequest<FakeDatabase>();

            queueMicrotask(() => {
                if (fake.failNextOpen !== undefined) {
                    request.fail(fake.failNextOpen);
                    fake.failNextOpen = undefined;
                    return;
                }

                const existing = databases.get(name);
                if (!existing) {
                    const created = new FakeDatabase(name, version ?? 1);
                    databases.set(name, created);
                    queueMicrotask(() => {
                        request.result = created;
                        const upgradeEvent = {
                            target: { result: created },
                            oldVersion: 0,
                        };
                        // @ts-expect-error - onupgradeneeded is set dynamically by callers
                        request.onupgradeneeded?.(upgradeEvent);
                        request.onsuccess?.({ target: request });
                    });
                    return;
                }

                if (version !== undefined && version > existing.version) {
                    const oldVersion = existing.version;
                    existing.version = version;
                    queueMicrotask(() => {
                        request.result = existing;
                        const upgradeEvent = {
                            target: { result: existing },
                            oldVersion,
                        };
                        // @ts-expect-error - onupgradeneeded is set dynamically by callers
                        request.onupgradeneeded?.(upgradeEvent);
                        request.onsuccess?.({ target: request });
                    });
                    return;
                }

                request.result = existing;
                request.onsuccess?.({ target: request });
            });

            return request;
        },

        reset() {
            databases.clear();
            fake.failNextOpen = undefined;
        },
    };

    return fake;
}

/**
 * Install the fake as `window.indexedDB` for the duration of the test,
 * returning it so the test can drive failure scenarios.
 */
export function installFakeIndexedDB(): FakeIndexedDB {
    const fake = createFakeIndexedDB();
    Object.defineProperty(window, "indexedDB", {
        value: fake,
        configurable: true,
        writable: true,
    });
    return fake;
}
