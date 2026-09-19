// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IConverter } from "./foundation";
import type { I18nKeys } from "./i18n";
import type { UnitSpec } from "./parameters/unitSpec";
import type { Combobox } from "./ui";

/** The controls that are more than a plain value editor; everything else edits by value. */
export type PropertyType = "color" | "materialId";

export interface Property {
    name: string;
    display: I18nKeys;
    converter?: IConverter;
    group?: I18nKeys;
    icon?: string;
    type?: PropertyType;
    /**
     * What this value measures. Marking a property with a unit is what makes its editor
     * accept an expression beside a literal — the unit decides whether one resolves, and
     * a value that does not fit it is refused. It is also what a units-aware display layer
     * would read to know whether to show millimetres or degrees.
     */
    unit?: UnitSpec;
    dependencies?: {
        property: string | number | symbol;
        value: any;
    }[];
    combobox?: Combobox<any>;
}

const PropertyKeyMap = new Map<object, Map<string | number | symbol, Property>>();
const hiddenCommandPropertiesMap = new Map<object, Set<string | number | symbol>>();

export function property(display: I18nKeys, parameters?: Omit<Property, "name" | "display">) {
    return (target: object, name: string) => {
        if (!PropertyKeyMap.has(target)) {
            PropertyKeyMap.set(target, new Map());
        }
        PropertyKeyMap.get(target)?.set(name, { display, name, ...parameters });
    };
}

export function hideCommandProperty<T extends object>(target: T, props: (keyof T)[]) {
    if (!hiddenCommandPropertiesMap.has(target)) {
        hiddenCommandPropertiesMap.set(target, new Set(props));
    } else {
        const set = hiddenCommandPropertiesMap.get(target);
        for (const prop of props) {
            set!.add(prop);
        }
    }
}

export class PropertyUtils {
    static getProperties(target: any, until?: object): Property[] {
        const result: Property[] = [];
        PropertyUtils.getAllKeysOfPrototypeChain(target, result, until);
        return result;
    }

    static getOwnProperties(target: any): Property[] {
        const properties = PropertyKeyMap.get(target);
        if (!properties) return [];
        return [...properties.values()];
    }

    private static getAllKeysOfPrototypeChain(target: any, properties: Property[], until?: object) {
        if (!target || target === until) return;
        if (PropertyKeyMap.has(target)) {
            properties.splice(0, 0, ...PropertyKeyMap.get(target)!.values());
        }
        PropertyUtils.getAllKeysOfPrototypeChain(Object.getPrototypeOf(target), properties, until);
    }

    static getProperty<T extends object>(target: T, property: keyof T): Property | undefined {
        if (!target) return undefined;
        const map = PropertyKeyMap.get(target);
        if (map?.has(property)) return map.get(property);
        return PropertyUtils.getProperty(Object.getPrototypeOf(target), property);
    }

    static isHiddenProperty(target: any, property: string | number | symbol): boolean {
        if (!target) return false;
        const set = hiddenCommandPropertiesMap.get(target);
        if (set?.has(property)) return true;
        return PropertyUtils.isHiddenProperty(Object.getPrototypeOf(target), property);
    }
}
