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
        if (!Reflect.hasMetadata(PARAMATERS, target)) {
            Reflect.defineMetadata(PARAMATERS, [], target);
        }
        let params: Parameter[] = Reflect.getMetadata(PARAMATERS, target);
        params.push({
            category,
            display,
            property: propertyName,
            converter,
        });
    };
}

export namespace Parameter {
    export function getAll(target: any): Parameter[] {
        return Reflect.getMetadata(PARAMATERS, target) ?? [];
    }
}
