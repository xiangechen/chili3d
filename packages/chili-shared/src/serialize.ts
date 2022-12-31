// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

export const SerializeMetaKey = "Serialize";

export function Serialize(name?: string) {
    return (target: Object, property: string): void => {
        Reflect.defineMetadata(SerializeMetaKey, name || property, target, property);
    };
}

export interface ISerialize {
    serialize(): Object;
}
