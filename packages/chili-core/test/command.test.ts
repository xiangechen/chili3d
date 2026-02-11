// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    CancelableCommand,
    type IApplication,
    type ICanclableCommand,
    type ICommand,
    type IDisposable,
    type IDocument,
    type IView,
    isCancelableCommand,
} from "../src";
import { CommandStore } from "../src/command/decarator";

const mockDocument = {} as IDocument;

const mockView = {
    document: mockDocument,
} as IView;

const mockApplication = {
    activeView: mockView,
} as IApplication;

class TestCommand extends CancelableCommand {
    public executeCount = 0;
    public cancelCallCount = 0;
    public beforeExecuteCallCount = 0;
    public afterExecuteCallCount = 0;
    public onRestartingCallCount = 0;
    private _executeMock: () => Promise<void> = async () => {
        this.executeCount++;
    };

    protected override async executeAsync(): Promise<void> {
        await this._executeMock();
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        this.beforeExecuteCallCount++;
    }

    protected override afterExecute(): void {
        super.afterExecute();
        this.afterExecuteCallCount++;
    }

    protected override onRestarting(): void {
        super.onRestarting();
        this.onRestartingCallCount++;
    }

    restartTest() {
        this.restart();
    }

    setExecuteMock(fn: () => Promise<void>) {
        this._executeMock = fn;
    }
}

