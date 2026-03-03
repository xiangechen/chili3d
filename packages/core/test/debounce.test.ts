// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { debounce } from "../src";

describe("debounce function", () => {
    test("should return a function", () => {
        const func = () => {};
        const result = debounce(func, 100);
        expect(typeof result).toBe("function");
    });

    test("should delay function execution", async () => {
        let called = false;
        const func = () => {
            called = true;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc();
        expect(called).toBe(false);

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(called).toBe(true);
    });

    test("should call function with correct arguments", async () => {
        let receivedArgs: any[] = [];
        const func = (...args: any[]) => {
            receivedArgs = args;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc("arg1", 123, { key: "value" });

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(receivedArgs).toEqual(["arg1", 123, { key: "value" }]);
    });

    test("should only call function once when called multiple times within delay period", async () => {
        let callCount = 0;
        const func = () => {
            callCount++;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc();
        debouncedFunc();
        debouncedFunc();

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(callCount).toBe(1);
    });

    test("should call function again after delay when called multiple times", async () => {
        let callCount = 0;
        const func = () => {
            callCount++;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc();
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(callCount).toBe(1);

        debouncedFunc();
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(callCount).toBe(2);
    });

    test("should reset timer on each call", async () => {
        let callCount = 0;
        const func = () => {
            callCount++;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(callCount).toBe(0);

        debouncedFunc();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(callCount).toBe(0);

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(callCount).toBe(1);
    });

    test("should handle zero delay", async () => {
        let callCount = 0;
        const func = () => {
            callCount++;
        };
        const debouncedFunc = debounce(func, 0);

        debouncedFunc();
        debouncedFunc();

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(callCount).toBe(1);
    });

    test("should handle large delay", async () => {
        let called = false;
        const func = () => {
            called = true;
        };
        const debouncedFunc = debounce(func, 200);

        debouncedFunc();
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(called).toBe(false);

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(called).toBe(true);
    });

    test("should work with no arguments function", async () => {
        let called = false;
        const func = () => {
            called = true;
        };
        const debouncedFunc = debounce(func, 50);

        debouncedFunc();

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(called).toBe(true);
    });

    test("should handle concurrent debounced functions", async () => {
        let callCount1 = 0;
        let callCount2 = 0;
        const func1 = () => {
            callCount1++;
        };
        const func2 = () => {
            callCount2++;
        };
        const debouncedFunc1 = debounce(func1, 50);
        const debouncedFunc2 = debounce(func2, 50);

        debouncedFunc1();
        debouncedFunc2();

        await new Promise((resolve) => setTimeout(resolve, 30));

        debouncedFunc1();
        debouncedFunc2();

        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(callCount1).toBe(1);
        expect(callCount2).toBe(1);
    });
});
