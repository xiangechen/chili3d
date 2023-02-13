// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEditor } from "../editor";
import { Entity } from "../model";

const EditorKey = Symbol("EditorKey");

export function editor<T extends Entity>(E: new (entity: T) => IEditor) {
    return (ctor: new (...args: any[]) => T) => {
        if (!Reflect.hasMetadata(EditorKey, ctor)) {
            Reflect.defineMetadata(EditorKey, E, ctor);
        }
    };
}

export namespace Editor {
    export function get<T extends Entity>(entity: T): IEditor | undefined {
        let E = Reflect.getMetadata(EditorKey, Object.getPrototypeOf(entity));
        return E === undefined ? undefined : new E(entity);
    }
}
