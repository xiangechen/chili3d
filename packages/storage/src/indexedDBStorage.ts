// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IStorage, Logger } from "@chili3d/core";

export class IndexedDBStorage implements IStorage {
    async createDBIfNeeded(database: string, tables: string[]): Promise<void> {
        let db = await this.openOrCreateDB(database, tables);
        let shouldUpgrade = false;
        for (const table of tables) {
            if (!db.objectStoreNames.contains(table)) {
                shouldUpgrade = true;
                break;
            }
        }
        if (shouldUpgrade) {
            const newVersion = db.version + 1;
            db.close();
            db = await this.openOrCreateDB(database, tables, newVersion);
        }
        db.close();
    }

    private openOrCreateDB(database: string, tables: string[], version?: number): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(database, version);
            request.onsuccess = (e) => {
                Logger.info(`open ${database} success`);
                resolve((e.target as unknown as any).result);
            };
            request.onerror = (e) => {
                Logger.error(`open ${database} error`);
                reject(e);
            };
            request.onupgradeneeded = (e) => {
                Logger.info(`upgrade ${database}`);
                const db: IDBDatabase = (e.target as unknown as any).result;
                tables.forEach((store) => {
                    if (!db.objectStoreNames.contains(store)) {
                        Logger.info(`create store ${store}`);
                        db.createObjectStore(store);
                    }
                });
            };
        });
    }

    async get(database: string, table: string, id: string): Promise<any> {
        const db = await this.open(database);
        return Promise.try(IndexedDBStorage.get, db, table, id).finally(() => {
            db.close();
        });
    }

    async put(database: string, table: string, id: string, value: any): Promise<boolean> {
        const db = await this.open(database);
        return Promise.try(IndexedDBStorage.put, db, table, id, value).finally(() => {
            db.close();
        });
    }

    async delete(database: string, table: string, id: string): Promise<boolean> {
        const db = await this.open(database);
        return Promise.try(IndexedDBStorage.delete, db, table, id).finally(() => {
            db.close();
        });
    }

    async page(database: string, table: string, page: number): Promise<any[]> {
        const db = await this.open(database);
        return Promise.try(IndexedDBStorage.getPage, db, table, page).finally(() => {
            db.close();
        });
    }

    private open(dbName: string): Promise<IDBDatabase> {
        const request = window.indexedDB.open(dbName);
        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
                Logger.info(`open ${dbName} success`);
                resolve((e.target as unknown as any).result);
            };

            request.onerror = (e) => {
                Logger.error(`open ${dbName} error`);
                reject(e);
            };
        });
    }

    private static get(db: IDBDatabase, storeName: string, key: string) {
        const request = db.transaction([storeName], "readonly").objectStore(storeName).get(key);
        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
                Logger.info(`${storeName} store get object success`);
                resolve((e.target as unknown as any).result);
            };
            request.onerror = (e) => {
                Logger.error(`${storeName} store get object error`);
                reject(e);
            };
        });
    }

    /**
     *
     * @param db IDBDatabase
     * @param storeName store name
     * @param page page, start with 0
     * @param count items per page
     * @returns
     */
    private static getPage(
        db: IDBDatabase,
        storeName: string,
        page: number,
        count: number = 20,
    ): Promise<any[]> {
        const result: any[] = [];
        let index = 0;
        let isAdvanced = false;
        const request = db.transaction([storeName], "readonly").objectStore(storeName).openCursor();

        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
                const cursor: IDBCursorWithValue = (e.target as unknown as any).result;
                if (!cursor || index === count) {
                    Logger.info(`${storeName} store get objects success`);
                    resolve(result);
                } else if (!isAdvanced && page * count > 0) {
                    isAdvanced = true;
                    cursor.advance(page * count);
                } else {
                    result.push(cursor.value);
                    index++;
                    cursor.continue();
                }
            };
            request.onerror = (e) => {
                Logger.error(`${storeName} store get objects error`);
                reject(e);
            };
        });
    }

    private static delete(db: IDBDatabase, storeName: string, key: string): Promise<boolean> {
        const request = db.transaction([storeName], "readwrite").objectStore(storeName).delete(key);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                Logger.info(`${storeName} store delete object success`);
                resolve(true);
            };
            request.onerror = (e) => {
                Logger.error(`${storeName} store delete object error`);
                reject(e);
            };
        });
    }

    private static put(db: IDBDatabase, storeName: string, key: IDBValidKey, value: any): Promise<boolean> {
        const request = db.transaction([storeName], "readwrite").objectStore(storeName).put(value, key);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                Logger.info(`${storeName} store put object success`);
                resolve(true);
            };
            request.onerror = (e) => {
                Logger.error(`${storeName} store put object error`);
                reject(e);
            };
        });
    }
}
