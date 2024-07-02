// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

const classNameToClass = new Map<string, new (...args: any[]) => any>();

export namespace ClassMap {
    export function save(className: string, ctor: new (...args: any) => any) {
        if (classNameToClass.has(className)) throw new Error(`Class ${className} already registered`);
        classNameToClass.set(className, ctor);
    }

    export function getClass(className: string): new (...args: any[]) => any {
        let cls = classNameToClass.get(className);
        if (cls) return cls;
        throw new Error(`Type ${className} is not find, please add the @Serializer.register decorator.`);
    }
}
