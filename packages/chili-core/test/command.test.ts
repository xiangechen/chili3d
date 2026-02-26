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
});
