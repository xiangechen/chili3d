// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";

interface ErrorReport {
    message: unknown;
    optionalParams: unknown[];
}

const MAX_STARTUP_ERRORS = 100;

export function installApplicationErrorCapture(): () => void {
    let ready = false;
    let pending: ErrorReport[] = [];
    const report = (message: unknown, optionalParams: unknown[]) => {
        if (ready) {
            PubSub.default.pub("applicationError", message, optionalParams);
            return;
        }
        pending.push({ message, optionalParams });
        if (pending.length > MAX_STARTUP_ERRORS) pending.shift();
    };
    const onReady = () => {
        if (ready) return;
        ready = true;
        const buffered = pending;
        pending = [];
        for (const error of buffered) report(error.message, error.optionalParams);
    };
    const onError = (event: ErrorEvent) => {
        const location = event.filename ? `\n${event.filename}:${event.lineno}:${event.colno}` : "";
        report(event.error ?? `${event.message}${location}`, []);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => report(event.reason, []);
    const onLoggerError = (message: unknown, optionalParams: unknown[]) => {
        // Once ready, ErrorStatus subscribes directly; forwarding here too would double-count it.
        if (!ready) report(message, optionalParams);
    };

    PubSub.default.sub("loggerError", onLoggerError);
    PubSub.default.sub("applicationErrorReady", onReady);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
        pending = [];
        PubSub.default.remove("loggerError", onLoggerError);
        PubSub.default.remove("applicationErrorReady", onReady);
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
}
