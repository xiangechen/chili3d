// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

const classNameToClass = new Map<string, new (...args: any[]) => any>();
const classToClassName = new Map<new (...args: any[]) => any, string>();

export namespace ClassMap {
    export function save(className: string, ctor: new (...args: any) => any) {
        if (classNameToClass.has(className)) throw new Error(`Class ${className} already registered`);
        classNameToClass.set(className, ctor);
        classToClassName.set(ctor, className);
    }

    export function getClass(className: string): new (...args: any[]) => any {
        let cls = classNameToClass.get(className);
        if (cls) return cls;
        throw new Error(`Type ${className} is not find, please add the @Serializer.register decorator.`);
    }

    export function getKey(ctor: new (...args: any[]) => any): string {
        let key = classToClassName.get(ctor);
        if (key) return key;
        throw new Error(`${ctor.name} is not registered, please add the @Serializer.register decorator.`);
    }
}
