// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IConverter } from "../converter";
import { I18n } from "../i18n";

export interface Property {
    display: keyof I18n;
    name: string;
    converter?: IConverter;
    group?: keyof I18n;
    icon?: string;
}

const PropertyKeyMap = new Map<Object, Map<keyof I18n, Property>>();

export namespace Property {
    export function define(display: keyof I18n, group?: keyof I18n, icon?: string, converter?: IConverter) {
        return (target: Object, name: string) => {
            if (!PropertyKeyMap.has(target)) {
                PropertyKeyMap.set(target, new Map<keyof I18n, Property>());
            }
            let props: Map<keyof I18n, Property> = PropertyKeyMap.get(target)!;
            props.set(display, {
                display,
                name,
                converter,
                group,
                icon,
            });
        };
    }

    export function getProperties(target: any): Property[] {
        let result: Property[] = [];
        getAllKeysOfPrototypeChain(target, result);
        return result;
    }

    function getAllKeysOfPrototypeChain(target: any, properties: Property[]) {
        if (!target) return;
        if (PropertyKeyMap.has(target)) {
            properties.push(...PropertyKeyMap.get(target)!.values());
        }
        getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties);
    }

    export function getProperty(target: any, display: keyof I18n): Property | undefined {
        if (target === undefined) return undefined;
        return PropertyKeyMap.get(target)?.get(display);
    }
}
