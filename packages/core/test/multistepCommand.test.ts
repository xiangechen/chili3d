// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { AsyncController, IApplication, IDocument, IStep, IView, SnapResult } from "../src";
import { MultistepCommand } from "../src/command/multistepCommand";

// ─── Types for accessing private fields in tests ─────────────────────────────

/** Narrow interface exposing private CancelableCommand fields that tests need to set up. */
interface CommandInternals {
    _application: IApplication;
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

function mockApplication(doc: IDocument): IApplication {
    const view: IView = { document: doc } as unknown as IView;
    return { activeView: view } as IApplication;
}

function mockDocument(overrides?: Partial<Pick<IDocument, "selection">>): IDocument {
    const selection = overrides?.selection ?? { clearSelection: () => {} };
    return { selection } as unknown as IDocument;
}

function mockSnapResult(overrides?: Partial<SnapResult>): SnapResult {
    return {
        view: {} as IView,
        type: "vertex",
        point: undefined,
        shapes: [],
        ...overrides,
    };
}

function mockStep(result: SnapResult | undefined): IStep {
    return {
        execute: async (_doc: IDocument, ctrl: AsyncController) => {
            if (result !== undefined) {
                ctrl.success();
            }
            return result;
        },
    };
}

// ─── Concrete Test Subclass ──────────────────────────────────────────────────

class TestMultistepCommand extends MultistepCommand {
    public canExcuteResult = true;
    public canExcuteCallCount = 0;
    public executeMainTaskCallCount = 0;
    public onRestartingCallCount = 0;

    private _steps: IStep[] = [];
    private _mainTask: () => void = () => {
        this.executeMainTaskCallCount++;
    };

    // ── Public wrappers exposing protected members for testing ──────────

    /** Inject the mock application object for isolated testing. */
    setApplication(app: IApplication): void {
        (this as unknown as CommandInternals)._application = app;
    }

    /** Public accessor for protected stepDatas. */
    getStepDatas(): SnapResult[] {
        return this.stepDatas;
    }

    /** Public entry point for protected resetStepDatas. */
    callResetStepDatas(): void {
        this.resetStepDatas();
    }

    /** Public entry point for protected executeSteps. */
    async runExecuteSteps(): Promise<boolean> {
        return await this.executeSteps();
    }

    /** Public entry point for protected executeAsync. */
    async runExecuteAsync(): Promise<void> {
        await this.executeAsync();
    }

    /** Public entry point for protected onRestarting. */
    callOnRestarting(): void {
        this.onRestarting();
    }

    /** Public entry for the protected _isRestarting flag. */
    setRestarting(value: boolean): void {
        this._isRestarting = value;
    }

    // ── Test helpers ────────────────────────────────────────────────────

    setSteps(steps: IStep[]): void {
        this._steps = steps;
    }

    setMainTask(fn: () => void): void {
        this._mainTask = fn;
    }

    // ── Abstract overrides ──────────────────────────────────────────────

    getSteps(): IStep[] {
        return this._steps;
    }

    protected override async canExcute(): Promise<boolean> {
        this.canExcuteCallCount++;
        return this.canExcuteResult;
    }

    protected override executeMainTask(): void {
        this._mainTask();
    }

    protected override onRestarting(): void {
        super.onRestarting();
        this.onRestartingCallCount++;
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MultistepCommand", () => {
    // ── Constructor & Initial State ──────────────────────────────────────

    describe("initial state", () => {
        test("should initialize with empty stepDatas", () => {
            const cmd = new TestMultistepCommand();
            expect(cmd.getStepDatas()).toEqual([]);
        });
    });

    // ── resetStepDatas ───────────────────────────────────────────────────

    describe("resetStepDatas", () => {
        test("should clear stepDatas array", () => {
            const cmd = new TestMultistepCommand();
            cmd.getStepDatas().push(mockSnapResult());
            cmd.getStepDatas().push(mockSnapResult());
            expect(cmd.getStepDatas().length).toBe(2);

            cmd.callResetStepDatas();
            expect(cmd.getStepDatas()).toEqual([]);
        });

        test("should handle reset on already empty array", () => {
            const cmd = new TestMultistepCommand();
            expect(() => cmd.callResetStepDatas()).not.toThrow();
            expect(cmd.getStepDatas()).toEqual([]);
        });
    });

    // ── onRestarting ─────────────────────────────────────────────────────

    describe("onRestarting", () => {
        test("should call resetStepDatas via onRestarting", () => {
            const cmd = new TestMultistepCommand();
            cmd.getStepDatas().push(mockSnapResult());

            cmd.callOnRestarting();

            expect(cmd.getStepDatas()).toEqual([]);
        });

        test("should track onRestarting call count in subclass", () => {
            const cmd = new TestMultistepCommand();
            expect(cmd.onRestartingCallCount).toBe(0);

            cmd.callOnRestarting();
            expect(cmd.onRestartingCallCount).toBe(1);
        });
    });

    // ── executeSteps ─────────────────────────────────────────────────────

    describe("executeSteps", () => {
        test("should execute all steps sequentially and collect results", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));

            const snap1 = mockSnapResult({ type: "vertex" });
            const snap2 = mockSnapResult({ type: "end" });
            cmd.setSteps([mockStep(snap1), mockStep(snap2)]);

            const result = await cmd.runExecuteSteps();

            expect(result).toBe(true);
            expect(cmd.getStepDatas().length).toBe(2);
            expect(cmd.getStepDatas()[0]).toBe(snap1);
            expect(cmd.getStepDatas()[1]).toBe(snap2);
        });

