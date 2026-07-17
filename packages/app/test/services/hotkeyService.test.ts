// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, IApplication, IView } from "@chili3d/core";
import { PubSub } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { HotkeyService } from "../../src/services/hotkeyService";
import { createMockApplication } from "../_helpers";

describe("HotkeyService", () => {
    let service: HotkeyService;
    let app: IApplication;
    let originalAddEventListener: typeof window.addEventListener;
    let originalRemoveEventListener: typeof window.removeEventListener;
    let addedListeners: { type: string; handler: EventListenerOrEventListenerObject }[];
    let removedListeners: { type: string; handler: EventListenerOrEventListenerObject }[];

    beforeEach(() => {
        addedListeners = [];
        removedListeners = [];

        originalAddEventListener = window.addEventListener;
        originalRemoveEventListener = window.removeEventListener;

        window.addEventListener = ((type: string, handler: EventListenerOrEventListenerObject) => {
            addedListeners.push({ type, handler });
            return originalAddEventListener.call(window, type, handler);
        }) as typeof window.addEventListener;

        window.removeEventListener = ((type: string, handler: EventListenerOrEventListenerObject) => {
            removedListeners.push({ type, handler });
            return originalRemoveEventListener.call(window, type, handler);
        }) as typeof window.removeEventListener;

        service = new HotkeyService();
        app = createMockApplication();
    });

    afterEach(() => {
        service.stop();
        window.addEventListener = originalAddEventListener;
        window.removeEventListener = originalRemoveEventListener;
        PubSub.default.removeAll("executeCommand");
    });

    // ── lifecycle ────────────────────────────────────────────────────

    describe("register", () => {
        test("should store application reference without error", () => {
            expect(() => service.register(app)).not.toThrow();
        });
    });

    describe("start", () => {
        test("should add two keydown event listeners", () => {
            service.register(app);
            service.start();

            const keydownListeners = addedListeners.filter((l) => l.type === "keydown");
            expect(keydownListeners.length).toBe(2);
        });

        test("should subscribe to executeCommand PubSub", () => {
            service.register(app);
            service.start();

            expect(() => {
                PubSub.default.pub("executeCommand", "create.box" as CommandKeys);
            }).not.toThrow();
        });
    });

    describe("stop", () => {
        test("should remove keydown event listeners", () => {
            service.register(app);
            service.start();
            service.stop();

            const keydownRemoved = removedListeners.filter((l) => l.type === "keydown");
            expect(keydownRemoved.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ── getCommand ───────────────────────────────────────────────────

    describe("getCommand", () => {
        // The shortcut profile loads defaults on construction. Use a key
        // that is NOT in the default Chili3d profile to test undefined return.
        test("should return undefined for unmapped keys", () => {
            // "F23" is not in any shortcut profile
            const result = service.getCommand({ key: "f23" });
            expect(result).toBeUndefined();
        });

        test("should return command for a newly added single key", () => {
            service.addMap({ f21: "create.box" as CommandKeys });

            const result = service.getCommand({ key: "f21" });
            expect(result).toBe("create.box");
        });

        test("should match keys that were passed lowercase (as commandKeyDown does)", () => {
            // commandKeyDown calls e.key.toLowerCase() before passing to getCommand
            service.addMap({ f19: "create.box" as CommandKeys });

            const result = service.getCommand({ key: "f19" });
            expect(result).toBe("create.box");
        });

        test("should match ctrl+key combinations", () => {
            service.addMap({ "ctrl+f21": "doc.save" as CommandKeys });

            const result = service.getCommand({ key: "f21", ctrlKey: true });
            expect(result).toBe("doc.save");
        });

        test("should match shift+key combinations", () => {
            service.addMap({ "shift+f20": "create.arc" as CommandKeys });

            const result = service.getCommand({ key: "f20", shiftKey: true });
            expect(result).toBe("create.arc");
        });

        test("should match alt+key combinations", () => {
            service.addMap({ "alt+f19": "create.rect" as CommandKeys });

            const result = service.getCommand({ key: "f19", altKey: true });
            expect(result).toBe("create.rect");
        });

        test("should match multi-key sequences", () => {
            service.addMap({ "f17+f18": "create.circle" as CommandKeys });

            service.getCommand({ key: "f17" }); // first key
            const result = service.getCommand({ key: "f18" }); // second key

            expect(result).toBe("create.circle");
        });

        test("should return undefined for partial multi-key sequences", () => {
            service.addMap({ "f15+f16": "create.circle" as CommandKeys });

            const result = service.getCommand({ key: "f15" });
            expect(result).toBeUndefined();
        });

        test("should match the longest valid suffix in key history", () => {
            service.addMap({ f13: "create.circle" as CommandKeys });

            // Press unrelated key then the mapped key
            service.getCommand({ key: "f22" });
            const result = service.getCommand({ key: "f13" });

            // The recent key alone should match
            expect(result).toBe("create.circle");
        });

        test("should maintain sliding window of max 20 keystrokes", () => {
            // Push more than 20 keystrokes to verify sliding window doesn't crash
            for (let i = 0; i < 30; i++) {
                service.getCommand({ key: "a" });
            }

            service.addMap({ f12: "create.box" as CommandKeys });
            const result = service.getCommand({ key: "f12" });
            expect(result).toBe("create.box");
        });

        test("should default ctrlKey/shiftKey/altKey to false when not specified", () => {
            service.addMap({ f11: "create.arc" as CommandKeys });

            const result = service.getCommand({ key: "f11" });
            expect(result).toBe("create.arc");
        });
    });

    // ── addMap ───────────────────────────────────────────────────────

    describe("addMap", () => {
        test("should add multiple key mappings at once", () => {
            service.addMap({
                f10: "create.arc" as CommandKeys,
                f9: "create.box" as CommandKeys,
                f8: "create.circle" as CommandKeys,
            });

            expect(service.getCommand({ key: "f10" })).toBe("create.arc");
            expect(service.getCommand({ key: "f9" })).toBe("create.box");
            expect(service.getCommand({ key: "f8" })).toBe("create.circle");
        });

        test("should normalize map keys to lowercase", () => {
            service.addMap({ "CTRL+F7": "edit.undo" as CommandKeys });

            const result = service.getCommand({ key: "f7", ctrlKey: true });
            expect(result).toBe("edit.undo");
        });
    });

    // ── canHandleKey ─────────────────────────────────────────────────

    describe("canHandleKey", () => {
        test("should return false for INPUT elements", () => {
            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.createElement("input"),
                writable: false,
            });

            const result = (service as any).canHandleKey(event);
            expect(result).toBe(false);
        });

        test("should return false for TEXTAREA elements", () => {
            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.createElement("textarea"),
                writable: false,
            });

            const result = (service as any).canHandleKey(event);
            expect(result).toBe(false);
        });

        test("should return false for contentEditable elements", () => {
            const div = document.createElement("div");
            div.contentEditable = "true";

            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: div,
                writable: false,
            });

            const result = (service as any).canHandleKey(event);
            expect(result).toBe(false);
        });

        test("should return true for ordinary DIV elements", () => {
            const div = document.createElement("div");

            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: div,
                writable: false,
            });

            const result = (service as any).canHandleKey(event);
            expect(result).toBe(true);
        });

        test("should return true for BODY element", () => {
            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.body,
                writable: false,
            });

            const result = (service as any).canHandleKey(event);
            expect(result).toBe(true);
        });
    });

    // ── commandKeyDown ───────────────────────────────────────────────

    describe("commandKeyDown", () => {
        beforeEach(() => {
            service.register(app);
            // Must call start() so keydown listeners are attached
            service.start();
        });

        test("should publish executeCommand when a mapped key is pressed", () => {
            service.addMap({ n: "doc.new" as CommandKeys });

            const publishedCommands: CommandKeys[] = [];
            PubSub.default.sub("executeCommand", (cmd: CommandKeys) => {
                publishedCommands.push(cmd);
            });

            // commandKeyDown uses e.key.toLowerCase() internally via KeyboardEvent.key
            const event = new KeyboardEvent("keydown", { key: "n" });
            Object.defineProperty(event, "target", {
                value: document.body,
                writable: false,
            });
            window.dispatchEvent(event);

            expect(publishedCommands.length).toBe(1);
            expect(publishedCommands[0]).toBe("doc.new");
        });

        test("should not publish when target is INPUT", () => {
            service.addMap({ a: "create.arc" as CommandKeys });

            const publishedCommands: CommandKeys[] = [];
            PubSub.default.sub("executeCommand", (cmd: CommandKeys) => {
                publishedCommands.push(cmd);
            });

            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.createElement("input"),
                writable: false,
            });
            window.dispatchEvent(event);

            expect(publishedCommands.length).toBe(0);
        });
    });

    // ── eventHandlerKeyDown ──────────────────────────────────────────

    describe("eventHandlerKeyDown", () => {
        test("should delegate to visual event handler when activeView exists", () => {
            service.register(app);

            let handlerCalled = false;
            const mockVisual = {
                eventHandler: {
                    isEnabled: true,
                    keyDown: () => {
                        handlerCalled = true;
                    },
                    pointerMove: () => {},
                    pointerDown: () => {},
                    pointerUp: () => {},
                    dispose: () => {},
                },
                viewHandler: {
                    isEnabled: true,
                    keyDown: () => {},
                    pointerMove: () => {},
                    pointerDown: () => {},
                    pointerUp: () => {},
                    dispose: () => {},
                },
                update: () => {},
            };

            app.activeView = {
                document: {
                    visual: mockVisual,
                    id: "test",
                },
            } as unknown as IView;

            service.start();

            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.body,
                writable: false,
            });
            window.dispatchEvent(event);

            expect(handlerCalled).toBe(true);
        });

        test("should not throw when activeView is undefined", () => {
            service.register(app);
            app.activeView = undefined;
            service.start();

            const event = new KeyboardEvent("keydown", { key: "a" });
            Object.defineProperty(event, "target", {
                value: document.body,
                writable: false,
            });

            expect(() => {
                window.dispatchEvent(event);
            }).not.toThrow();
        });
    });
});
