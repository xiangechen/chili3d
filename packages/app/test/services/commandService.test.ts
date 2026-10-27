// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    CommandData,
    CommandKeys,
    I18nKeys,
    IApplication,
    ICommand,
    IDocument,
    IView,
} from "@chili3d/core";
import { CommandStore, I18n, PubSub } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CommandService } from "../../src/services/commandService";

// ── test command stubs ────────────────────────────────────────────────

class TestCommand implements ICommand {
    private static _waiters: Array<() => void> = [];

    /** Resolves the next time any TestCommand instance finishes execute(). */
    static nextExecuted(): Promise<void> {
        return new Promise<void>((resolve) => {
            TestCommand._waiters.push(resolve);
        });
    }

    static reset(): void {
        TestCommand._waiters = [];
    }

    executeCalls: IApplication[] = [];

    async execute(application: IApplication): Promise<void> {
        this.executeCalls.push(application);
        for (const resolve of TestCommand._waiters.splice(0)) {
            resolve();
        }
    }
}

class ThrowingCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {
        throw new Error("command failed");
    }
}

class RunningCommand implements ICommand {
    async execute(_application: IApplication): Promise<void> {}
}

class TestCancelableCommand implements ICommand {
    cancelCalls = 0;

    private _resolveCancelled!: () => void;
    /** Resolves the first time cancel() is called on this instance. */
    readonly cancelled: Promise<void> = new Promise<void>((resolve) => {
        this._resolveCancelled = resolve;
    });

    async execute(_application: IApplication): Promise<void> {}

    async cancel(): Promise<void> {
        this.cancelCalls++;
        this._resolveCancelled();
    }
}

class ThrowingCancelCommand extends TestCancelableCommand {
    override async cancel(): Promise<void> {
        await super.cancel();
        throw new Error("cancel failed");
    }
}

class UrgentTestCommand implements ICommand {
    static calls = 0;

    async execute(_application: IApplication): Promise<void> {
        UrgentTestCommand.calls++;
    }
}

// ── helpers ───────────────────────────────────────────────────────────

function registerCommand(
    key: string,
    Ctor: new () => ICommand = TestCommand,
    isAppCommand = false,
    alwaysAvailable = false,
) {
    CommandStore.registerCommand(Ctor, {
        key: key as CommandKeys,
        icon: "test-icon",
        isApplicationCommand: isAppCommand,
        alwaysAvailable,
    } as Omit<CommandData, "key"> & { key: string });
}

function unregisterCommand(key: string) {
    CommandStore.unregisterCommand(key);
}

/**
 * Wait until the full async command chain (executeCommand → canExecute → executeAsync
 * → command.execute → finally) has completed for `key`.
 *
 * CommandService exposes no completion event; `lastCommand` is assigned in
 * executeAsync's finally block, so it is the only observable signal that the whole
 * chain has finished (including that `executingCommand` was cleared). Keep this
 * polling in a single place: if the service ever emits a completion event, only
 * this helper needs to change.
 */
