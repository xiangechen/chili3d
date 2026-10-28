// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { installApplicationErrorCapture } from "../src/errorCapture";

describe("application error capture", () => {
    let stop: (() => void) | undefined;

    afterEach(() => {
        stop?.();
        stop = undefined;
    });

    test("buffers startup errors until ready, then reports live errors and cleans up", () => {
        const listener = rs.fn((_message: unknown, _params: unknown[]) => {});
        PubSub.default.sub("applicationError", listener);
        stop = installApplicationErrorCapture();
        const startupError = new Error("startup boom");
        window.dispatchEvent(new ErrorEvent("error", { error: startupError }));
        const rejection = new Event("unhandledrejection");
        Object.defineProperty(rejection, "reason", { value: "rejection boom" });
        window.dispatchEvent(rejection);
        PubSub.default.pub("loggerError", "startup logger", []);
        expect(listener).not.toHaveBeenCalled();

        try {
            PubSub.default.pub("applicationErrorReady");
            expect(listener).toHaveBeenCalledTimes(3);
            expect(listener).toHaveBeenNthCalledWith(1, startupError, []);
            expect(listener).toHaveBeenNthCalledWith(2, "rejection boom", []);
            expect(listener).toHaveBeenNthCalledWith(3, "startup logger", []);

            PubSub.default.pub("applicationErrorReady");
            expect(listener).toHaveBeenCalledTimes(3);
            window.dispatchEvent(
                new ErrorEvent("error", { message: "live", filename: "live.ts", lineno: 3, colno: 4 }),
            );
            expect(listener).toHaveBeenNthCalledWith(4, "live\nlive.ts:3:4", []);
            PubSub.default.pub("loggerError", "live logger", []);
            expect(listener).toHaveBeenCalledTimes(4);

            stop();
            stop = undefined;
            window.dispatchEvent(new ErrorEvent("error", { message: "after cleanup" }));
            PubSub.default.pub("loggerError", "after cleanup logger", []);
            expect(listener).toHaveBeenCalledTimes(4);
        } finally {
            PubSub.default.remove("applicationError", listener);
        }
    });
});
