// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IConverter, ObservableBase } from "chili-shared";

export interface Parameter {
    category: string;
    display: keyof I18n;
    property: string;
    converter?: IConverter;
}

const PARAMATERS = "PARAMATERS";

export function parameter(category: string, display: keyof I18n, converter?: IConverter) {
    return (target: any, propertyName: string) => {
        let params: Parameter[] = Reflect.getMetadata(PARAMATERS, target);
        if (params === undefined) {
            params = [];
            Reflect.defineMetadata(PARAMATERS, params, target);
        }

        params.push({
            category,
            display,
            property: propertyName,
            converter,
        });
    };
}

export function notify() {
    return (target: any, propertyName: string) => {
        target.createProperty(propertyName);
    };
}

export namespace Parameter {
    export function getAll(target: any): Parameter[] {
        return Reflect.getMetadata(PARAMATERS, target) ?? [];
    }
}
