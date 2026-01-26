// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Lazy } from "../src";

describe("Lazy class", () => {
    test("should create Lazy instance with factory", () => {
        const lazy = new Lazy(() => 42);
        expect(lazy).toBeDefined();
    });

    test("should call factory only once on first access", () => {
        let callCount = 0;
        const lazy = new Lazy(() => {
            callCount++;
            return 42;
        });

        expect(lazy.value).toBe(42);
        expect(callCount).toBe(1);

        expect(lazy.value).toBe(42);
        expect(callCount).toBe(1);

        expect(lazy.value).toBe(42);
        expect(callCount).toBe(1);
    });

    test("should return same value on multiple accesses", () => {
        let callCount = 0;
        const factory = () => {
            callCount++;
            return { id: Math.random() };
        };
        const lazy = new Lazy(factory);

        const value1 = lazy.value;
        const value2 = lazy.value;

        expect(value1).toEqual(value2);
        expect(callCount).toBe(1);
    });

    test("should work with different return types", () => {
        const stringLazy = new Lazy(() => "hello");
        expect(stringLazy.value).toBe("hello");

        const numberLazy = new Lazy(() => 123);
        expect(numberLazy.value).toBe(123);

        const objectLazy = new Lazy(() => ({ key: "value" }));
        expect(objectLazy.value).toEqual({ key: "value" });

        const arrayLazy = new Lazy(() => [1, 2, 3]);
        expect(arrayLazy.value).toEqual([1, 2, 3]);
    });

    test("should handle factory that returns undefined", () => {
        const lazy = new Lazy(() => undefined);
        expect(lazy.value).toBeUndefined();
    });

    test("should handle factory that returns null", () => {
        const lazy = new Lazy(() => null);
        expect(lazy.value).toBeNull();
    });

    test("should handle factory that returns false", () => {
        const lazy = new Lazy(() => false);
        expect(lazy.value).toBe(false);
    });

    test("should handle factory that returns 0", () => {
        const lazy = new Lazy(() => 0);
        expect(lazy.value).toBe(0);
    });

    test("should handle factory that returns empty string", () => {
        const lazy = new Lazy(() => "");
        expect(lazy.value).toBe("");
    });

    test("should preserve factory if value is falsy but defined", () => {
        let callCount = 0;
        const lazy = new Lazy(() => {
            callCount++;
            return 0;
        });

        expect(lazy.value).toBe(0);
        expect(callCount).toBe(1);

        expect(lazy.value).toBe(0);
        expect(callCount).toBe(1);
    });

    test("should work with complex object factory", () => {
        class TestClass {
            constructor(public value: number) {}
        }

        const lazy = new Lazy(() => new TestClass(42));
        const instance = lazy.value;

        expect(instance).toBeInstanceOf(TestClass);
        expect(instance.value).toBe(42);
    });

    test("should work with async factory", () => {
        const lazy = new Lazy(async () => "async result");
        expect(lazy.value).resolves.toBe("async result");
    });
});
