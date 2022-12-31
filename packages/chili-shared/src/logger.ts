// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export class Logger {
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
