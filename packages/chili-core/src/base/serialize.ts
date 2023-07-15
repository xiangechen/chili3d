// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { INodeLinkedList } from "../model";

export type Properties = {
    [key: string]: any;
};

export type Serialized = {
    className: string;
    properties: Properties;
    constructorParameters: Properties;
};

export interface ISerialize {
    serialize(): Serialized;
}

export namespace Serializer {
    const propertiesMap = new Map<new (...args: any[]) => any, Set<string>>();
    const constructorParametersMap = new Map<new (...args: any[]) => any, Set<string>>();
    const deserializeMap = new Map<string, (...args: any[]) => any>();
    const setters = new Map<string, Map<string, (obj: any, value: any) => void>>();

    export function constructorParameter() {
        return (target: any, property: string) => {
            saveKey(constructorParametersMap, target, property);
        };
    }

    export function property(setter?: (obj: any, value: any) => void) {
        return (target: any, property: string) => {
            saveKey(propertiesMap, target, property);
            if (setter) {
                let map = setters.get(target.name);
                if (map === undefined) {
                    map = new Map();
                    setters.set(target.name, map);
                }
                map.set(property, setter);
            }
        };
    }

    function saveKey(map: Map<new (...args: any[]) => any, Set<any>>, target: any, property: string) {
        let keys = map.get(target);
        if (keys === undefined) {
            keys = new Set();
            map.set(target, keys);
        }
        keys.add(property);
    }

    export function deserializer() {
        return (target: any, name: string) => {
            deserializeMap.set(target.name, target[name]);
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
            let instance = deserializeInstance(document, data);
            deserializeProperties(document, instance, data.properties);
            return instance;
        }
    }

    function nodeDescrialize(
        document: IDocument,
        data: Serialized,
        parent?: INodeLinkedList,
        addSibling?: boolean
    ) {
        let node = deserializeInstance(document, data);
        parent?.add(node);
        for (const key of Object.keys(data.properties)) {
            let value = data.properties[key];
            if (value === undefined) continue;
            if (key === "firstChild") {
                nodeDescrialize(document, value, node, true);
            } else if (addSibling && key === "nextSibling") {
                nodeDescrialize(document, value, parent, true);
            } else {
                setPropertyValue(document, node, key, value);
            }
        }
        return node;
    }

    function deserializeInstance(document: IDocument, data: Serialized) {
        let parameters: Properties = {};
        parameters["document"] = document;
        for (const key of Object.keys(data.constructorParameters)) {
            let v = data.constructorParameters[key];
            parameters[key] = v.className ? deserialize(document, v) : v;
        }
        let instance = deserializeMap.get(data.className)?.(parameters);
        if (instance === undefined) throw new Error(`${data.className} cannot be deserialized`);
        return instance;
    }

    function deserializeProperties(document: IDocument, instance: any, properties: Properties) {
        for (const key of Object.keys(properties)) {
            setPropertyValue(document, instance, key, properties[key]);
        }
    }

    function setPropertyValue(document: IDocument, instance: any, key: string, value: any) {
        let ivalue = value;
        if (value?.className) {
            ivalue = deserialize(document, value);
        }
        let setter = setters.get(value?.className)?.get(key);
        if (setter) {
            setter(instance, ivalue);
        } else {
            instance[key] = ivalue;
        }
    }

    export function serialize(target: ISerialize): Serialized {
        let data: Serialized = {
            className: target.constructor.name,
            properties: {},
            constructorParameters: {},
        };
        let properties = getKeys(target, propertiesMap);
        let parameters = getKeys(target, constructorParametersMap);
        serializeProperties(data.properties, target, properties);
        serializeProperties(data.constructorParameters, target, parameters);
        return data;
    }

    function serializeProperties(data: Properties, target: ISerialize, keys: Set<string>) {
        for (const key of keys) {
            let value = (target as any)[key];
            let type = typeof value;
            if (type === "object" && (value as ISerialize).serialize) {
                data[key] = value.serialize();
            } else if (type !== "function" && type !== "symbol") {
                data[key] = value;
            } else {
                throw new Error("Unsupported serialized object");
            }
        }
    }

    function getKeys(target: ISerialize, map: Map<new (...args: any[]) => any, Set<string>>) {
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