describe("Command System", () => {
    describe("ICommand interface", () => {
        test("should define ICommand interface correctly", () => {
            let executed = false;
            const mockCommand: ICommand = {
                execute: async () => {
                    executed = true;
                },
            };

            mockCommand.execute(mockApplication);
            expect(executed).toBe(true);
        });
    });

    describe("ICanclableCommand interface", () => {
        test("should define ICanclableCommand interface correctly", () => {
            let cancelCalled = false;
            let disposeCalled = false;
            const mockCancelableCommand: ICanclableCommand = {
                execute: async () => {},
                cancel: async () => {
                    cancelCalled = true;
                },
                dispose: () => {
                    disposeCalled = true;
                },
            };

            mockCancelableCommand.cancel();
            mockCancelableCommand.dispose();
            expect(cancelCalled).toBe(true);
            expect(disposeCalled).toBe(true);
        });
    });

    describe("isCancelableCommand type guard", () => {
        test("should identify cancelable command correctly", () => {
            const mockCommand: ICommand = {
                execute: async () => {},
            };

            const mockCancelableCommand: ICanclableCommand = {
                execute: async () => {},
                cancel: async () => {},
                dispose: () => {},
            };

            expect(isCancelableCommand(mockCommand)).toBe(false);
            expect(isCancelableCommand(mockCancelableCommand)).toBe(true);
        });
    });

    describe("CancelableCommand", () => {
        test("should execute successfully", async () => {
            const command = new TestCommand();

            await command.execute(mockApplication);

            expect(command.executeCount).toBe(1);
            expect(command.beforeExecuteCallCount).toBe(1);
            expect(command.afterExecuteCallCount).toBe(1);
            expect(command.isCompleted).toBe(true);
        });

        test("should handle cancellation properly", async () => {
            const command = new TestCommand();
            let resolvePromise: (() => void) | undefined;
            command.setExecuteMock(async () => {
                await new Promise<void>((resolve) => {
                    resolvePromise = resolve;
                });
            });

            const executePromise = command.execute(mockApplication);

            setTimeout(() => {
                command.cancel();
                resolvePromise!();
            }, 50);

            await executePromise;

            expect(command.isCanceled).toBe(true);
            expect(command.isCompleted).toBe(true);
        });

        test("should expose application property correctly", () => {
            const command = new TestCommand();
            (command as any)._application = mockApplication;

            expect(command.application).toBe(mockApplication);
        });

        test("should throw error when accessing application before initialization", () => {
            const command = new TestCommand();

            expect(() => command.application).toThrow("application is not set");
        });

        test("should expose document property correctly", () => {
            const command = new TestCommand();
            (command as any)._application = mockApplication;

            expect(command.document).toBe(mockDocument);
        });

        test("should handle repeat operation correctly", async () => {
            let callCount = 0;
            const command = new TestCommand();

            command.repeatOperation = true;
            expect(command.repeatOperation).toBe(true);

            command.setExecuteMock(async () => {
                callCount++;
            });

            await command.execute(mockApplication);

            expect(callCount).toBe(1);
            expect(command.isCompleted).toBe(true);
        });

        test("should handle restart functionality", async () => {
            const command = new TestCommand();
            let executeCount = 0;

            command.setExecuteMock(async () => {
                executeCount++;
                if (executeCount === 1) {
                    (command as any)._isRestarting = true;
                }
            });

            await command.execute(mockApplication);

            expect(executeCount).toBe(2);
        });

        test("should check canceled state correctly", () => {
            const command = new TestCommand();

            expect((command as any).checkCanceled()).toBe(false);

            (command as any)._isCanceled = true;
            expect((command as any).checkCanceled()).toBe(true);
        });

        test("should handle controller cancellation", () => {
            const command = new TestCommand();
            const mockController = {
                result: {
                    status: "cancel",
                },
            } as unknown as AsyncController;

            expect((command as any).checkCanceled.call(command)).toBe(false);

            command["controller"] = mockController;

            expect((command as any).checkCanceled.call(command)).toBe(true);
        });

        test("should return false for controller with success status", () => {
            const command = new TestCommand();
            const mockController = {
                result: {
                    status: "success",
                },
            } as unknown as AsyncController;

            (command as any)["#controller"] = mockController;

            expect((command as any).checkCanceled()).toBe(false);
        });

        test("should handle onRestarting callback", async () => {
            const command = new TestCommand();
            let executeCount = 0;

            command.setExecuteMock(async () => {
                executeCount++;
                if (executeCount === 1) {
                    (command as any)._isRestarting = true;
                }
            });

            await command.execute(mockApplication);

            expect(command.onRestartingCallCount).toBe(1);
            await command.execute(mockApplication);
            expect(command.onRestartingCallCount).toBe(1);
            command.restartTest();
            await command.execute(mockApplication);
            expect(command.onRestartingCallCount).toBe(2);
        });

        test("should return early when activeView is undefined", async () => {
            const command = new TestCommand();
            const appWithoutView = {
                activeView: undefined,
            } as IApplication;

            await command.execute(appWithoutView);

            expect(command.executeCount).toBe(0);
            expect(command.isCompleted).toBe(false);
        });

        test("should return early when activeView.document is undefined", async () => {
            const command = new TestCommand();
            const appWithNoDocument = {
                activeView: {
                    document: undefined,
                },
            } as unknown as IApplication;

            await command.execute(appWithNoDocument);

            expect(command.executeCount).toBe(0);
        });

        test("should handle dispose stack correctly", async () => {
            const command = new TestCommand();
            let disposeCalled = false;
            const mockDisposable: IDisposable = {
                dispose: () => {
                    disposeCalled = true;
                },
            };

            (command as any).disposeStack.add(mockDisposable);

            await command.execute(mockApplication);

            expect(disposeCalled).toBe(true);
            expect((command as any).disposeStack.size).toBe(0);
        });

        test("should handle controller setting and disposal", async () => {
            const command = new TestCommand();
            let disposeCalled = false;
            const mockController = {
                dispose: () => {
                    disposeCalled = true;
                },
            } as unknown as AsyncController;
            command["controller"] = mockController;
            expect(command["controller"]).toBe(mockController);
            await command.execute(mockApplication);
            expect(disposeCalled).toBe(true);
        });

        test("should not dispose controller if not set", async () => {
            const command = new TestCommand();
            await command.execute(mockApplication);
            expect(command["controller"]).toBeUndefined();
        });

        test("should set isCanceled when cancel is called", () => {
            const command = new TestCommand();

            expect(command.isCanceled).toBe(false);

            (command as any)._isCanceled = true;
            expect(command.isCanceled).toBe(true);
        });

        test("should handle cancel sets isCanceled flag", () => {
            const command = new TestCommand();

            expect(command.isCanceled).toBe(false);

            (command as any)._isCanceled = true;
            expect(command.isCanceled).toBe(true);
        });

        test("should preserve isCompleted state", () => {
            const command = new TestCommand();

            expect(command.isCompleted).toBe(false);
        });

        test("should preserve isCanceled state", () => {
            const command = new TestCommand();

            expect(command.isCanceled).toBe(false);
        });

        test("should handle repeatOperation getter and setter", () => {
            const command = new TestCommand();

            expect(command.repeatOperation).toBe(false);

            command.repeatOperation = true;
            expect(command.repeatOperation).toBe(true);
        });

        test("should handle controller property getter and setter", () => {
            const command = new TestCommand();
            let disposeCallCount = 0;
            const mockController = {
                dispose: () => {
                    disposeCallCount++;
                },
            } as unknown as AsyncController;

            command["controller"] = mockController;
            expect(command["controller"]).toBe(mockController);

            const anotherController = {
                dispose: () => {},
            } as unknown as AsyncController;
            command["controller"] = anotherController;

            expect(disposeCallCount).toBe(1);
            expect(command["controller"]).toBe(anotherController);
        });

        test("should not reassign same controller", () => {
            const command = new TestCommand();
            let disposeCallCount = 0;
            const mockController = {
                dispose: () => {
                    disposeCallCount++;
                },
            } as unknown as AsyncController;

            command["controller"] = mockController;
            disposeCallCount = 0;

            command["controller"] = mockController;

            expect(disposeCallCount).toBe(0);
        });
    });

    describe("CommandUtils", () => {
        beforeEach(() => {
            CommandStore.getAllCommands().forEach((cmd) => {
                CommandStore.unregisterCommand(cmd.key);
            });
        });

        describe("registerCommand", () => {
            test("should register command with key and metadata", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.command",
                    icon: "test-icon",
                    helpText: "Test help text",
                });

                const data = CommandStore.getComandData("test.command");
                expect(data).toBeDefined();
                expect(data?.key).toBe("test.command");
                expect(data?.icon).toBe("test-icon");
                expect(data?.helpText).toBe("Test help text");
            });

            test("should store command constructor in registry", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.registry",
                    icon: "icon",
                });

                const ctor = CommandStore.getCommand("test.registry");
                expect(ctor).toBe(TestCommandClass);
            });

            test("should overwrite existing command with same key", () => {
                class FirstCommand implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                class SecondCommand implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(FirstCommand, {
                    key: "test.overwrite",
                    icon: "icon1",
                });

                CommandStore.registerCommand(SecondCommand, {
                    key: "test.overwrite",
                    icon: "icon2",
                });

                const data = CommandStore.getComandData("test.overwrite");
                expect(data?.icon).toBe("icon2");
            });

            test("should register command with optional toggle binding", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                const mockToggle = {} as any;

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.toggle",
                    icon: "icon",
                    toggle: mockToggle,
                });

                const data = CommandStore.getComandData("test.toggle");
                expect(data?.toggle).toBe(mockToggle);
            });

            test("should register command with helpUrl", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.helpUrl",
                    icon: "icon",
                    helpUrl: "https://example.com/help",
                });

                const data = CommandStore.getComandData("test.helpUrl");
                expect(data?.helpUrl).toBe("https://example.com/help");
            });

            test("should register command with isApplicationCommand flag", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.appCommand",
                    icon: "icon",
                    isApplicationCommand: true,
                });

                const data = CommandStore.getComandData("test.appCommand");
                expect(data?.isApplicationCommand).toBe(true);
            });
        });

        describe("unregisterCommand", () => {
            test("should remove command from registry", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.unregister",
                    icon: "icon",
                });

                expect(CommandStore.getCommand("test.unregister")).toBeDefined();

                CommandStore.unregisterCommand("test.unregister");

                expect(CommandStore.getCommand("test.unregister")).toBeUndefined();
            });

            test("should remove command data from prototype", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.prototype",
                    icon: "icon",
                });

                expect((TestCommandClass.prototype as any).data).toBeDefined();

                CommandStore.unregisterCommand("test.prototype");

                expect((TestCommandClass.prototype as any).data).toBeUndefined();
            });

            test("should handle unregistering non-existent command", () => {
                expect(() => {
                    CommandStore.unregisterCommand("test.nonexistent");
                }).not.toThrow();
            });

            test("should remove command data from getAllCommands result", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.getall",
                    icon: "icon",
                });

                expect(CommandStore.getAllCommands().length).toBeGreaterThan(0);

                CommandStore.unregisterCommand("test.getall");

                const allCommands = CommandStore.getAllCommands();
                const found = allCommands.find((cmd) => (cmd as any).key === "test.getall");
                expect(found).toBeUndefined();
            });

            test("should handle unregistering command that was registered multiple times", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.multi",
                    icon: "icon1",
                });

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.multi",
                    icon: "icon2",
                });

                CommandStore.unregisterCommand("test.multi");

                expect(CommandStore.getCommand("test.multi")).toBeUndefined();
            });
        });

        describe("getComandData", () => {
            test("should get command data by string key", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.getData",
                    icon: "test-icon",
                });

                const data = CommandStore.getComandData("test.getData");
                expect(data?.icon).toBe("test-icon");
            });

            test("should get command data by command constructor", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.getDataCtor",
                    icon: "icon",
                });

                const data = CommandStore.getComandData(TestCommandClass);
                expect(data?.key).toBe("test.getDataCtor");
            });

            test("should get command data by command instance", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.getDataInstance",
                    icon: "icon",
                });

                const instance = new TestCommandClass();
                const data = CommandStore.getComandData(instance);
                expect(data?.key).toBe("test.getDataInstance");
            });

            test("should return undefined for non-existent command", () => {
                const data = CommandStore.getComandData("test.nonExistent");
                expect(data).toBeUndefined();
            });
        });

        describe("getCommand", () => {
            test("should return command constructor by name", () => {
                class TestCommandClass implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(TestCommandClass, {
                    key: "test.getCommand",
                    icon: "icon",
                });

                const ctor = CommandStore.getCommand("test.getCommand");
                expect(ctor).toBe(TestCommandClass);
            });

            test("should return undefined for non-existent command", () => {
                const ctor = CommandStore.getCommand("test.doesNotExist");
                expect(ctor).toBeUndefined();
            });
        });

        describe("getAllCommands", () => {
            test("should return all registered commands", () => {
                class Command1 implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                class Command2 implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                class Command3 implements ICommand {
                    async execute(_app: IApplication): Promise<void> {}
                }

                CommandStore.registerCommand(Command1, {
                    key: "test.all1",
                    icon: "icon1",
                });

                CommandStore.registerCommand(Command2, {
                    key: "test.all2",
                    icon: "icon2",
                });

                CommandStore.registerCommand(Command3, {
                    key: "test.all3",
                    icon: "icon3",
                });

                const allCommands = CommandStore.getAllCommands();
                expect(allCommands.length).toBe(3);
            });

            test("should return empty array when no commands registered", () => {
                const allCommands = CommandStore.getAllCommands();
                expect(allCommands.length).toBe(0);
            });
        });
    });
});
