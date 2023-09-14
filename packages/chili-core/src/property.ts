// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IConverter } from "./converter";
import { I18nKeys } from "./i18n";

export interface Property {
    name: string;
    display: I18nKeys;
    converter?: IConverter;
    group?: I18nKeys;
    icon?: string;
    dependencies?: {
        property: string | number | symbol;
        value: any;
    }[];
}

const PropertyKeyMap = new Map<Object, Map<string | number | symbol, Property>>();

export namespace Property {
    export function define(display: I18nKeys, group?: I18nKeys, icon?: string) {
        return (target: Object, name: string) => {
            setProperty(target, name, { display, group, icon });
        };
    }

    export function converter(converter: IConverter) {
        return (target: Object, name: string) => {
            setProperty(target, name, { converter });
        };
    }

    export function dependence<T extends object, K extends keyof T>(property: K, value: T[K]) {
        return (target: T, name: string) => {
            let dependencies = PropertyKeyMap.get(target)?.get(name)?.dependencies ?? [];
            dependencies.push({ property, value });
            setProperty(target, name, { dependencies });
        };
    }

    function setProperty(target: Object, name: string, property: any) {
        if (!PropertyKeyMap.has(target)) {
            PropertyKeyMap.set(target, new Map());
        }
        let propMap = PropertyKeyMap.get(target)!;
        propMap.set(name, {
            name,
            ...property,
            ...propMap.get(name),
        });
    }

    export function getProperties(target: any): Property[] {
        let result: Property[] = [];
        getAllKeysOfPrototypeChain(target, result);
        return result;
    }

    function getAllKeysOfPrototypeChain(target: any, properties: Property[]) {
        if (!target) return;
        if (PropertyKeyMap.has(target)) {
            properties.splice(0, 0, ...PropertyKeyMap.get(target)!.values());
        }
        getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties);
    }

    export function getProperty<T extends Object>(target: T, property: keyof T): Property | undefined {
        if (target === undefined) return undefined;
        if (PropertyKeyMap.has(target)) {
            return PropertyKeyMap.get(target)!.get(property);
        }
        return getProperty(Object.getPrototypeOf(target), property);
    }
}
