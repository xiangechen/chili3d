// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage } from "../src";
import { mockLocalStorage } from "./localStorageMock";

describe("ObjectStorage class", () => {
    let localStorageMock: any;

    beforeEach(() => {
        localStorageMock = mockLocalStorage();
    });

    afterEach(() => {
        Object.defineProperty(global, "localStorage", {
            value: undefined,
            writable: true,
        });
    });

    describe("constructor", () => {
        test("should create storage with correct prefix", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            expect(storage).toBeDefined();
        });
    });

    describe("setValue", () => {
        test("should store object value", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const value = { key: "value", nested: { data: 123 } };
            storage.setValue("testKey", value);

            const result = storage.value<object>("testKey");
            expect(result).toEqual(value);
        });

        test("should store primitive values as wrapped objects", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            storage.setValue("stringKey", { value: "test string" });
            expect(storage.value<{ value: string }>("stringKey")?.value).toBe("test string");

            storage.setValue("numberKey", { value: 42 });
            expect(storage.value<{ value: number }>("numberKey")?.value).toBe(42);

            storage.setValue("boolKey", { value: true });
            expect(storage.value<{ value: boolean }>("boolKey")?.value).toBe(true);
        });

        test("should store array values", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const arr = [1, 2, 3, "four", { five: 5 }];
            storage.setValue("arrayKey", { value: arr });
            expect(storage.value<{ value: number[] }>("arrayKey")?.value).toEqual(arr);
        });
    });

    describe("value", () => {
        test("should return undefined for non-existent key", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const result = storage.value<string>("nonExistent");
            expect(result).toBeUndefined();
        });

        test("should return default value for non-existent key", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const defaultValue = { default: true };
            const result = storage.value<object>("nonExistent", defaultValue);
            expect(result).toEqual(defaultValue);
        });

        test("should return stored value", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const value = { key: "stored" };
            storage.setValue("existingKey", value);
            expect(storage.value<object>("existingKey")).toEqual(value);
        });

        test("should return default value for invalid JSON", () => {
            localStorageMock["test-org.test-app.invalidKey"] = "invalid json {{{{";
            const storage = new ObjectStorage("test-org", "test-app");
            const result = storage.value<object>("invalidKey", { default: true });
            expect(result).toEqual({ default: true });
        });
    });

    describe("remove", () => {
        test("should remove existing key", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            storage.setValue("toRemove", { value: "value" });
            expect(storage.value<{ value: string }>("toRemove")?.value).toBe("value");

            storage.remove("toRemove");
            expect(storage.value<string>("toRemove")).toBeUndefined();
        });

        test("should handle removing non-existent key", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            storage.remove("nonExistent");
            expect(storage.value<string>("nonExistent")).toBeUndefined();
        });
    });

    describe("clear", () => {
        test("should clear all keys with correct prefix", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            storage.setValue("key1", { value: "value1" });
            storage.setValue("key2", { value: "value2" });
            storage.setValue("key3", { value: "value3" });

            expect(storage.value<{ value: string }>("key1")?.value).toBe("value1");
            expect(storage.value<{ value: string }>("key2")?.value).toBe("value2");
            expect(storage.value<{ value: string }>("key3")?.value).toBe("value3");

            storage.clear();

            expect(storage.value<{ value: string }>("key1")?.value).toBeUndefined();
            expect(storage.value<{ value: string }>("key2")?.value).toBeUndefined();
            expect(storage.value<{ value: string }>("key3")?.value).toBeUndefined();
            expect(storage.value<{ value: string }>("key1", { value: "default" })?.value).toBe("default");
        });

        test("should not clear keys with different prefix", () => {
            const storage1 = new ObjectStorage("test-org", "test-app");
            const storage2 = new ObjectStorage("other-org", "test-app");

            storage1.setValue("sharedKey", { value: "storageValue" });
            storage2.setValue("sharedKey", { value: "otherValue" });

            storage1.clear();

            expect(storage1.value<{ value: string }>("sharedKey")?.value).toBeUndefined();
            expect(storage2.value<{ value: string }>("sharedKey")?.value).toBe("otherValue");
        });
    });

    describe("default instance", () => {
        test("should have a default instance", () => {
            expect(ObjectStorage.default).toBeDefined();
            expect(ObjectStorage.default).toBeInstanceOf(ObjectStorage);
        });
    });

    describe("complex scenarios", () => {
        test("should handle nested objects", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const complexValue = {
                level1: {
                    level2: {
                        level3: [1, 2, 3, { deep: "value" }],
                    },
                },
            };
            storage.setValue("complex", complexValue);
            expect(storage.value<object>("complex")).toEqual(complexValue);
        });

        test("should handle special characters in values", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            const specialValue = {
                quotes: '"test"',
                newline: "line1\nline2",
                unicode: "你好世界 🌍",
            };
            storage.setValue("special", specialValue);
            expect(storage.value<object>("special")).toEqual(specialValue);
        });

        test("should handle null values", () => {
            const storage = new ObjectStorage("test-org", "test-app");
            storage.setValue("nullTest", { value: null });
            expect(storage.value<{ value: null }>("nullTest")?.value).toBeNull();
        });
    });
});
