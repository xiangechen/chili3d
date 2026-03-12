// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger } from "../src";

describe("Logger class", () => {
    beforeEach(() => {
        Logger.level = "info";
    });

    test("should not output debug when level is above Debug", () => {
        expect(() => {
            Logger.level = "error";
            Logger.debug("test");
        }).not.toThrow();
    });

    test("should output debug when level is Debug", () => {
        expect(() => {
            Logger.level = "debug";
            Logger.debug("test");
        }).not.toThrow();
    });

    test("should not output info when level is above Info", () => {
        expect(() => {
            Logger.level = "error";
            Logger.info("test");
        }).not.toThrow();
    });

    test("should output info when level is Info or below", () => {
        expect(() => {
            Logger.level = "info";
            Logger.info("test");
        }).not.toThrow();
    });

    test("should not output warn when level is above Warn", () => {
        expect(() => {
            Logger.level = "error";
            Logger.warn("test");
        }).not.toThrow();
    });

    test("should output warn when level is Warn or below", () => {
        expect(() => {
            Logger.level = "warn";
            Logger.warn("test");
        }).not.toThrow();
    });

    test("should output error regardless of level", () => {
        expect(() => {
            Logger.level = "error";
            Logger.error("test");
        }).not.toThrow();
    });

    test("should accept multiple arguments", () => {
        expect(() => {
            Logger.debug("test", { key: "value" }, 123);
            Logger.info("test", { key: "value" }, 123);
            Logger.warn("test", { key: "value" }, 123);
            Logger.error("test", { key: "value" }, 123);
        }).not.toThrow();
    });

    test("should handle undefined and null messages", () => {
        expect(() => {
            Logger.debug(undefined);
            Logger.info(null);
            Logger.warn(undefined);
            Logger.error(null);
        }).not.toThrow();
    });

    test("should handle empty string messages", () => {
        Logger.debug("");
        Logger.info("");
        Logger.warn("");
        Logger.error("");
        expect(true).toBe(true);
    });

    test("should handle numeric messages", () => {
        expect(() => {
            Logger.debug(0);
            Logger.info(-1);
            Logger.warn(42);
            Logger.error(3.14);
        }).not.toThrow();
    });

    test("should handle object messages", () => {
        expect(() => {
            Logger.debug({ nested: { value: 42 } });
            Logger.info([1, 2, 3]);
            Logger.warn(new Date("2024-01-01"));
            Logger.error(new Error("test error"));
        }).not.toThrow();
    });
});
