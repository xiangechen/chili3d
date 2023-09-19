// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

const keyToClass = new Map<string, new (...args: any[]) => any>();
const classToKey = new Map<new (...args: any[]) => any, string>();

export namespace ClassMap {
    export function save(className: string, ctor: new (...args: any) => any) {
        if (keyToClass.has(className)) throw new Error(`Class ${className} already registered`);
        keyToClass.set(className, ctor);
        classToKey.set(ctor, className);
    }

    export function getClass(key: string): new (...args: any[]) => any {
        let cls = keyToClass.get(key);
        if (cls) return cls;
        throw new Error(`Type ${key} is not find, please add the @Serializer.register decorator.`);
    }

    export function getKey(ctor: new (...args: any[]) => any): string {
        let key = classToKey.get(ctor);
        if (key) return key;
        throw new Error(`${ctor.name} is not registered, please add the @Serializer.register decorator.`);
    }
}
