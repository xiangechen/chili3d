// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandUtils, command, type IApplication, type ICommand } from "../src";

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
            const ctor = CommandUtils.getCommond("test.command" as any);
            expect(ctor).toBeDefined();
            expect(ctor).toBe(TestCommand);
        });

        test("should attach metadata to prototype", () => {
            const data = CommandUtils.getComandData(TestCommand);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
            expect(data?.icon).toBe("test-icon");
        });

        test("should handle optional metadata", () => {
            const data = CommandUtils.getComandData(TestToggleCommand);
            expect(data?.helpText).toBe("Test help text");
            expect(data?.helpUrl).toBe("https://test.com/help");
        });
    });

    describe("CommandUtils.getComandData", () => {
        test("should get data from string key", () => {
            const data = CommandUtils.getComandData("test.command" as any);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should get data from constructor", () => {
            const data = CommandUtils.getComandData(TestCommand);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should get data from instance", () => {
            const instance = new TestCommand();
            const data = CommandUtils.getComandData(instance);
            expect(data).toBeDefined();
            expect(data?.key).toBe("test.command");
        });

        test("should return undefined for unregistered command", () => {
            const data = CommandUtils.getComandData("nonexistent.command" as any);
            expect(data).toBeUndefined();
        });

        test("should return undefined for undecorated command", () => {
            const data = CommandUtils.getComandData(MockCommand);
            expect(data).toBeUndefined();
        });
    });

    describe("CommandUtils.getCommond", () => {
        test("should get constructor by key", () => {
            const ctor = CommandUtils.getCommond("test.command" as any);
            expect(ctor).toBe(TestCommand);
        });

        test("should return undefined for unknown key", () => {
            const ctor = CommandUtils.getCommond("unknown.key" as any);
            expect(ctor).toBeUndefined();
        });
    });
});
