// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export type Serialized = {
    type: string;
    [property: string]: any;
};

export interface ISerialize {
    serialize(): Serialized;
}

export namespace Serialize {
    const keyMap = new Map<new (...args: any[]) => any, Set<string>>();
    const deserializeMap = new Map<string, (...args: any[]) => any>();

    export function property() {
        return (target: any, name: string) => {
            let keys = keyMap.get(target);
            if (keys === undefined) {
                keys = new Set();
                keyMap.set(target, keys);
            }
            keys.add(name);
        };
    }

    export function deserializer() {
        return (target: any, name: string) => {
            deserializeMap.set(target.name, target[name]);
        };
    }

    export function deserialize(data: Serialized) {
        return deserializeMap.get(data.type)?.(data);
    }

    export function serialize(target: ISerialize): Serialized {
        let keys = getKeys(target);
        let data: Serialized = {
            type: target.constructor.name,
        };
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

    function getKeys(target: ISerialize) {
        let keys: string[] = [];
        let prototype = Object.getPrototypeOf(target);
        while (prototype !== null) {
            let k = keyMap.get(prototype);
            if (k) keys.push(...k.values());
            prototype = Object.getPrototypeOf(prototype);
        }
        return new Set(keys);
    }
}
