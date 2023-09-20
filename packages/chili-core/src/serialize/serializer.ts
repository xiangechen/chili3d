// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { INodeLinkedList } from "../model";
import { ClassMap } from "./classMap";

export type Properties = {
    [key: string]: any;
};

export type Serialized = {
    classKey: string;
    properties: Properties;
};

export interface ISerialize {
    serialize(): Serialized;
}

export interface RefelectData {
    ctor: new (...args: any[]) => any;
    parameterNames: string[];
    deserializer?: (...args: any[]) => any;
}

export namespace Serializer {
    const propertiesMap = new Map<new (...args: any[]) => any, Set<string>>();
    const reflectMap = new Map<string, RefelectData>();

    /**
     * Decorator used to indicate whether a property is serialized
     */
    export function property() {
        return (target: any, property: string) => {
            let keys = propertiesMap.get(target);
            if (keys === undefined) {
                keys = new Set();
                propertiesMap.set(target, keys);
            }
            keys.add(property);
        };
    }

    export function register<T extends ISerialize>(
        className: string,
        parameterNames: (keyof T & string)[],
        deserializer?: (...args: any[]) => T,
    ) {
        return (target: new (...args: any[]) => T) => {
            ClassMap.save(className, target);
            reflectMap.set(className, {
                ctor: target,
                parameterNames,
                deserializer,
            });
        };
    }

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
    export function deserialize(document: IDocument, data: Serialized) {
        if ("firstChild" in data.properties || "nextSibling" in data.properties) {
            return nodeDescrialize(document, data, data.properties["parent"]);
        } else {
            let instance = deserializeInstance(document, data.classKey, data.properties);
            deserializeProperties(document, instance, data);
            return instance;
        }
    }

    function nodeDescrialize(
        document: IDocument,
        data: Serialized,
        parent?: INodeLinkedList,
        addSibling?: boolean,
    ) {
        let node = deserializeInstance(document, data.classKey, data.properties);
        parent?.add(node);
        let nodeProperties: (keyof INodeLinkedList)[] = ["firstChild", "nextSibling"];
        for (const p of nodeProperties) {
            let value = data.properties[p];
            if (value === undefined) continue;
            if (p === "firstChild") {
                nodeDescrialize(document, value, node, true);
            } else if (addSibling && p === "nextSibling") {
                nodeDescrialize(document, value, parent, true);
            }
        }
        deserializeProperties(document, node, data, nodeProperties);
        return node;
    }

    function deserializeInstance(document: IDocument, className: string, properties: Properties) {
        if (!reflectMap.has(className))
            throw new Error(
                `${className} cannot be deserialize. Did you forget to add the decorator @Serializer.register?`,
            );

        const { ctor, parameterNames, deserializer } = reflectMap.get(className)!;
        const parameters = deserilizeParameters(document, parameterNames, properties, className);
        if (deserializer) {
            return deserializer(...parameterNames.map((x) => parameters[x]));
        } else {
            return new ctor(...parameterNames.map((x) => parameters[x]));
        }
    }

    function deserilizeParameters(
        document: IDocument,
        parameterNames: any[],
        properties: Properties,
        className: string,
    ) {
        const parameters: Properties = {};
        parameters["document"] = document;
        for (const key of parameterNames) {
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
                return typeof v === "object" ? deserialize(document, v) : v;
            });
        } else {
            return (value as Serialized).classKey ? deserialize(document, value) : value;
        }
    }

    function deserializeProperties(
        document: IDocument,
        instance: any,
        data: Serialized,
        ignores?: string[],
    ) {
        let { parameterNames: constructorParameterNames } = reflectMap.get(data.classKey)!;
        const filter = (key: string) => {
            if (constructorParameterNames.includes(key)) return false;
            if (ignores?.includes(key)) return false;
            return true;
        };
        let keys = Object.keys(data.properties).filter(filter);
        for (const key of keys) {
            instance[key] = deserialValue(document, data.properties[key]);
        }
    }

    export function serialize(target: ISerialize): Serialized {
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

    function serializeProperties(data: Properties, target: ISerialize, keys: Set<string>) {
        for (const key of keys) {
            let value = (target as any)[key];
            if (Array.isArray(value)) {
                data[key] = value.map((v) => serializeObject(v));
            } else {
                data[key] = serializeObject(value);
            }
        }
    }

    function serializeObject(value: any) {
        let type = typeof value;
        if (type === "object") {
            if ((value as ISerialize).serialize?.length === 0) return value.serialize();
            throw new Error(
                `${value.constructor.name} cannot be serialized, please implement the ISerialize interface`,
            );
        } else if (type !== "function" && type !== "symbol") {
            return value;
        } else {
            throw new Error(`Unsupported serialized object: ${value}`);
        }
    }

    function getAllKeysOfPrototypeChain(
        target: ISerialize,
        map: Map<new (...args: any[]) => any, Set<string>>,
    ) {
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
