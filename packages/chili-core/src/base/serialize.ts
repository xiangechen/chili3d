// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { INodeLinkedList } from "../model";

export type Properties = {
    [key: string]: any;
};

export type PropertySetter = "constructor" | "assignment" | ((obj: any, value: any) => void);

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

    /**
     * Decorator used to indicate whether a property is serialized
     * @param setter The way to set properties during deserialization.
     * The default value is "assignment".
     * @returns decorator
     */
    export function property(setter: PropertySetter = "assignment") {
        return (target: any, property: string) => {
            if (setter === "constructor") {
                saveKey(constructorParametersMap, target, property);
            } else {
                saveKey(propertiesMap, target, property);
            }
            if (typeof setter === "function") {
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
            let instance = deserializeInstance(document, data.className, data.constructorParameters);
            deserializeProperties(document, instance, data.properties);
            return instance;
        }
    }

    function nodeDescrialize(
        document: IDocument,
        data: Serialized,
        parent?: INodeLinkedList,
        addSibling?: boolean,
    ) {
        let node = deserializeInstance(document, data.className, data.constructorParameters);
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

    function deserializeInstance(document: IDocument, className: string, constructorParameters: Properties) {
        let parameters: Properties = {};
        parameters["document"] = document;
        for (const key of Object.keys(constructorParameters)) {
            parameters[key] = deserialValue(document, constructorParameters[key]);
        }
        let instance = deserializeMap.get(className)?.(parameters);
        if (instance === undefined) throw new Error(`${className} cannot be deserialized`);
        return instance;
    }

    function deserialValue(document: IDocument, value: any) {
        if (Array.isArray(value)) {
            return value.map((v) => {
                return typeof v === "object" ? deserialize(document, v) : v;
            });
        } else {
            return value.className ? deserialize(document, value) : value;
        }
    }

    function deserializeProperties(document: IDocument, instance: any, properties: Properties) {
        for (const key of Object.keys(properties)) {
            setPropertyValue(document, instance, key, properties[key]);
        }
    }

    function setPropertyValue(document: IDocument, instance: any, key: string, value: any) {
        let ivalue = deserialValue(document, value);
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
        let properties = getAllKeysOfPrototypeChain(target, propertiesMap);
        let parameters = getAllKeysOfPrototypeChain(target, constructorParametersMap);
        serializeProperties(data.properties, target, properties);
        serializeProperties(data.constructorParameters, target, parameters);
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
        if (type === "object" && (value as ISerialize).serialize.length === 0) {
            return value.serialize();
        } else if (type !== "function" && type !== "symbol") {
            return value;
        } else {
            throw new Error("Unsupported serialized object");
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
