// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IndexedDBStorage } from "../src/indexedDBStorage";
import { installFakeIndexedDB } from "./fakeIndexedDB";

describe("IndexedDBStorage", () => {
    let storage: IndexedDBStorage;
    let fake: ReturnType<typeof installFakeIndexedDB>;

    beforeEach(() => {
        fake = installFakeIndexedDB();
        storage = new IndexedDBStorage();
    });

    afterEach(() => {
        fake.reset();
    });

    const DB = "testDB";
    const TABLE = "documents";

    describe("createDBIfNeeded", () => {
        test("should create database and stores when none exist", async () => {
            await storage.createDBIfNeeded(DB, [TABLE, "settings"]);

            const db = fake.databases.get(DB);
            expect(db).toBeDefined();
            expect(db!.objectStoreNames.contains(TABLE)).toBe(true);
            expect(db!.objectStoreNames.contains("settings")).toBe(true);
        });

        test("should upgrade version when a store is missing", async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
            const dbBefore = fake.databases.get(DB)!;
            const versionBefore = dbBefore.version;

            await storage.createDBIfNeeded(DB, [TABLE, "settings"]);

            const dbAfter = fake.databases.get(DB)!;
            expect(dbAfter.version).toBeGreaterThan(versionBefore);
            expect(dbAfter.objectStoreNames.contains("settings")).toBe(true);
        });

        test("should not upgrade when all stores already exist", async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
            const versionBefore = fake.databases.get(DB)!.version;

            await storage.createDBIfNeeded(DB, [TABLE]);

            expect(fake.databases.get(DB)!.version).toBe(versionBefore);
        });
    });

    describe("put and get", () => {
        beforeEach(async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
        });

        test("should store and retrieve a value by key", async () => {
            const ok = await storage.put(DB, TABLE, "id1", { name: "alpha" });
            expect(ok).toBe(true);

            const value = await storage.get(DB, TABLE, "id1");
            expect(value).toEqual({ name: "alpha" });
        });

        test("should overwrite an existing key", async () => {
            await storage.put(DB, TABLE, "id1", { v: 1 });
            await storage.put(DB, TABLE, "id1", { v: 2 });

            const value = await storage.get(DB, TABLE, "id1");
            expect(value).toEqual({ v: 2 });
        });

        test("should resolve to undefined for a missing key", async () => {
            const value = await storage.get(DB, TABLE, "missing");
            expect(value).toBeUndefined();
        });
    });

    describe("delete", () => {
        beforeEach(async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
            await storage.put(DB, TABLE, "id1", { name: "alpha" });
        });

        test("should remove an existing key and return true", async () => {
            const ok = await storage.delete(DB, TABLE, "id1");
            expect(ok).toBe(true);

            const value = await storage.get(DB, TABLE, "id1");
            expect(value).toBeUndefined();
        });

        test("should return true even when deleting a missing key", async () => {
            const ok = await storage.delete(DB, TABLE, "never-existed");
            expect(ok).toBe(true);
        });
    });

    describe("page", () => {
        beforeEach(async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
            for (let i = 0; i < 25; i += 1) {
                await storage.put(DB, TABLE, `key-${i}`, { index: i });
            }
        });

        test("should return the first page by default", async () => {
            const result = await storage.page(DB, TABLE, 0);
            expect(result).toHaveLength(20);
            expect(result[0]).toEqual({ index: 0 });
            expect(result[19]).toEqual({ index: 19 });
        });

        test("should return the requested page slice", async () => {
            const result = await storage.page(DB, TABLE, 1);
            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({ index: 20 });
            expect(result[4]).toEqual({ index: 24 });
        });

        test("should return empty array when page is beyond data", async () => {
            const result = await storage.page(DB, TABLE, 5);
            expect(result).toEqual([]);
        });

        test("should return empty array on empty store", async () => {
            await storage.createDBIfNeeded(DB, ["empty"]);
            const result = await storage.page(DB, "empty", 0);
            expect(result).toEqual([]);
        });
    });

    describe("error handling", () => {
        beforeEach(async () => {
            await storage.createDBIfNeeded(DB, [TABLE]);
        });

        test("should reject when opening the database fails", async () => {
            fake.failNextOpen = new Error("connection refused");

            await expect(storage.get(DB, TABLE, "id1")).rejects.toBeDefined();
        });

        test("should reject put when the database cannot be opened", async () => {
            fake.failNextOpen = new Error("disk full");

            await expect(storage.put(DB, TABLE, "id1", { a: 1 })).rejects.toBeDefined();
        });

        test("should reject delete when the database cannot be opened", async () => {
            fake.failNextOpen = new Error("locked");

            await expect(storage.delete(DB, TABLE, "id1")).rejects.toBeDefined();
        });

        test("should reject page when the database cannot be opened", async () => {
            fake.failNextOpen = new Error("locked");

            await expect(storage.page(DB, TABLE, 0)).rejects.toBeDefined();
        });

        test("should reject createDBIfNeeded when open fails", async () => {
            fake.failNextOpen = new Error("cannot init");

            await expect(storage.createDBIfNeeded(DB, [TABLE])).rejects.toBeDefined();
        });
    });
});
