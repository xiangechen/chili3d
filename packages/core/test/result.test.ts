// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result, ResultEqualityComparer } from "../src";

describe("Result", () => {
    describe("ok", () => {
        test("should create ok result with string value", () => {
            const r = Result.ok("hello");
            expect(r.isOk).toBeTruthy();
            expect(r.value).toBe("hello");
        });

        test("should create ok result with number value", () => {
            const r = Result.ok(42);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toBe(42);
        });

        test("should create ok result with boolean value", () => {
            const r = Result.ok(true);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toBeTruthy();
        });

        test("should create ok result with undefined value", () => {
            const r = Result.ok(undefined);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toBeUndefined();
        });

        test("should create ok result with null value", () => {
            const r = Result.ok(null);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toBeNull();
        });

        test("should create ok result with object value", () => {
            const obj = { name: "test", count: 42 };
            const r = Result.ok(obj);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toEqual(obj);
        });

        test("should create ok result with array value", () => {
            const arr = [1, 2, 3];
            const r = Result.ok(arr);
            expect(r.isOk).toBeTruthy();
            expect(r.value).toEqual(arr);
        });
    });

    describe("err", () => {
        test("should create error result with string error", () => {
            const r = Result.err("something went wrong");
            expect(r.isOk).toBeFalsy();
            expect(r.error).toBe("something went wrong");
        });

        test("should create error result with custom error type", () => {
            const r = Result.err<{ code: number; message: string }>({ code: 404, message: "not found" });
            expect(r.isOk).toBeFalsy();
            expect(r.error).toEqual({ code: 404, message: "not found" });
        });

        test("should create error result with number error", () => {
            const r = Result.err(500);
            expect(r.isOk).toBeFalsy();
            expect(r.error).toBe(500);
        });
    });

    describe("isOkAnd", () => {
        test("should return true when ok and predicate matches", () => {
            const r = Result.ok(10);
            expect(r.isOkAnd((v) => v > 5)).toBeTruthy();
        });

        test("should return false when ok but predicate fails", () => {
            const r = Result.ok(3);
            expect(r.isOkAnd((v) => v > 5)).toBeFalsy();
        });

        test("should return false when result is error", () => {
            const r = Result.err("error");
            expect(r.isOkAnd((v) => true)).toBeFalsy();
        });

        test("should work with object values", () => {
            const r = Result.ok({ active: true });
            expect(r.isOkAnd((v) => v.active)).toBeTruthy();
        });
    });

    describe("isErrorOr", () => {
        test("should return true when result is error", () => {
            const r = Result.err("error");
            expect(r.isErrorOr((v) => false)).toBeTruthy();
        });

        test("should return true when ok and predicate matches", () => {
            const r = Result.ok(10);
            expect(r.isErrorOr((v) => v > 5)).toBeTruthy();
        });

        test("should return false when ok and predicate fails", () => {
            const r = Result.ok(3);
            expect(r.isErrorOr((v) => v > 5)).toBeFalsy();
        });
    });

    describe("parse", () => {
        test("should convert ok result to error result preserving error", () => {
            const r = Result.ok("value") as Result<string, string>;
            const parsed = r.parse<number>();
            expect(parsed.isOk).toBeFalsy();
        });

        test("should preserve error value when parsing", () => {
            const r = Result.err<string>("custom error");
            const parsed = r.parse<string>();
            expect(parsed.isOk).toBeFalsy();
            expect(parsed.error).toBe("custom error");
        });
    });

    describe("value property", () => {
        test("should return value when result is ok", () => {
            const r = Result.ok(42);
            expect(r.value).toBe(42);
        });

        test("should return undefined when accessing value on error result", () => {
            const r = Result.err("error");
            // value returns undefined for error results (with warning in Logger.warn)
            expect(r.value).toBeUndefined();
        });

        test("should return undefined when accessing error on ok result", () => {
            const r = Result.ok(42);
            // error returns undefined for ok results (with warning in Logger.warn)
            expect(r.error).toBeUndefined();
        });
    });

    describe("unchecked", () => {
        test("should return value when result is ok", () => {
            const r = Result.ok(42);
            expect(r.unchecked()).toBe(42);
        });

        test("should return undefined when result is error", () => {
            const r = Result.err("error");
            expect(r.unchecked()).toBeUndefined();
        });

        test("should return object value when ok", () => {
            const obj = { key: "value" };
            const r = Result.ok(obj);
            expect(r.unchecked()).toBe(obj);
        });
    });
});

describe("ResultEqualityComparer", () => {
    describe("default equality", () => {
        test("should return true for two ok results with same value", () => {
            const comparer = new ResultEqualityComparer<number>();
            const r1 = Result.ok(42);
            const r2 = Result.ok(42);
            expect(comparer.equals(r1, r2)).toBeTruthy();
        });

        test("should return false for two ok results with different values", () => {
            const comparer = new ResultEqualityComparer<number>();
            const r1 = Result.ok(1);
            const r2 = Result.ok(2);
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });

        test("should return false when left is error", () => {
            const comparer = new ResultEqualityComparer<number>();
            const r1 = Result.err("error");
            const r2 = Result.ok(42);
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });

        test("should return false when right is error", () => {
            const comparer = new ResultEqualityComparer<number>();
            const r1 = Result.ok(42);
            const r2 = Result.err("error");
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });

        test("should return false when both are error", () => {
            const comparer = new ResultEqualityComparer<number>();
            const r1 = Result.err("error1");
            const r2 = Result.err("error2");
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });

        test("should use strict equality for objects", () => {
            const comparer = new ResultEqualityComparer<{ name: string }>();
            const obj = { name: "test" };
            const r1 = Result.ok(obj);
            const r2 = Result.ok(obj); // same reference
            expect(comparer.equals(r1, r2)).toBeTruthy();
        });

        test("should return false for different object references with same shape", () => {
            const comparer = new ResultEqualityComparer<{ name: string }>();
            const r1 = Result.ok({ name: "test" });
            const r2 = Result.ok({ name: "test" }); // different reference
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });
    });

    describe("custom equality", () => {
        test("should use custom equality function", () => {
            const comparer = new ResultEqualityComparer<{ id: number }>((a, b) => a.id === b.id);
            const r1 = Result.ok({ id: 1, name: "a" });
            const r2 = Result.ok({ id: 1, name: "b" });
            expect(comparer.equals(r1, r2)).toBeTruthy();
        });

        test("should use custom equality function returning false", () => {
            const comparer = new ResultEqualityComparer<{ id: number }>((a, b) => a.id === b.id);
            const r1 = Result.ok({ id: 1 });
            const r2 = Result.ok({ id: 2 });
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });

        test("should still return false when error with custom equality", () => {
            const comparer = new ResultEqualityComparer<number>(
                (_a, _b) => true, // always equal for comparison
            );
            const r1 = Result.err("error");
            const r2 = Result.ok(42);
            expect(comparer.equals(r1, r2)).toBeFalsy();
        });
    });
});
