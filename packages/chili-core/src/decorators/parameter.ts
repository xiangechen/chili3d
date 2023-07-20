// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter } from "../converter";
import { I18n } from "../i18n";

export interface Property {
    display: keyof I18n;
    name: string;
    converter?: IConverter;
}

const PropertyKeyMap = new Map<Object, Map<keyof I18n, Property>>();

export function property(display: keyof I18n, converter?: IConverter) {
    return (target: Object, name: string) => {
        if (!PropertyKeyMap.has(target)) {
            PropertyKeyMap.set(target, new Map<keyof I18n, Property>());
        }
        let props: Map<keyof I18n, Property> = PropertyKeyMap.get(target)!;
        props.set(display, {
            display,
            name,
            converter,
        });
    };
}

export namespace Property {
    export function getAll(target: any): Property[] {
        let result: Property[] = [];
        getAllKeysOfPrototypeChain(target, result);
        return result;
    }

    function getAllKeysOfPrototypeChain(target: Object, properties: Property[]) {
        let map = PropertyKeyMap.get(target);
        if (map) {
            for (const p of map.values()) {
                properties.push(p);
            }
        }
        if (target) getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties);
    }

    export function get(target: any, display: keyof I18n): Property | undefined {
        if (target === undefined) return undefined;
        return PropertyKeyMap.get(target)?.get(display);
    }
}
