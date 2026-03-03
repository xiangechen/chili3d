// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, command, type IApplication, type ICommand } from "../src";

class MockCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {}
}

@command({
    key: "test.command" as any,
    icon: "test-icon",
})
class TestCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {}
}

@command({
    key: "test.toggleCommand" as any,
    icon: "toggle-icon",
    helpText: "Test help text",
    helpUrl: "https://test.com/help",
})
class TestToggleCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {}
}

describe("command decorator", () => {
    describe("@command decorator", () => {
        test("should register command in registry", () => {
            const ctor = CommandStore.getCommand("test.command");
            expect(ctor).toBeDefined();
            expect(ctor).toBe(TestCommand);
        });

        test("should attach metadata to prototype", () => {
            const data = CommandStore.getComandData(TestCommand);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
            expect(data?.icon).toBe("test-icon");
        });

        test("should handle optional metadata", () => {
            const data = CommandStore.getComandData(TestToggleCommand);
            expect(data?.helpText).toBe("Test help text");
            expect(data?.helpUrl).toBe("https://test.com/help");
        });
    });

    describe("CommandUtils.getComandData", () => {
        test("should get data from string key", () => {
            const data = CommandStore.getComandData("test.command");
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should get data from constructor", () => {
            const data = CommandStore.getComandData(TestCommand);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should get data from instance", () => {
            const instance = new TestCommand();
            const data = CommandStore.getComandData(instance);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should return undefined for unregistered command", () => {
            const data = CommandStore.getComandData("nonexistent.command");
            expect(data).toBeUndefined();
        });

        test("should return undefined for undecorated command", () => {
            const data = CommandStore.getComandData(MockCommand);
            expect(data).toBeUndefined();
        });
    });

    describe("CommandUtils.getCommond", () => {
        test("should get constructor by key", () => {
            const ctor = CommandStore.getCommand("test.command");
            expect(ctor).toBe(TestCommand);
        });

        test("should return undefined for unknown key", () => {
            const ctor = CommandStore.getCommand("unknown.key");
            expect(ctor).toBeUndefined();
        });
    });
});
