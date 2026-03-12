// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type LoggerLevel = "debug" | "info" | "warn" | "error";

export class Logger {
    static level: LoggerLevel = "info";

    static debug(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= "debug") {
            console.debug(message, ...optionalParams);
        }
    }

    static info(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= "info") {
            console.log(message, ...optionalParams);
        }
    }

    static warn(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= "warn") {
            console.warn(message, ...optionalParams);
        }
    }

    static error(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= "error") {
            console.error(message, ...optionalParams);
        }
    }
}

// facilitate debugging
if (!__IS_PRODUCTION__) {
    Logger.debug = console.debug;
    Logger.info = console.log;
    Logger.warn = console.warn;
    Logger.error = console.error;
}
