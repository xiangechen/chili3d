// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

export class Logger {
    static debug(message?: any, ...optionalParams: any[]) {
        console.log(message, ...optionalParams);
    }

    static info(message?: any, ...optionalParams: any[]) {
        console.log(message, ...optionalParams);
    }

    static warn(message?: any, ...optionalParams: any[]) {
        console.warn(message, ...optionalParams);
    }

    static error(message?: any, ...optionalParams: any[]) {
        console.error(message, ...optionalParams);
    }
}

// facilitate debugging
Logger.info = console.log;
Logger.warn = console.warn;
Logger.debug = console.log;
Logger.error = console.error;
