// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { INodeLinkedList } from "../model";

export type Serialized = {
    className: string;
    [property: string]: any;
};

export interface ISerialize {
    serialize(): Serialized;
}

export namespace Serializer {
    const serializeKeyMap = new Map<new (...args: any[]) => any, Set<string>>();
    const deserializeMap = new Map<string, (...args: any[]) => any>();

    export function enable() {
        return (target: any, property: string) => {
            saveKey(serializeKeyMap, target, property);
        };
    }

    function saveKey(map: Map<new (...args: any[]) => any, Set<string>>, target: any, property: string) {
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
     * data[“parent”] = node.
     * ```
     * @returns Deserialized object
     */
    export function deserialize(document: IDocument, data: Serialized) {
        if ("firstChild" in data || "nextSibling" in data) {
            return nodeDescrialize(document, data, data["parent"]);
        } else {
            return deserializeWithSkips(document, data);
        }
    }

    function nodeDescrialize(
        document: IDocument,
        data: Serialized,
        parent?: INodeLinkedList,
        addSibling?: boolean
    ) {
        if (data === undefined) return;
        let node = deserializeWithSkips(document, data, ["firstChild", "nextSibling"]);
        parent?.add(node);
        if (data["firstChild"]) nodeDescrialize(document, data["firstChild"], node, true);
        if (addSibling && data["nextSibling"]) nodeDescrialize(document, data["nextSibling"], parent, true);
        return node;
    }

    function deserializeWithSkips(document: IDocument, data: Serialized, skips?: string[]) {
        data["document"] = document;
        let deserialized = {} as any;
        for (const key of Object.keys(data)) {
            if (skips?.includes(key)) continue;
            deserialized[key] = data[key].className ? deserialize(document, data[key]) : data[key];
        }
        let instance = deserializeMap.get(data.className)?.(deserialized);
        if (instance === undefined) throw new Error(`${data.className} cannot be deserialized`);
        return instance;
    }

    export function serialize(target: ISerialize): Serialized {
        let data: Serialized = {
            className: target.constructor.name,
        };
        let keys = getKeys(target, serializeKeyMap);
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
        return data;
    }

    function getKeys(target: ISerialize, map: Map<new (...args: any[]) => any, Set<string>>) {
        let keys: string[] = [];
        let prototype = Object.getPrototypeOf(target);
        while (prototype !== null) {
            let k = map.get(prototype);
            if (k) keys.push(...k.values());
            prototype = Object.getPrototypeOf(prototype);
        }
        return new Set(keys);
    }
}
