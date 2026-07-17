// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../../src/document";
import { AsyncController } from "../../src/foundation";
import type { I18nKeys } from "../../src/i18n";
import { XYZ } from "../../src/math";
import type { SnapData, SnapEventHandler, SnapResult } from "../../src/snap";
import { SnapStep } from "../../src/step/step";
import type { CursorType } from "../../src/visual";
import { createMockSelection, TestDocument } from "../mocks";

// ============================================================================
// Test helpers — concrete SnapStep subclass for testing
// ============================================================================

interface TestStepData extends SnapData {
    _meta?: string;
}

/**
 * Minimal concrete SnapStep that records calls instead of performing real work.
 * This lets us exercise the abstract base-class execute() flow without real
 * pickers, views, or snap handlers.
 */
class TestSnapStep extends SnapStep<TestStepData> {
    public getEventHandlerCalls: {
        document: IDocument;
        controller: AsyncController;
        data: TestStepData;
    }[] = [];

    public validatorCalls: { data: TestStepData; point: XYZ }[] = [];
    public validatorReturnValue: boolean = true;

    /**
     * Optional interceptor that wraps the real validator.
     * Called AFTER the real validator runs; its return value replaces the real one.
     */
    public validatorInterceptor: ((data: TestStepData, point: XYZ) => boolean) | null = null;

    private _disposed: boolean = false;
    public get disposed(): boolean {
        return this._disposed;
    }

    constructor(
        tip: I18nKeys,
        handleStepData: () => TestStepData,
        keepSelected?: boolean,
        private readonly _snapedResult?: SnapResult,
    ) {
        super(tip, handleStepData, keepSelected);
    }

    protected getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: TestStepData,
    ): SnapEventHandler {
        this.getEventHandlerCalls.push({ document, controller, data });
        return {
            snaped: this._snapedResult,
            dispose: () => {
                this._disposed = true;
            },
            isEnabled: true,
            pointerMove: () => {},
            pointerDown: () => {},
            pointerUp: () => {},
            pointerOut: () => {},
            mouseWheel: () => {},
            keyDown: () => {},
        } as unknown as SnapEventHandler;
    }

    protected override validator(data: TestStepData, point: XYZ): boolean {
        this.validatorCalls.push({ data, point });
        if (this.validatorInterceptor) {
            return this.validatorInterceptor(data, point);
        }
        return this.validatorReturnValue;
    }
}

function tip(): string {
    return "test.tip" as unknown as string;
}

// ============================================================================
// SnapStep — base class execute() flow
// ============================================================================

