// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { Input } from "../src/viewport/flyout/input";
import { mustQuery } from "./_helpers/domHelpers";

describe("Input", () => {
    describe("constructor", () => {
        test("should initialize with the given text value", () => {
            const input = new Input("hello", () => Result.ok("ok"));
            expect(input.text).toBe("hello");
        });

        test("should create a textbox input child element", () => {
            const input = new Input("test", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            expect(textbox.value).toBe("test");
        });
    });

    describe("setText", () => {
        test("should replace text the box wrote itself", () => {
            const input = new Input("10", () => Result.ok("ok"));
            input.setText("12.5");
            expect(input.text).toBe("12.5");
            input.setText("14");
            expect(input.text).toBe("14");
        });

        // a readout that clobbered a half-typed number would be worse than no readout at all,
        // and the box keeps the focus all through the drag, so focus cannot be the test
        test("should leave alone a box the user has typed into", () => {
            const input = new Input("10", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.value = "7";
            input.setText("20");
            expect(input.text).toBe("7");
        });

        // a rewrite leaves the caret at the end of it, so the next number typed would land
        // after the one the hand is on rather than in its place
        test("should take the whole text again after writing", () => {
            const input = new Input("10", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            input.setText("20");
            expect(textbox.selectionStart).toBe(0);
            expect(textbox.selectionEnd).toBe(2);
        });

        test("should stop following once the user has cleared it", () => {
            const input = new Input("10", () => Result.ok("ok"));
            mustQuery<HTMLInputElement>(input, "input").value = "";
            input.setText("20");
            expect(input.text).toBe("");
        });
    });

    describe("selectAll", () => {
        test("should take the whole text", () => {
            const input = new Input("12.5", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            input.selectAll();
            expect(textbox.selectionStart).toBe(0);
            expect(textbox.selectionEnd).toBe(4);
        });

        test("should take what is there now, not what it opened with", () => {
            const input = new Input("12.5", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            input.setText("7");
            input.selectAll();
            expect(textbox.selectionStart).toBe(0);
            expect(textbox.selectionEnd).toBe(1);
        });
    });

    describe("text getter", () => {
        test("should return current textbox value", () => {
            const input = new Input("initial", () => Result.ok("ok"));
            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.value = "changed";
            expect(input.text).toBe("changed");
        });
    });

    describe("onCancelled", () => {
        test("should call registered callbacks on Escape key", () => {
            const cancelled: string[] = [];
            const input = new Input("test", () => Result.ok("ok"));
            input.onCancelled(() => cancelled.push("cancelled"));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

            expect(cancelled).toContain("cancelled");
        });

        test("should support multiple cancel callbacks", () => {
            const calls: number[] = [];
            const input = new Input("test", () => Result.ok("ok"));
            input.onCancelled(() => calls.push(1));
            input.onCancelled(() => calls.push(2));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

            expect(calls).toEqual([1, 2]);
        });
    });

    describe("onCompleted", () => {
        test("should call registered callbacks on Enter with valid handler result", () => {
            const completed: string[] = [];
            const input = new Input("test", () => Result.ok("success"));
            input.onCompleted(() => completed.push("done"));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(completed).toContain("done");
        });

        test("should NOT call completed callbacks when handler returns error", () => {
            const completed: string[] = [];
            const input = new Input("test", () => Result.err("invalid" as any));
            input.onCompleted(() => completed.push("done"));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(completed).toEqual([]);
        });

        test("should show error tip when handler returns error", () => {
            const input = new Input("test", () => Result.err("error.invalid" as any));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            // Should have created a tip child element
            const children = input.children;
            expect(children.length).toBeGreaterThan(1); // textbox + tip label
        });

        test("should make textbox readonly while processing", () => {
            let wasReadOnly = false;
            const input = new Input("test", () => {
                wasReadOnly = mustQuery<HTMLInputElement>(input, "input").readOnly;
                return Result.ok("ok");
            });
            input.onCompleted(() => {});

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

            expect(wasReadOnly).toBe(true);
        });

        test("should restore textbox when handler returns error", () => {
            const input = new Input("test", () => Result.err("invalid" as any));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
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

            const textbox = mustQuery<HTMLInputElement>(input, "input");
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

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            // First Enter to show error tip
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            const childCountBefore = input.children.length;

            // Then type a regular key to remove the tip
            textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
            expect(input.children.length).toBeLessThan(childCountBefore);
        });

        test("should stop propagation of keyboard events", () => {
            const input = new Input("test", () => Result.ok("ok"));

            const textbox = mustQuery<HTMLInputElement>(input, "input");
            const event = new KeyboardEvent("keydown", { key: "a", bubbles: true });
            let stopPropagationCalled = false;
            Object.defineProperty(event, "stopPropagation", {
                value: () => {
                    stopPropagationCalled = true;
                },
            });
            textbox.dispatchEvent(event);

            // handleKeyDown must call event.stopPropagation()
            expect(stopPropagationCalled).toBe(true);
        });
    });
});
