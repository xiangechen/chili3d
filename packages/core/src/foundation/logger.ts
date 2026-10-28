// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "./pubsub";

export type LoggerLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LoggerLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export class Logger {
    static level: LoggerLevel = "info";

    static isEnabled(level: LoggerLevel): boolean {
        return LEVEL_PRIORITY[Logger.level] <= LEVEL_PRIORITY[level];
    }

    static debug(message?: any, ...optionalParams: any[]) {
        if (Logger.isEnabled("debug")) {
            console.debug(message, ...optionalParams);
        }
    }

    static info(message?: any, ...optionalParams: any[]) {
        if (Logger.isEnabled("info")) {
            console.log(message, ...optionalParams);
        }
    }

    static warn(message?: any, ...optionalParams: any[]) {
        if (Logger.isEnabled("warn")) {
            console.warn(message, ...optionalParams);
        }
    }

    static error(message?: any, ...optionalParams: any[]) {
        if (Logger.isEnabled("error")) {
            PubSub.default.pub("loggerError", message, optionalParams);
            console.error(message, ...optionalParams);
        }
    }
}

// facilitate debugging
if (!__IS_PRODUCTION__) {
    Logger.debug = console.debug;
    Logger.info = console.log;
    Logger.warn = console.warn;
}
