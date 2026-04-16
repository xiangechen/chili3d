// IndexedDB-backed chat transcript store, keyed by chili3d document id.
//
// Same-origin iframes share the page's IndexedDB, so we can open our own DB
// here without involving @chili3d/storage. Each document gets one transcript;
// overwriting on save is fine because the only mutation is append.

import type { ModelMessage } from "ai";

const DB_NAME = "chili3d-ai-chat";
const DB_VERSION = 1;
const STORE = "transcripts";

export const SCRATCH_DOC_ID = "__scratch__";

export interface ChatRecord {
    docId: string;
    messages: ModelMessage[];
    updatedAt: number;
}

// One-shot nuke for transcripts written before the ModelMessage-shape fix.
// Bump WIPE_TOKEN to trigger another wipe.
const WIPE_TOKEN = "2026-04-capture-view";
const WIPE_FLAG_KEY = "chili3d-ai-chat.wiped";

async function deleteDatabase(): Promise<void> {
    await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        // Resolve in all cases — a failed wipe shouldn't break the app.
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = (async () => {
        if (localStorage.getItem(WIPE_FLAG_KEY) !== WIPE_TOKEN) {
            await deleteDatabase();
            localStorage.setItem(WIPE_FLAG_KEY, WIPE_TOKEN);
        }
        return await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: "docId" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
        });
    })();
    return dbPromise;
}

async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
    });
}

export async function loadChat(docId: string): Promise<ModelMessage[]> {
    try {
        const record = await withStore("readonly", (s) => s.get(docId) as IDBRequest<ChatRecord | undefined>);
        return record?.messages ?? [];
    } catch (e) {
        console.warn("ai-chat: loadChat failed", e);
        return [];
    }
}

export async function saveChat(docId: string, messages: ModelMessage[]): Promise<void> {
    try {
        const record: ChatRecord = { docId, messages, updatedAt: Date.now() };
        await withStore("readwrite", (s) => s.put(record));
    } catch (e) {
        console.warn("ai-chat: saveChat failed", e);
    }
}

export async function clearChat(docId: string): Promise<void> {
    try {
        await withStore("readwrite", (s) => s.delete(docId));
    } catch (e) {
        console.warn("ai-chat: clearChat failed", e);
    }
}
