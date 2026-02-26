// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export enum LoggerLevel {
    Debug,
    Info,
    Warn,
    Error,
}

export class Logger {
    static level: LoggerLevel = LoggerLevel.Info;

    static debug(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= LoggerLevel.Debug) {
            console.debug(message, ...optionalParams);
        }
    }

    static info(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= LoggerLevel.Info) {
            console.log(message, ...optionalParams);
        }
    }

    static warn(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= LoggerLevel.Warn) {
            console.warn(message, ...optionalParams);
        }
    }

    static error(message?: any, ...optionalParams: any[]) {
        if (Logger.level <= LoggerLevel.Error) {
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
