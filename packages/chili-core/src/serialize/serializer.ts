// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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

export function serializeTypeArray(TypeArray: new (array: number[]) => Float32Array | Uint32Array): RefelectData {
    return {
        ctor: TypeArray,
        ctorParamNames: ["buffer"],
        serialize: (target: Float16Array | Uint32Array) => {
            return {
                buffer: Array.from(target),
            };
        },
        deserialize: (buffer) => {
            return new TypeArray(buffer);
        },
    }
}

const propertiesMap = new Map<new (...args: any[]) => any, Set<string>>();
const reflectMap = new Map<string, RefelectData>();
reflectMap.set("Float32Array", serializeTypeArray(Float32Array));
reflectMap.set("Uint32Array", serializeTypeArray(Uint32Array));

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
        ctorParamNames: (keyof T & string)[],
        deserialize?: (...args: any[]) => T,
        serialize?: (target: T) => SerializedProperties<T>,
    ) {
        return (target: new (...args: any[]) => T) => {
            ClassMap.save(target.name, target);
            reflectMap.set(target.name, {
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
        }
        return new ctor(...ctorParamNames.map((x) => parameters[x]));
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
                if (properties[key] !== undefined)
                    parameters[key] = deserialValue(document, properties[key]);
            } else if (key !== "document") {
                parameters[key] = undefined;
                console.warn(`${className} constructor parameter ${key} is missing`);
            }
        }
        return parameters;
    }

    function deserialValue(document: IDocument, value: any) {
        if (value === undefined) {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.map((v) => {
                return typeof v === "object" ? deserializeObject(document, v) : v;
            });
        }
        return (value as Serialized).classKey ? deserializeObject(document, value) : value;
    }

    function deserializeProperties(
        document: IDocument,
        instance: any,
        data: Serialized,
        ignores?: string[],
    ) {
        let { ctorParamNames } = reflectMap.get(data.classKey)!;
        const filter = (key: string) => {
            return !ctorParamNames.includes(key) && !ignores?.includes(key);
        };
        let keys = Object.keys(data.properties).filter(filter);
        for (const key of keys) {
            instance[key] = deserialValue(document, data.properties[key]);
        }
    }
}

export namespace Serializer {
    export function serializeObject(target: Object) {
        let classKey = target.constructor.name;
        if (!reflectMap.has(classKey)) {
            console.log(target);

            throw new Error(
                `Type ${target.constructor.name} is not registered, please add the @Serializer.register decorator.`,
            );
        }
        let data = reflectMap.get(classKey)!;
        let properties = data.serialize?.(target) ?? serializeProperties(target);
        return {
            classKey,
            properties,
        };
    }

    export function serializeProperties(target: Object) {
        let data: SerializedProperties<any> = {};
        let keys = getAllKeysOfPrototypeChain(target, propertiesMap);
        for (const key of keys) {
            let value = (target as any)[key];
            if (Array.isArray(value)) {
                data[key] = value.map((v) => serializePropertyValue(v));
            } else {
                data[key] = serializePropertyValue(value);
            }
        }
        return data;
    }

    function serializePropertyValue(value: any) {
        let type = typeof value;
        if (type === "object") {
            return serializeObject(value);
        }
        if (type !== "function" && type !== "symbol") {
            return value;
        }
        throw new Error(`Unsupported serialized object: ${value}`);
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
