// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter } from "chili-shared";

export interface Parameter {
    category: string;
    display: string;
    property: string;
    descriptor: PropertyDescriptor;
    converter?: IConverter;
}

export function parameter(category: string, display: string, converter?: IConverter) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
        if (target.parameters === undefined) target.parameters = new Array<Parameter>();
        target.parameters.push({
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
        return Object.getPrototypeOf(target).parameters ?? [];
    }
}
