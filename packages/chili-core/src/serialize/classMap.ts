// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ClassKey } from "./classKey";

const keyToClass = new Map<ClassKey, new (...args: any[]) => any>();
const classToKey = new Map<new (...args: any[]) => any, ClassKey>();

export namespace ClassMap {
    export function key(classKey: ClassKey) {
        return (ctor: new (...args: any) => any) => {
            if (keyToClass.has(classKey)) throw new Error(`Class ${classKey} already registered`);
            keyToClass.set(classKey, ctor);
            classToKey.set(ctor, classKey);
        };
    }

    export function getClass(key: ClassKey): new (...args: any[]) => any {
        let cls = keyToClass.get(key);
        if (cls) return cls;
        throw new Error(`Type ${key} is not find, please add the @ClassMap.key("**") decorator.`);
    }

    export function getKey(ctor: new (...args: any[]) => any): ClassKey {
        let key = classToKey.get(ctor);
        if (key) return key;
        throw new Error(
            `Type ${ctor.name} is not registered, please add the @ClassMap.key("**") decorator.`,
        );
    }
}
