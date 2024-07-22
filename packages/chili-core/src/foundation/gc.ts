// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable } from "./disposable";

export interface Deletable {
    delete(): void;
}

export namespace Deletable {
    export function isDeletable(v: any): v is Deletable {
        if (typeof v.delete !== "function") return false;
        return v.delete.length === 0;
    }
}

export const gc = <R>(action: (collect: <T extends Deletable | IDisposable>(v: T) => T) => R): R => {
    const deletables = new Set<Deletable | IDisposable>();

    const collector = <T extends Deletable | IDisposable>(v: T) => {
        deletables.add(v);
        return v;
    };

    try {
        return action(collector);
    } finally {
        deletables.forEach((item) => {
            if (Deletable.isDeletable(item)) {
                item.delete();
            } else if (IDisposable.isDisposable(item)) {
                item.dispose();
            }
        });
        deletables.clear();
    }
};
