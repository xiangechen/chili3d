// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDisposable, isDisposable } from "../src";

describe("IDisposable interface", () => {
    test("should define dispose method", () => {
        const obj: IDisposable = {
            dispose() {},
        };
        expect(typeof obj.dispose).toBe("function");
        expect(obj.dispose.length).toBe(0);
    });
});

describe("isDisposable", () => {
    test("should return true for object with dispose method", () => {
        const obj = {
            dispose() {},
        };
        expect(isDisposable(obj)).toBe(true);
    });

    test("should return false for null", () => {
        expect(isDisposable(null)).toBe(false);
    });

    test("should return false for undefined", () => {
        expect(isDisposable(undefined)).toBe(false);
    });

    test("should return false for primitive values", () => {
        expect(isDisposable("string")).toBe(false);
        expect(isDisposable(123)).toBe(false);
        expect(isDisposable(true)).toBe(false);
    });

    test("should return false for object without dispose method", () => {
        const obj = { foo: "bar" };
        expect(isDisposable(obj)).toBe(false);
    });

    test("should return false for object with dispose property that is not a function", () => {
        const obj = { dispose: "not a function" };
        expect(isDisposable(obj)).toBe(false);
    });

    test("should return false for object with dispose method that has parameters", () => {
        const obj = {
            dispose(arg: string) {},
        };
        expect(isDisposable(obj)).toBe(false);
    });

    test("should return true for class instance with dispose method", () => {
        class TestDisposable implements IDisposable {
            disposed = false;
            dispose() {
                this.disposed = true;
            }
        }
        const instance = new TestDisposable();
        expect(isDisposable(instance)).toBe(true);
    });
});
