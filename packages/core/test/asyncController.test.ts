// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, type AsyncResult } from "../src";

describe("AsyncController", () => {
    let controller: AsyncController;

    beforeEach(() => {
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    describe("initial state", () => {
        test("should have undefined result initially", () => {
            expect(controller.result).toBeUndefined();
        });
    });

    describe("success", () => {
        test("should set result status to success", () => {
            controller.success();
            expect(controller.result?.status).toBe("success");
        });

        test("should set result message when provided", () => {
            controller.success("done");
            expect(controller.result?.message).toBe("done");
        });

        test("should call success listeners", () => {
            let receivedResult: AsyncResult | undefined;
            controller.onCompleted((result) => {
                receivedResult = result;
            });
            controller.success("completed");
            expect(receivedResult?.status).toBe("success");
            expect(receivedResult?.message).toBe("completed");
        });

        test("should only trigger once", () => {
            let callCount = 0;
            controller.onCompleted(() => callCount++);
            controller.success();
            controller.success();
            expect(callCount).toBe(1);
        });
    });

    describe("fail", () => {
        test("should set result status to fail", () => {
            controller.fail();
            expect(controller.result?.status).toBe("fail");
        });

        test("should set result message when provided", () => {
            controller.fail("error occurred");
            expect(controller.result?.message).toBe("error occurred");
        });

        test("should call fail listeners", () => {
            let receivedResult: AsyncResult | undefined;
            controller.onCancelled((result) => {
                receivedResult = result;
            });
            controller.fail("failed");
            expect(receivedResult?.status).toBe("fail");
            expect(receivedResult?.message).toBe("failed");
        });
    });

    describe("cancel", () => {
        test("should set result status to cancel", () => {
            controller.cancel();
            expect(controller.result?.status).toBe("cancel");
        });

        test("should set result message when provided", () => {
            controller.cancel("user cancelled");
            expect(controller.result?.message).toBe("user cancelled");
        });

        test("should call cancelled listeners", () => {
            let receivedResult: AsyncResult | undefined;
            controller.onCancelled((result) => {
                receivedResult = result;
            });
            controller.cancel("cancelled");
            expect(receivedResult?.status).toBe("cancel");
            expect(receivedResult?.message).toBe("cancelled");
        });
    });

    describe("multiple listeners", () => {
        test("should call all success listeners", () => {
            let count = 0;
            controller.onCompleted(() => count++);
            controller.onCompleted(() => count++);
            controller.onCompleted(() => count++);
            controller.success();
            expect(count).toBe(3);
        });

        test("should call all cancelled listeners", () => {
            let count = 0;
            controller.onCancelled(() => count++);
            controller.onCancelled(() => count++);
            controller.cancel();
            expect(count).toBe(2);
        });
    });

    describe("result immutability", () => {
        test("should not change result after first completion", () => {
            controller.success("first");
            controller.fail("second");
            controller.cancel("third");
            expect(controller.result?.status).toBe("success");
            expect(controller.result?.message).toBe("first");
        });

        test("should not notify listeners after first completion", () => {
            let successCount = 0;
            let failCount = 0;
            controller.onCompleted(() => successCount++);
            controller.onCancelled(() => failCount++);

            controller.success();
            controller.fail();
            controller.cancel();

            expect(successCount).toBe(1);
            expect(failCount).toBe(0);
        });
    });

    describe("dispose", () => {
        test("should clear all listeners", () => {
            let count = 0;
            controller.onCompleted(() => count++);
            controller.onCancelled(() => count++);
            controller.dispose();
            controller.success();
            controller.fail();
            expect(count).toBe(0);
        });
    });
});
