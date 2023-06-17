// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IStorage, Logger } from "chili-core";

export class IndexedDBStorage implements IStorage {
    readonly version: number = 1;

    async get(database: string, table: string, id: string): Promise<any> {
        let db = await IndexedDBStorage.open(database, table, this.version);
        return await IndexedDBStorage.get(db, table, id).finally(() => db.close());
    }

    async put(database: string, table: string, id: string, value: any): Promise<boolean> {
        let db = await IndexedDBStorage.open(database, table, this.version);
        return await IndexedDBStorage.put(db, table, id, value).finally(() => db.close());
    }

    async delete(database: string, table: string, id: string): Promise<boolean> {
        let db = await IndexedDBStorage.open(database, table, this.version);
        return await IndexedDBStorage.delete(db, table, id).finally(() => db.close());
    }

    async page(database: string, table: string, page: number): Promise<any[]> {
        let db = await IndexedDBStorage.open(database, table, this.version);
        return await IndexedDBStorage.getPage(db, table, page).finally(() => db.close());
    }

    private static open(
        dbName: string,
        storeName: string,
        version: number,
        options?: IDBObjectStoreParameters
    ): Promise<IDBDatabase> {
        let request = window.indexedDB.open(dbName, version);
        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
                Logger.info(`open ${dbName} success`);
                resolve((e.target as unknown as any).result);
            };

            request.onerror = (e) => {
                Logger.error(`open ${dbName} error`);
                reject(e);
            };

            request.onupgradeneeded = (e) => {
                Logger.info(`upgrade ${dbName}`);
                let db: IDBDatabase = (e.target as unknown as any).result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, options);
                }
            };
        });
    }

    private static get(db: IDBDatabase, storeName: string, key: string) {
        let request = db.transaction([storeName], "readonly").objectStore(storeName).get(key);

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
        count: number = 20
    ): Promise<any[]> {
        let result: any[] = [];
        let index = 0;
        let isAdvanced = false;

        let request = db.transaction([storeName], "readonly").objectStore(storeName).openCursor();

        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
                let cursor: IDBCursorWithValue = (e.target as unknown as any).result;
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
        let request = db.transaction([storeName], "readwrite").objectStore(storeName).delete(key);

        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
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
        let request = db.transaction([storeName], "readwrite").objectStore(storeName).put(value, key);

        return new Promise((resolve, reject) => {
            request.onsuccess = (e) => {
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
