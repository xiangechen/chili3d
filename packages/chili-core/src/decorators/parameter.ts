// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter } from "../converter";
import { I18n } from "../i18n";

export interface Property {
    display: keyof I18n;
    name: string;
    converter?: IConverter;
}

const PropertyKey = Symbol("PropertyKey");

export function property(display: keyof I18n, converter?: IConverter) {
    return (target: any, name: string) => {
        if (!Reflect.hasMetadata(PropertyKey, target)) {
            Reflect.defineMetadata(PropertyKey, new Map<keyof I18n, Property>(), target);
        }
        let props: Map<keyof I18n, Property> = Reflect.getMetadata(PropertyKey, target);
        props.set(display, {
            display,
            name,
            converter,
        });
    };
}

export namespace Property {
    export function getAll(target: any): Property[] {
        if (target === undefined) return [];
        return Reflect.getMetadata(PropertyKey, target) ?? [];
    }

    export function get(target: any, display: keyof I18n): Property | undefined {
        if (target === undefined) return undefined;
        return Reflect.getMetadata(PropertyKey, target)?.get(display);
    }
}