async function waitForCommandCompleted(app: IApplication, key: string): Promise<void> {
    await rs.waitFor(() => {
        expect(app.lastCommand).toBe(key);
    });
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

        TestCommand.reset();
    });

    afterEach(() => {
        service.stop();
        unregisterCommand("test.box");
        unregisterCommand("test.appCmd");
        unregisterCommand("test.cancelable");
        unregisterCommand("test.error");
        unregisterCommand("test.error2");
        unregisterCommand("test.urgent");
        unregisterCommand("test.running");
        PubSub.default.removeAll("executeCommand");
        PubSub.default.removeAll("activeViewChanged");
    });

    // ── lifecycle ──────────────────────────────────────────────────

    describe("register", () => {
        test("should wire the application so published commands execute against it", async () => {
            registerCommand("test.box");
            service.register(app);
            service.start();

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);

            // Execution only works when register() stored the app instance
            await waitForCommandCompleted(app, "test.box");
        });
    });

    describe("start", () => {
        test("should subscribe to executeCommand and activeViewChanged", async () => {
            registerCommand("test.box");
            service.register(app);
            service.start();

            // executeCommand subscription is live: the published command runs to completion
            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await waitForCommandCompleted(app, "test.box");

            // activeViewChanged subscription is live: the executing cancelable command is cancelled
            const cancelableCmd = new TestCancelableCommand();
            app.executingCommand = cancelableCmd;
            PubSub.default.pub("activeViewChanged", view);
            await cancelableCmd.cancelled;
            expect(cancelableCmd.cancelCalls).toBe(1);
        });
    });

    describe("stop", () => {
        test("should unsubscribe so published commands are no longer executed", async () => {
            registerCommand("test.box");
            service.register(app);
            service.start();
            service.stop();

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);

            // No handler is subscribed anymore, so nothing can be triggered
            await Promise.resolve();

            expect(app.executingCommand).toBeUndefined();
            expect(app.lastCommand).toBeUndefined();
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

            await waitForCommandCompleted(app, "test.box");
        });

        test("should clear executingCommand after execution", async () => {
            registerCommand("test.box");
            service.start();

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);

            // waitForCommandCompleted returns after the finally block ran, so
            // executingCommand must already be cleared.
            await waitForCommandCompleted(app, "test.box");
            expect(app.executingCommand).toBeUndefined();
        });

        test("should use lastCommand when commandName is special.last", async () => {
            registerCommand("test.box");
            app.lastCommand = "test.box" as CommandKeys;
            service.start();

            const executed = TestCommand.nextExecuted();
            PubSub.default.pub("executeCommand", "special.last" as CommandKeys);

            // The registered command really ran, and lastCommand stays the same
            await executed;
            await waitForCommandCompleted(app, "test.box");
        });

        test("should skip execution when commandName is falsy", async () => {
            registerCommand("test.box");
            service.start();

            PubSub.default.pub("executeCommand", undefined as unknown as CommandKeys);

            // Give the (skipped) async chain a chance to run before asserting nothing happened
            await Promise.resolve();

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

            // canExecute rejects the command synchronously; a microtask flush is enough
            await Promise.resolve();

            expect(app.lastCommand).toBeUndefined();
        });

        test("should allow application command when no activeView", async () => {
            registerCommand("test.appCmd", TestCommand, true);
            app.activeView = undefined;

            PubSub.default.pub("executeCommand", "test.appCmd" as CommandKeys);
            await waitForCommandCompleted(app, "test.appCmd");
        });

        test("should cancel existing cancelable command before executing new one", async () => {
            registerCommand("test.box");
            registerCommand("test.cancelable", TestCancelableCommand);

            const cancelableCmd = new TestCancelableCommand();
            app.executingCommand = cancelableCmd;

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await cancelableCmd.cancelled;
            expect(cancelableCmd.cancelCalls).toBe(1);
        });

        test("should not reject when no command is running", async () => {
            registerCommand("test.box");

            PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
            await waitForCommandCompleted(app, "test.box");
        });

        test("should say which command is in the way when it cannot be interrupted", async () => {
            registerCommand("test.running", RunningCommand);
            registerCommand("test.box");
            app.executingCommand = new RunningCommand();

            const toasts: any[][] = [];
            const listener = (...args: any[]) => toasts.push(args);
            PubSub.default.sub("showToast", listener as any);

            try {
                PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
                await rs.waitFor(() => {
                    expect(toasts.length).toBe(1);
                });
                await Promise.resolve();

                // A silent refusal here is what made a command click look broken.
                expect(toasts[0]).toEqual([
                    "toast.command.{0}excuting",
                    I18n.translate("command.test.running" as I18nKeys),
                ]);
                expect(app.lastCommand).toBeUndefined();
            } finally {
                PubSub.default.remove("showToast", listener as any);
            }
        });
    });

    // ── alwaysAvailable commands ───────────────────────────────────

    describe("alwaysAvailable commands", () => {
        beforeEach(() => {
            service.register(app);
            service.start();
            UrgentTestCommand.calls = 0;
        });

        test("should run while another command is executing", async () => {
            registerCommand("test.urgent", UrgentTestCommand, true, true);
            const running = new TestCommand();
            app.executingCommand = running;

            PubSub.default.pub("executeCommand", "test.urgent" as CommandKeys);
            await waitForCommandCompleted(app, "test.urgent");

            expect(UrgentTestCommand.calls).toBe(1);
            // The running command still owns the slot, so its own cancel/finish path works.
            expect(app.executingCommand).toBe(running);
        });

        test("should leave the command in flight alone (no cancel, no property panel reset)", async () => {
            registerCommand("test.urgent", UrgentTestCommand, true, true);
            const running = new TestCancelableCommand();
            app.executingCommand = running;

            const showProperties = rs.fn();
            PubSub.default.sub("showProperties", showProperties as any);

            try {
                PubSub.default.pub("executeCommand", "test.urgent" as CommandKeys);
                await waitForCommandCompleted(app, "test.urgent");

                expect(running.cancelCalls).toBe(0);
                expect(showProperties).not.toHaveBeenCalled();
            } finally {
                PubSub.default.remove("showProperties", showProperties as any);
            }
        });

        test("should still run when the executing command refuses to cancel", async () => {
            registerCommand("test.urgent", UrgentTestCommand, true, true);
            const running = new ThrowingCancelCommand();
            app.executingCommand = running;

            PubSub.default.pub("executeCommand", "test.urgent" as CommandKeys);
            await waitForCommandCompleted(app, "test.urgent");

            expect(UrgentTestCommand.calls).toBe(1);
        });

        test("should run without an active view (the command handles the missing document)", async () => {
            registerCommand("test.urgent", UrgentTestCommand, false, true);
            app.activeView = undefined;

            PubSub.default.pub("executeCommand", "test.urgent" as CommandKeys);
            await waitForCommandCompleted(app, "test.urgent");

            expect(UrgentTestCommand.calls).toBe(1);
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

            // waitForCommandCompleted returns after the finally block ran even when
            // execute throws, so executingCommand must already be cleared.
            await waitForCommandCompleted(app, "test.error");
            expect(app.executingCommand).toBeUndefined();
        });

        test("should keep running commands after the check itself throws", async () => {
            registerCommand("test.box");
            const errors: string[] = [];
            const listener = (message: string) => errors.push(message);
            PubSub.default.sub("displayError", listener);
            app.executingCommand = new ThrowingCancelCommand();

            try {
                PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
                await rs.waitFor(() => {
                    expect(errors).toEqual(["cancel failed"]);
                });

                // A stuck check flag would silently refuse everything from here on.
                app.executingCommand = undefined;
                PubSub.default.pub("executeCommand", "test.box" as CommandKeys);
                await waitForCommandCompleted(app, "test.box");
            } finally {
                PubSub.default.remove("displayError", listener);
            }
        });

        test("should still set lastCommand even when command throws", async () => {
            registerCommand("test.error2", ThrowingCommand);

            PubSub.default.pub("executeCommand", "test.error2" as CommandKeys);

            await waitForCommandCompleted(app, "test.error2");
            // executeAsync's finally block assigns lastCommand even when execute throws
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

            await cancelableCmd.cancelled;
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
