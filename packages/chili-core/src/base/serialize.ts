// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface ISerialize {
    serialize(): Record<string, any>;
}

export namespace Serialize {
    const map = new Map<new (...args: any[]) => any, Set<string>>();

    export function enable() {
        return (target: any, name: string) => {
            let keys = map.get(target);
            if (keys === undefined) {
                keys = new Set();
                map.set(target, keys);
            }
            keys.add(name);
        };
    }

    export function serialize(target: ISerialize): Record<string, any> {
        let keys = getKeys(target);
        let data: Record<string, any> = {};
        data["type"] = target.constructor.name;
        for (const key of keys) {
            let value = (target as any)[key];
            let type = typeof value;
            if (type === "object" && (value as ISerialize).serialize) {
                data[key] = value.serialize();
            } else if (type !== "function" && type !== "symbol") {
                data[key] = value;
            }
        }
        return data;
    }

    function getKeys(target: ISerialize) {
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
