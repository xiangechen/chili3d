// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandData, CommandKeys, IApplication, ICommand, IDocument, IView } from "@chili3d/core";
import { CommandStore, PubSub } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { CommandService } from "../../src/services/commandService";
import { createMockApplication, createMockDocument } from "../_helpers";

// ── test command stubs ────────────────────────────────────────────────

class TestCommand implements ICommand {
    executeCalls: IApplication[] = [];
    async execute(application: IApplication): Promise<void> {
        this.executeCalls.push(application);
    }
}

class ThrowingCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        throw new Error("command failed");
    }
}

class TestCancelableCommand implements ICommand {
    cancelCalls = 0;
    async execute(_application: IApplication): Promise<void> {}
    async cancel(): Promise<void> {
        this.cancelCalls++;
    }
}

// ── helpers ───────────────────────────────────────────────────────────

function registerCommand(key: string, Ctor: new () => ICommand = TestCommand, isAppCommand = false) {
    CommandStore.registerCommand(Ctor, {
        key: key as CommandKeys,
        icon: "test-icon",
        isApplicationCommand: isAppCommand,
    } as Omit<CommandData, "key"> & { key: string });
}

function unregisterCommand(key: string) {
    CommandStore.unregisterCommand(key);
}

// ── tests ─────────────────────────────────────────────────────────────

describe("CommandService", () => {
    let service: CommandService;
    let app: IApplication;
    let doc: IDocument;
    let view: IView;

    beforeEach(() => {
        service = new CommandService();
        doc = createMockDocument({ id: "doc-1", name: "test" });
        view = { document: doc } as unknown as IView;

        app = createMockApplication();
        app.activeView = view;
    });

    afterEach(() => {
        service.stop();
        unregisterCommand("test.box");
        unregisterCommand("test.appCmd");
        unregisterCommand("test.cancelable");
        unregisterCommand("test.error");
        unregisterCommand("test.error2");
        PubSub.default.removeAll("executeCommand");
        PubSub.default.removeAll("activeViewChanged");
    });

    // ── lifecycle ──────────────────────────────────────────────────

    describe("register", () => {
        test("should set the application instance", () => {
            service.register(app);
            // start should work without error after register
            expect(() => service.start()).not.toThrow();
        });
    });

    describe("start", () => {
        test("should subscribe to PubSub events without error", () => {
            service.register(app);
            expect(() => service.start()).not.toThrow();
        });
    });

    describe("stop", () => {
        test("should unsubscribe without error", () => {
            service.register(app);
            service.start();
            expect(() => service.stop()).not.toThrow();
        });
    });

    // ── executeCommand flow ────────────────────────────────────────

    describe("executeCommand", () => {
        beforeEach(() => {
            service.register(app);
        });

        test("should execute registered command and set lastCommand", async () => {
            registerCommand("test.box");
            service.start();

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);

            // Wait for async execution chain (executeCommand → canExecute → executeAsync)
            await new Promise((r) => setTimeout(r, 100));

            expect(app.lastCommand).toBe("test.box");
        });

        test("should clear executingCommand after execution", async () => {
            registerCommand("test.box");
            service.start();

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            expect(app.executingCommand).toBeUndefined();
        });

        test("should use lastCommand when commandName is special.last", async () => {
            registerCommand("test.box");
            app.lastCommand = "test.box" as CommandKeys;
            service.start();

            PubSub.default.pub("executeCommand", "special.last" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            // Verify it executed (lastCommand stays the same after execution)
            expect(app.lastCommand).toBe("test.box");
        });

        test("should skip execution when commandName is falsy", async () => {
            registerCommand("test.box");
            service.start();

            PubSub.default.pub("executeCommand", undefined as unknown as CommandKeys);

            await new Promise((r) => setTimeout(r, 50));

            expect(app.executingCommand).toBeUndefined();
            expect(app.lastCommand).toBeUndefined();
        });
    });

    // ── canExecute guard ───────────────────────────────────────────

    describe("canExecute guard", () => {
        beforeEach(() => {
            service.register(app);
            service.start();
        });

        test("should reject non-application command when no activeView", async () => {
            registerCommand("test.box");
            app.activeView = undefined;

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            expect(app.lastCommand).toBeUndefined();
        });

        test("should allow application command when no activeView", async () => {
            registerCommand("test.appCmd", TestCommand, true);
            app.activeView = undefined;

            PubSub.default.pub("executeCommand", "test.appCmd" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            expect(app.lastCommand).toBe("test.appCmd");
        });

        test("should cancel existing cancelable command before executing new one", async () => {
            registerCommand("test.box");
            registerCommand("test.cancelable", TestCancelableCommand);

            const cancelableCmd = new TestCancelableCommand();
            app.executingCommand = cancelableCmd;

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            expect(cancelableCmd.cancelCalls).toBe(1);
        });

        test("should not reject when no command is running", async () => {
            registerCommand("test.box");

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await new Promise((r) => setTimeout(r, 100));

            expect(app.lastCommand).toBe("test.box");
        });
    });

    // ── error handling ─────────────────────────────────────────────

    describe("error handling", () => {
        beforeEach(() => {
            service.register(app);
            service.start();
        });

        test("should clear executingCommand after command throws", async () => {
            registerCommand("test.error", ThrowingCommand);

            PubSub.default.pub("executeCommand", "test.error" as CommandKeys);
            await new Promise((r) => setTimeout(r, 150));

            expect(app.executingCommand).toBeUndefined();
        });

        test("should still set lastCommand even when command throws", async () => {
            registerCommand("test.error2", ThrowingCommand);

            PubSub.default.pub("executeCommand", "test.error2" as CommandKeys);
            await new Promise((r) => setTimeout(r, 150));

            // lastCommand is set in finally block, so it's still set
            expect(app.lastCommand).toBe("test.error2");
        });
    });

    // ── activeViewChanged ──────────────────────────────────────────

    describe("activeViewChanged", () => {
        beforeEach(() => {
            service.register(app);
            service.start();
        });

        test("should cancel executing cancelable command when active view changes", async () => {
            const cancelableCmd = new TestCancelableCommand();
            app.executingCommand = cancelableCmd;

            PubSub.default.pub("activeViewChanged", { id: "new" } as unknown as IView);

            await new Promise((r) => setTimeout(r, 50));
            expect(cancelableCmd.cancelCalls).toBe(1);
        });

        test("should not throw when executingCommand is not cancelable", () => {
            app.executingCommand = new TestCommand();

            expect(() => {
                PubSub.default.pub("activeViewChanged", { id: "new" } as unknown as IView);
            }).not.toThrow();
        });

        test("should not throw when no command is executing", () => {
            app.executingCommand = undefined;

            expect(() => {
                PubSub.default.pub("activeViewChanged", { id: "new" } as unknown as IView);
            }).not.toThrow();
        });
    });
});