        test("should stop and return false when a step returns undefined", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));

            const snap1 = mockSnapResult();
            cmd.setSteps([mockStep(snap1), mockStep(undefined), mockStep(mockSnapResult())]);

            const result = await cmd.runExecuteSteps();

            expect(result).toBe(false);
            // Only the first step should have succeeded
            expect(cmd.getStepDatas().length).toBe(1);
        });

        test("should return true when steps array is empty", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.setSteps([]);

            const result = await cmd.runExecuteSteps();

            expect(result).toBe(true);
            expect(cmd.getStepDatas().length).toBe(0);
        });

        test("should return true when single step succeeds", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));

            const snap = mockSnapResult({ type: "center" });
            cmd.setSteps([mockStep(snap)]);

            const result = await cmd.runExecuteSteps();

            expect(result).toBe(true);
            expect(cmd.getStepDatas()).toEqual([snap]);
        });

        test("should clear selection after steps complete (when not restarting)", async () => {
            const cmd = new TestMultistepCommand();
            let clearSelectionCalled = false;
            const doc = mockDocument({
                selection: {
                    clearSelection: () => {
                        clearSelectionCalled = true;
                    },
                } as unknown as IDocument["selection"],
            });
            cmd.setApplication(mockApplication(doc));
            cmd.setRestarting(false);
            cmd.setSteps([mockStep(mockSnapResult())]);

            await cmd.runExecuteSteps();

            expect(clearSelectionCalled).toBe(true);
        });

        test("should NOT clear selection when restarting", async () => {
            const cmd = new TestMultistepCommand();
            let clearSelectionCalled = false;
            const doc = mockDocument({
                selection: {
                    clearSelection: () => {
                        clearSelectionCalled = true;
                    },
                } as unknown as IDocument["selection"],
            });
            cmd.setApplication(mockApplication(doc));
            cmd.setRestarting(true);
            cmd.setSteps([mockStep(mockSnapResult())]);

            await cmd.runExecuteSteps();

            expect(clearSelectionCalled).toBe(false);
        });
    });

    // ── executeAsync ─────────────────────────────────────────────────────

    describe("executeAsync", () => {
        test("should not call executeMainTask when canExcute returns false", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = false;
            cmd.setSteps([mockStep(mockSnapResult())]);

            await cmd.runExecuteAsync();

            expect(cmd.canExcuteCallCount).toBe(1);
            expect(cmd.executeMainTaskCallCount).toBe(0);
        });

        test("should not call executeMainTask when executeSteps returns false", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = true;
            cmd.setSteps([mockStep(undefined)]);

            await cmd.runExecuteAsync();

            expect(cmd.canExcuteCallCount).toBe(1);
            expect(cmd.executeMainTaskCallCount).toBe(0);
        });

        test("should call executeMainTask when both canExcute and executeSteps succeed", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = true;
            cmd.setSteps([mockStep(mockSnapResult())]);

            await cmd.runExecuteAsync();

            expect(cmd.executeMainTaskCallCount).toBe(1);
        });

        test("should handle zero steps with canExcute true", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = true;
            cmd.setSteps([]);

            await cmd.runExecuteAsync();

            expect(cmd.executeMainTaskCallCount).toBe(1);
        });
    });

    // ── stepDatas manipulation ───────────────────────────────────────────

    describe("stepDatas", () => {
        test("should support direct read and push via accessor", () => {
            const cmd = new TestMultistepCommand();
            const snap = mockSnapResult({ type: "vertex" });

            cmd.getStepDatas().push(snap);

            expect(cmd.getStepDatas().length).toBe(1);
            expect(cmd.getStepDatas()[0].type).toBe("vertex");
        });

        test("should be independent between instances", () => {
            const cmd1 = new TestMultistepCommand();
            const cmd2 = new TestMultistepCommand();

            cmd1.getStepDatas().push(mockSnapResult());
            cmd2.getStepDatas().push(mockSnapResult(), mockSnapResult());

            expect(cmd1.getStepDatas().length).toBe(1);
            expect(cmd2.getStepDatas().length).toBe(2);
        });
    });

    // ── Integration: full execute flow ───────────────────────────────────

    describe("execute (inherited from CancelableCommand)", () => {
        test("should complete full flow: canExcute → steps → mainTask", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = true;

            const snap1 = mockSnapResult({ type: "vertex" });
            const snap2 = mockSnapResult({ type: "end" });
            cmd.setSteps([mockStep(snap1), mockStep(snap2)]);

            await cmd.runExecuteAsync();

            expect(cmd.getStepDatas().length).toBe(2);
            expect(cmd.executeMainTaskCallCount).toBe(1);
        });

        test("should skip mainTask when first step fails", async () => {
            const cmd = new TestMultistepCommand();
            cmd.setApplication(mockApplication(mockDocument()));
            cmd.canExcuteResult = true;
            cmd.setSteps([mockStep(undefined), mockStep(mockSnapResult())]);

            await cmd.runExecuteAsync();

            expect(cmd.getStepDatas().length).toBe(0);
            expect(cmd.executeMainTaskCallCount).toBe(0);
        });
    });
});
