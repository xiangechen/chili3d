// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IConverter } from "chili-shared";

export interface Parameter {
    category: string;
    display: keyof I18n;
    property: string;
    descriptor: PropertyDescriptor;
    converter?: IConverter;
}

const PARAMATERS = "PARAMATERS";

export function parameter(category: string, display: keyof I18n, converter?: IConverter) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
        let params: Parameter[] = Reflect.getMetadata(PARAMATERS, target);
        if (params === undefined) {
            params = [];
            Reflect.defineMetadata(PARAMATERS, params, target);
        }

        params.push({
            category,
            display,
            property: propertyName,
            descriptor,
            converter,
        });
    };
}

export namespace Parameter {
    export function getAll(target: any): Parameter[] {
        return Reflect.getMetadata(PARAMATERS, target) ?? [];
    }
}
