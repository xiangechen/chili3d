// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter } from "./foundation";
import { I18nKeys } from "./i18n";

export type PropertyType = "color" | "materialId";

export interface Property {
    name: string;
    display: I18nKeys;
    converter?: IConverter;
    group?: I18nKeys;
    icon?: string;
    type?: PropertyType;
    dependencies?: {
        property: string | number | symbol;
        value: any;
    }[];
}

const PropertyKeyMap = new Map<Object, Map<string | number | symbol, Property>>();

export namespace Property {
    export function define(display: I18nKeys, parameters?: Omit<Property, "name" | "display">) {
        return (target: Object, name: string) => {
            if (!PropertyKeyMap.has(target)) {
                PropertyKeyMap.set(target, new Map());
            }
            PropertyKeyMap.get(target)?.set(name, { display, name, ...parameters });
        };
    }

    export function getProperties(target: any, until?: object): Property[] {
        const result: Property[] = [];
        getAllKeysOfPrototypeChain(target, result, until);
        return result;
    }

    export function getOwnProperties(target: any): Property[] {
        const properties = PropertyKeyMap.get(target);
        if (!properties) return [];
        return [...properties.values()];
    }

    function getAllKeysOfPrototypeChain(target: any, properties: Property[], until?: object) {
        if (!target || target === until) return;
        if (PropertyKeyMap.has(target)) {
            properties.splice(0, 0, ...PropertyKeyMap.get(target)!.values());
        }
        getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties, until);
    }

    export function getProperty<T extends Object>(target: T, property: keyof T): Property | undefined {
        if (!target) return undefined;
        let map = PropertyKeyMap.get(target);
        if (map?.has(property)) return map.get(property);
        return getProperty(Object.getPrototypeOf(target), property);
    }
}
