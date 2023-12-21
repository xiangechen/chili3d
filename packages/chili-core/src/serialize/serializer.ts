// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { ClassMap } from "./classMap";

export interface ISerialize {
    serialize(): Serialized;
}

export type Serialized = {
    classKey: string;
    properties: SerializedProperties<any>;
};

export type SerializedProperties<T> = {
    [P in keyof T]?: any;
};

interface RefelectData {
    ctor: new (...args: any[]) => any;
    ctorParamNames: string[];
    serialize?: (target: any) => SerializedProperties<any>;
    deserialize?: (...args: any[]) => any;
}

const propertiesMap = new Map<new (...args: any[]) => any, Set<string>>();
const reflectMap = new Map<string, RefelectData>();

export namespace Serializer {
    export function serialze() {
        return (target: any, property: string) => {
            let keys = propertiesMap.get(target);
            if (keys === undefined) {
                keys = new Set();
                propertiesMap.set(target, keys);
            }
            keys.add(property);
        };
    }

    export function register<T>(
        className: string,
        ctorParamNames: (keyof T & string)[],
        deserialize?: (...args: any[]) => T,
        serialize?: (target: T) => SerializedProperties<T>,
    ) {
        return (target: new (...args: any[]) => T) => {
            ClassMap.save(className, target);
            reflectMap.set(className, {
                ctor: target,
                ctorParamNames,
                serialize,
                deserialize,
            });
        };
    }
}

export namespace Serializer {
    /**
     * Deserialize an object
     *
     * @param document Document that contains the object.
     * @param data Serialize the data. If the serialized data does not contain
     * the parameters required by the deserialization function, these parameters
     * should be added to the serialized data, for example:
     * ```
     * data.properties[“parent”] = node.
     * ```
     * @returns Deserialized object
     */
    export function deserializeObject(document: IDocument, data: Serialized) {
        let instance = deserializeInstance(document, data.classKey, data.properties);
        deserializeProperties(document, instance, data);
        return instance;
    }

    function deserializeInstance(
        document: IDocument,
        className: string,
        properties: SerializedProperties<any>,
    ) {
        if (!reflectMap.has(className)) {
            throw new Error(
                `${className} cannot be deserialize. Did you forget to add the decorator @Serializer.register?`,
            );
        }

        const { ctor, ctorParamNames, deserialize } = reflectMap.get(className)!;
        const parameters = deserilizeParameters(document, ctorParamNames, properties, className);
        if (deserialize) {
            return deserialize(...ctorParamNames.map((x) => parameters[x]));
        } else {
            return new ctor(...ctorParamNames.map((x) => parameters[x]));
        }
    }

    function deserilizeParameters(
        document: IDocument,
        ctorParamNames: any[],
        properties: SerializedProperties<any>,
        className: string,
    ) {
        const parameters: SerializedProperties<any> = {};
        parameters["document"] = document;
        for (const key of ctorParamNames) {
            if (key in properties) {
                parameters[key] = deserialValue(document, properties[key]);
            } else if (key !== "document") {
                throw new Error(`${className} constructor parameter ${key} is missing`);
            }
        }
        return parameters;
    }

    function deserialValue(document: IDocument, value: any) {
        if (Array.isArray(value)) {
            return value.map((v) => {
                return typeof v === "object" ? deserializeObject(document, v) : v;
            });
        } else {
            return (value as Serialized).classKey ? deserializeObject(document, value) : value;
        }
    }

    function deserializeProperties(
        document: IDocument,
        instance: any,
        data: Serialized,
        ignores?: string[],
    ) {
        let { ctorParamNames } = reflectMap.get(data.classKey)!;
        const filter = (key: string) => {
            if (ctorParamNames.includes(key)) return false;
            if (ignores?.includes(key)) return false;
            return true;
        };
        let keys = Object.keys(data.properties).filter(filter);
        for (const key of keys) {
            instance[key] = deserialValue(document, data.properties[key]);
        }
    }
}

export namespace Serializer {
    export function serializeObject(target: Object): Serialized {
        let key = ClassMap.getKey(target.constructor as any);
        if (key === undefined)
            throw new Error(
                `Type ${target.constructor.name} is not registered, please add the @Serializer.register decorator.`,
            );
        let data: Serialized = {
            classKey: key,
            properties: {},
        };
        let properties = getAllKeysOfPrototypeChain(target, propertiesMap);
        serializeProperties(data.properties, target, properties);
        return data;
    }

    function serializeProperties(data: SerializedProperties<any>, target: Object, keys: Set<string>) {
        for (const key of keys) {
            let value = (target as any)[key];
            if (Array.isArray(value)) {
                data[key] = value.map((v) => serializePropertyValue(v));
            } else {
                data[key] = serializePropertyValue(value);
            }
        }
    }

    function serializePropertyValue(value: any) {
        let type = typeof value;
        if (type === "object") {
            return serializeObjectType(value);
        } else if (type !== "function" && type !== "symbol") {
            return value;
        } else {
            throw new Error(`Unsupported serialized object: ${value}`);
        }
    }

    function serializeObjectType(target: Object) {
        let key = ClassMap.getKey(target.constructor as any);
        if (key === undefined || !reflectMap.has(key)) {
            throw new Error(`Unsupported serialized object: ${target.constructor.name}`);
        }
        let data = reflectMap.get(key)!;
        if (data.serialize) {
            return {
                classKey: key,
                properties: data.serialize(target),
            };
        } else {
            return serializeObject(target);
        }
    }

    function getAllKeysOfPrototypeChain(target: Object, map: Map<new (...args: any[]) => any, Set<string>>) {
        let keys: string[] = [];
        let prototype = Object.getPrototypeOf(target);
        while (prototype !== null) {
            let k = map.get(prototype);
            if (k) keys.push(...k.values());
            prototype = Object.getPrototypeOf(prototype); // prototype chain
        }
        return new Set(keys);
    }
}
