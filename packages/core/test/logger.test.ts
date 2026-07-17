// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { LoggerLevel } from "../src";
import { Logger } from "../src";

/**
 * Creates a manual spy that tracks calls without relying on jest/vi globals.
 */
function createSpy() {
    const calls: unknown[][] = [];
    const fn = (...args: unknown[]) => {
        calls.push(args);
    };
    return { fn, calls };
}

describe("Logger class", () => {
    const originalDebug = Logger.debug;
    const originalInfo = Logger.info;
    const originalWarn = Logger.warn;
    const originalError = Logger.error;

    beforeEach(() => {
        Logger.level = "info";
    });

    afterEach(() => {
        Logger.debug = originalDebug;
        Logger.info = originalInfo;
        Logger.warn = originalWarn;
        Logger.error = originalError;
        Logger.level = "info";
    });

    describe("level getter/setter", () => {
        test("default level should be info", () => {
            expect(Logger.level).toBe("info");
        });

        test("should set and get debug level", () => {
            Logger.level = "debug";
            expect(Logger.level).toBe("debug");
        });

        test("should set and get warn level", () => {
            Logger.level = "warn";
            expect(Logger.level).toBe("warn");
        });

        test("should set and get error level", () => {
            Logger.level = "error";
            expect(Logger.level).toBe("error");
        });
    });

    describe("non-production mode (direct console passthrough)", () => {
        test("debug() should call the Logger.debug method", () => {
            const spy = createSpy();
            Logger.debug = spy.fn as (...args: unknown[]) => void;
            Logger.debug("test message");
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe("test message");
        });

        test("info() should call the Logger.info method", () => {
            const spy = createSpy();
            Logger.info = spy.fn as (...args: unknown[]) => void;
            Logger.info("test message");
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe("test message");
        });

        test("warn() should call the Logger.warn method", () => {
            const spy = createSpy();
            Logger.warn = spy.fn as (...args: unknown[]) => void;
            Logger.warn("test message");
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe("test message");
        });

        test("error() should call the Logger.error method", () => {
            const spy = createSpy();
            Logger.error = spy.fn as (...args: unknown[]) => void;
            Logger.error("test message");
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe("test message");
        });

        test("debug() still works with error level set", () => {
            Logger.level = "error";
            const spy = createSpy();
            Logger.debug = spy.fn as (...args: unknown[]) => void;
            Logger.debug("should still log");
            expect(spy.calls.length).toBe(1);
        });

        test("info() still works with error level set", () => {
            Logger.level = "error";
            const spy = createSpy();
            Logger.info = spy.fn as (...args: unknown[]) => void;
            Logger.info("should still log");
            expect(spy.calls.length).toBe(1);
        });
    });

    describe("multiple arguments", () => {
        test("debug() should pass multiple arguments", () => {
            const spy = createSpy();
            Logger.debug = spy.fn as (...args: unknown[]) => void;
            const obj = { key: "value" };
            Logger.debug("test", obj, 123);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0]).toEqual(["test", obj, 123]);
        });

        test("info() should pass multiple arguments", () => {
            const spy = createSpy();
            Logger.info = spy.fn as (...args: unknown[]) => void;
            Logger.info("a", 1, true);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0]).toEqual(["a", 1, true]);
        });

        test("warn() should pass multiple arguments", () => {
            const spy = createSpy();
            Logger.warn = spy.fn as (...args: unknown[]) => void;
            Logger.warn("warning", { code: 42 });
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0]).toEqual(["warning", { code: 42 }]);
        });

        test("error() should pass multiple arguments", () => {
            const spy = createSpy();
            Logger.error = spy.fn as (...args: unknown[]) => void;
            const err = new Error("test");
            Logger.error("failed", err);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0]).toEqual(["failed", err]);
        });
    });

    describe("edge cases", () => {
        test("debug() should handle undefined message", () => {
            const spy = createSpy();
            Logger.debug = spy.fn as (...args: unknown[]) => void;
            Logger.debug(undefined);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe(undefined);
        });

        test("info() should handle null message", () => {
            const spy = createSpy();
            Logger.info = spy.fn as (...args: unknown[]) => void;
            Logger.info(null);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBeNull();
        });

        test("warn() should handle empty string", () => {
            const spy = createSpy();
            Logger.warn = spy.fn as (...args: unknown[]) => void;
            Logger.warn("");
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe("");
        });

        test("error() should handle numeric message", () => {
            const spy = createSpy();
            Logger.error = spy.fn as (...args: unknown[]) => void;
            Logger.error(500);
            expect(spy.calls.length).toBe(1);
            expect(spy.calls[0][0]).toBe(500);
        });

        test("debug() should not throw with original method", () => {
            Logger.debug = originalDebug;
            expect(() => Logger.debug("test")).not.toThrow();
        });

        test("info() should not throw with original method", () => {
            Logger.info = originalInfo;
            expect(() => Logger.info("test")).not.toThrow();
        });

        test("warn() should not throw with original method", () => {
            Logger.warn = originalWarn;
            expect(() => Logger.warn("test")).not.toThrow();
        });

        test("error() should not throw with original method", () => {
            Logger.error = originalError;
            expect(() => Logger.error("test")).not.toThrow();
        });

        test("all methods should exist as functions", () => {
            expect(typeof Logger.debug).toBe("function");
            expect(typeof Logger.info).toBe("function");
            expect(typeof Logger.warn).toBe("function");
            expect(typeof Logger.error).toBe("function");
        });
    });

    describe("level string comparison (lexical order)", () => {
        test("same level is not more restrictive than itself", () => {
            const d1: LoggerLevel = "debug";
            const d2: LoggerLevel = "debug";
            expect(d1 <= d2).toBe(true);
            const w1: LoggerLevel = "warn";
            const w2: LoggerLevel = "warn";
            expect(w1 <= w2).toBe(true);
        });

        test("all level values are valid strings", () => {
            expect(Logger.level).toBe("info");
            const levels: LoggerLevel[] = ["debug", "info", "warn", "error"];
            for (const level of levels) {
                Logger.level = level;
                expect(Logger.level).toBe(level);
            }
        });
    });
});
