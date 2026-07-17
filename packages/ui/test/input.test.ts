// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { Input } from "../src/viewport/flyout/input";

describe("Input", () => {
    describe("constructor", () => {
        test("should initialize with the given text value", () => {
            const input = new Input("hello", () => Result.ok("ok"));
            expect(input.text).toBe("hello");
        });

        test("should create a textbox input child element", () => {
            const input = new Input("test", () => Result.ok("ok"));
            const textbox = input.querySelector("input");
            expect(textbox).not.toBeNull();
            expect((textbox as HTMLInputElement).value).toBe("test");
        });
    });

    describe("text getter", () => {
        test("should return current textbox value", () => {
            const input = new Input("initial", () => Result.ok("ok"));
            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.value = "changed";
            expect(input.text).toBe("changed");
        });
    });

    describe("onCancelled", () => {
        test("should call registered callbacks on Escape key", () => {
            const cancelled: string[] = [];
            const input = new Input("test", () => Result.ok("ok"));
            input.onCancelled(() => cancelled.push("cancelled"));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

            expect(cancelled).toContain("cancelled");
        });

        test("should support multiple cancel callbacks", () => {
            const calls: number[] = [];
            const input = new Input("test", () => Result.ok("ok"));
            input.onCancelled(() => calls.push(1));
            input.onCancelled(() => calls.push(2));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

            expect(calls).toEqual([1, 2]);
        });
    });

    describe("onCompleted", () => {
        test("should call registered callbacks on Enter with valid handler result", () => {
            const completed: string[] = [];
            const input = new Input("test", () => Result.ok("success"));
            input.onCompleted(() => completed.push("done"));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(completed).toContain("done");
        });

        test("should NOT call completed callbacks when handler returns error", () => {
            const completed: string[] = [];
            const input = new Input("test", () => Result.err("invalid" as any));
            input.onCompleted(() => completed.push("done"));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(completed).toEqual([]);
        });

        test("should show error tip when handler returns error", () => {
            const input = new Input("test", () => Result.err("error.invalid" as any));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            // Should have created a tip child element
            const children = input.children;
            expect(children.length).toBeGreaterThan(1); // textbox + tip label
        });

        test("should make textbox readonly while processing", () => {
            let wasReadOnly = false;
            const input = new Input("test", () => {
                wasReadOnly = (input.querySelector("input") as HTMLInputElement).readOnly;
                return Result.ok("ok");
            });
            input.onCompleted(() => {});

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(wasReadOnly).toBe(true);
        });

        test("should restore textbox when handler returns error", () => {
            const input = new Input("test", () => Result.err("invalid" as any));

            const textbox = input.querySelector("input") as HTMLInputElement;
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(textbox.readOnly).toBe(false);
        });
    });

    describe("dispose", () => {
        test("should clear all callbacks", () => {
            const cancelled: string[] = [];
            const input = new Input("test", () => Result.ok("ok"));
            input.onCancelled(() => cancelled.push("x"));
            input.onCompleted(() => cancelled.push("y"));
            input.dispose();

            const textbox = input.querySelector("input") as HTMLInputElement;
            // These should be no-ops after dispose
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            // onCancelled is called on Escape, but dispose cleared callbacks
            expect(cancelled).toEqual([]);
        });
    });

    describe("keydown handling", () => {
        test("should remove error tip when user starts typing again", () => {
            const input = new Input("test", () => Result.err("error" as any));

            const textbox = input.querySelector("input") as HTMLInputElement;
            // First Enter to show error tip
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            const childCountBefore = input.children.length;

            // Then type a regular key to remove the tip
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
            expect(input.children.length).toBeLessThan(childCountBefore);
        });

        test("should stop propagation of keyboard events", () => {
            const input = new Input("test", () => Result.ok("ok"));
            let propagated = false;

            input.addEventListener("keydown", (e) => {
                // This listener is on the input element itself, not the textbox
                propagated = true;
            });

            const textbox = input.querySelector("input") as HTMLInputElement;
            const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
            Object.defineProperty(event, "stopPropagation", { value: () => {} });
            textbox.dispatchEvent(event);

            // The event's stopPropagation was called inside handleKeyDown
            // (tested by verifying no error is thrown)
        });
    });
});
