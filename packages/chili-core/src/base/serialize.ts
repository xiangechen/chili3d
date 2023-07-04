// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "../document";
import { INodeLinkedList } from "../model";

export type Serialized = {
    className: string;
    [property: string]: any;
    deserializeSkips?: Set<string>;
};

export interface ISerialize {
    serialize(): Serialized;
}

export namespace Serialize {
    const serializeKeyMap = new Map<new (...args: any[]) => any, Set<string>>();
    const deSkipKeyMap = new Map<new (...args: any[]) => any, Set<string>>();
    const deserializeMap = new Map<string, (...args: any[]) => any>();

    export function property() {
        return (target: any, property: string) => {
            saveKey(serializeKeyMap, target, property);
        };
    }

    export function deserializeSkip() {
        return (target: any, property: string) => {
            saveKey(deSkipKeyMap, target, property);
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

    export function deserialize(document: IDocument, data: Serialized) {
        data["document"] = document;
        let deserialized = {} as any;
        for (const key of Object.keys(data)) {
            if (data.deserializeSkips?.has(key)) continue;
            deserialized[key] = data[key].className ? deserialize(document, data[key]) : data[key];
        }
        let instance = deserializeMap.get(data.className)?.(deserialized);
        if (instance === undefined) throw new Error(`${data.className} cannot be deserialized`);
        return instance;
    }

    export function nodeDeserialize(document: IDocument, parent: INodeLinkedList, data: Serialized) {
        return nodeAndSiblingDescrialize(document, parent, data, false);
    }

    function nodeAndSiblingDescrialize(
        document: IDocument,
        parent: INodeLinkedList,
        data: Serialized,
        addSibling: boolean
    ) {
        if (data === undefined) return;
        let node = deserialize(document, data);
        parent.add(node);
        if (data["firstChild"]) nodeAndSiblingDescrialize(document, node, data["firstChild"], true);
        if (addSibling && data["nextSibling"])
            nodeAndSiblingDescrialize(document, parent, data["nextSibling"], true);
        return node;
    }

    export function serialize(target: ISerialize): Serialized {
        let data: Serialized = {
            className: target.constructor.name,
            deserializeSkips: getKeys(target, deSkipKeyMap),
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
