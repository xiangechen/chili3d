// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable } from "./disposable";

export interface Deletable {
    delete(): void;
}

export namespace Deletable {
    export function isDeletable(value: unknown): value is Deletable {
        return typeof (value as any)?.delete === "function" && (value as any).delete.length === 0;
    }
}

export const gc = <R>(action: (collect: <T extends Deletable | IDisposable>(resource: T) => T) => R): R => {
    const resources = new Set<Deletable | IDisposable>();

    const collectResource = <T extends Deletable | IDisposable>(resource: T) => {
        resources.add(resource);
        return resource;
    };

    try {
        return action(collectResource);
    } finally {
        for (const resource of resources) {
            if (Deletable.isDeletable(resource)) {
                resource.delete();
            } else if (IDisposable.isDisposable(resource)) {
                resource.dispose();
            }
        }
        resources.clear();
    }
};