describe("SnapStep", () => {
    describe("constructor and keepSelected", () => {
        test("should store tip", () => {
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            expect(step.tip).toBe(tip());
        });

        test("should default keepSelected to false (selection cleared)", async () => {
            const step = new TestSnapStep(tip() as never, () => ({}));
            const selection = createMockSelection();
            let cleared = false;
            selection.clearSelection = () => {
                cleared = true;
            };
            const doc = new TestDocument({ selection });
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(cleared).toBe(true);
            controller.dispose();
        });

        test("should not clear selection when keepSelected is true", async () => {
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            const selection = createMockSelection();
            let cleared = false;
            selection.clearSelection = () => {
                cleared = true;
            };
            const doc = new TestDocument({ selection });
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(cleared).toBe(false);
            controller.dispose();
        });
    });

    describe("execute", () => {
        test("should call handleStepData to get data", async () => {
            let dataCalled = false;
            const step = new TestSnapStep(
                tip() as never,
                () => {
                    dataCalled = true;
                    return {};
                },
                true,
            );
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(dataCalled).toBe(true);
            controller.dispose();
        });

        test("should call beforeExecute when provided", async () => {
            let beforeCalled = false;
            const step = new TestSnapStep(
                tip() as never,
                () => ({
                    beforeExecute: () => {
                        beforeCalled = true;
                    },
                }),
                true,
            );
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(beforeCalled).toBe(true);
            controller.dispose();
        });

        test("should call afterExecute when provided", async () => {
            let afterCalled = false;
            const step = new TestSnapStep(
                tip() as never,
                () => ({
                    afterExecute: () => {
                        afterCalled = true;
                    },
                }),
                true,
            );
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(afterCalled).toBe(true);
            controller.dispose();
        });

        test("should call getEventHandler with correct args", async () => {
            const testData = { _meta: "test" };
            const step = new TestSnapStep(tip() as never, () => testData, true);
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(step.getEventHandlerCalls.length).toBe(1);
            expect(step.getEventHandlerCalls[0].document).toBe(doc);
            expect(step.getEventHandlerCalls[0].controller).toBe(controller);
            expect(step.getEventHandlerCalls[0].data).toBe(testData);
            controller.dispose();
        });

        test("should pass correct tip and controller to pickAsync", async () => {
            let capturedTip: unknown;
            let capturedController: unknown;
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            const doc = new TestDocument();
            doc.picker.pickAsync = (_handler, tipStr, ctrl) => {
                capturedTip = tipStr;
                capturedController = ctrl;
                return Promise.resolve();
            };
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(capturedTip).toBe(tip());
            expect(capturedController).toBe(controller);
            controller.dispose();
        });

        test("should dispose handler after execution", async () => {
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(step.disposed).toBe(true);
            controller.dispose();
        });

        test("should return snaped when controller result is success", async () => {
            const snapedResult: SnapResult = { view: {} as never, shapes: [], type: "input" };
            const step = new TestSnapStep(tip() as never, () => ({}), true, snapedResult);
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();
            controller.success();

            const result = await step.execute(doc, controller);
            expect(result).toBe(snapedResult);
            controller.dispose();
        });

        test("should return undefined when controller is cancelled", async () => {
            const snapedResult: SnapResult = { view: {} as never, shapes: [], type: "input" };
            const step = new TestSnapStep(tip() as never, () => ({}), true, snapedResult);
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();
            controller.cancel();

            const result = await step.execute(doc, controller);
            expect(result).toBeUndefined();
            controller.dispose();
        });

        test("should return undefined when controller has no result", async () => {
            const snapedResult: SnapResult = { view: {} as never, shapes: [], type: "input" };
            const step = new TestSnapStep(tip() as never, () => ({}), true, snapedResult);
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();
            // Neither success nor cancel called — no result set

            const result = await step.execute(doc, controller);
            expect(result).toBeUndefined();
            controller.dispose();
        });

        test("should call beforeExecute before getEventHandler", async () => {
            const calls: string[] = [];
            const step = new TestSnapStep(
                tip() as never,
                () => ({
                    beforeExecute: () => {
                        calls.push("before");
                    },
                }),
                true,
            );
            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(calls).toEqual(["before"]);
            expect(step.getEventHandlerCalls.length).toBe(1);
            controller.dispose();
        });

        test("should pass cursor type 'draw' to pickAsync", async () => {
            let capturedCursor: CursorType | undefined;
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            const doc = new TestDocument();
            doc.picker.pickAsync = (_handler, _tip, _ctrl, _disableSnap, cursor) => {
                capturedCursor = cursor;
                return Promise.resolve();
            };
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(capturedCursor).toBe("draw");
            controller.dispose();
        });

        test("should clear selection on execute when keepSelected is false", async () => {
            const step = new TestSnapStep(tip() as never, () => ({}), false);
            const selection = createMockSelection();
            let cleared = false;
            selection.clearSelection = () => {
                cleared = true;
            };
            const doc = new TestDocument({ selection });
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);
            expect(cleared).toBe(true);
            controller.dispose();
        });
    });

    describe("validator wrapping", () => {
        test("wrapped validator should combine old and base validators", async () => {
            let oldCalled = false;
            let stepValidatorCalled = false;

            const step = new TestSnapStep(
                tip() as never,
                () => ({
                    validator: () => {
                        oldCalled = true;
                        return true;
                    },
                }),
                true,
            );
            // Use the interceptor to track when the base validator runs
            step.validatorInterceptor = (_data, _point) => {
                stepValidatorCalled = true;
                return true;
            };

            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            // execute() calls setValidator() internally which wraps data.validator
            await step.execute(doc, controller);

            // Get the wrapped validator from the data passed to getEventHandler
            const dataPassed = step.getEventHandlerCalls[0].data;
            expect(typeof dataPassed.validator).toBe("function");

            // Call the wrapped validator — it should call both validators
            expect(dataPassed.validator).toBeDefined();
            const point = new XYZ({ x: 100, y: 0, z: 0 });
            const result = dataPassed.validator?.(point);
            expect(result).toBe(true);
            expect(oldCalled).toBe(true);
            expect(stepValidatorCalled).toBe(true);
            controller.dispose();
        });

        test("wrapped validator should return false when base validator returns false", async () => {
            let oldCalled = false;

            const step = new TestSnapStep(
                tip() as never,
                () => ({
                    validator: () => {
                        oldCalled = true;
                        return true;
                    },
                }),
                true,
            );
            step.validatorReturnValue = false;

            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);

            const dataPassed = step.getEventHandlerCalls[0].data;
            expect(dataPassed.validator).toBeDefined();
            const point = new XYZ({ x: 0, y: 0, z: 0 });
            const result = dataPassed.validator?.(point);
            expect(result).toBe(false);
            expect(oldCalled).toBe(true);
            controller.dispose();
        });

        test("wrapped validator should work when no old validator exists", async () => {
            const step = new TestSnapStep(tip() as never, () => ({}), true);
            step.validatorReturnValue = true;

            const doc = new TestDocument();
            doc.picker.pickAsync = () => Promise.resolve();
            const controller = new AsyncController();

            await step.execute(doc, controller);

            const dataPassed = step.getEventHandlerCalls[0].data;
            // Since there was no old validator, the wrapped one should just be the base
            expect(typeof dataPassed.validator).toBe("function");
            const point = new XYZ({ x: 100, y: 0, z: 0 });
            const result = dataPassed.validator?.(point);
            expect(result).toBe(true);
            controller.dispose();
        });
    });
});
