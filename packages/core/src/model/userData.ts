// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DisposeExceptKey, type IDisposeExcept, isDisposable } from "../foundation";
import {
    InternalClassName,
    type Serialized,
    type SerializedData,
    Serializer,
    serializable,
} from "../serialize";

/**
 * Mirrors `Serializer.serializePropertyValue` (which stays private): primitives pass through,
 * registered classes serialize to `{ __cla$$__: ... }` objects. A plain object would throw in
 * `serializeObject` — values must be primitives, arrays of them, or `@serializable` instances
 * (an `IShape` works: the OccShape family registers BREP hooks). `undefined` entries are
 * dropped, matching what JSON would do with them anyway.
 */
function serializeEntry(value: unknown): unknown {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return value.map(serializeEntry);
    if (typeof value === "object") return Serializer.serializeObject(value);
    if (typeof value === "function" || typeof value === "symbol") {
        throw new Error(`Unsupported userData value: ${String(value)}`);
    }
    return value;
}

/**
 * The serializer hands its `document` argument to every props object it builds
 * (`Serializer.deserializeObject`), so the hook must not adopt it as an entry. A user's own
 * entry named "document" overwrites that injection, though — skip only what actually is a
 * document, never the bare name.
 */
function isInjectedDocument(value: unknown): boolean {
    return typeof value === "object" && value !== null && "modelManager" in value && "selection" in value;
}

/**
 * The generic per-node data bag behind `Node.userData`. Serialized with the node, so it
 * survives save/load; replacement is immutable (`with`/`without` return a new bag) because the
 * undo history restores a property by identity — mutating in place would rewrite the old
 * state a `PropertyHistoryRecord` still points at.
 *
 * Ownership: a disposable value (e.g. an `IShape`, whose WASM handles the GC cannot see)
 * belongs to exactly one bag at a time, and the bag disposes such values when it is itself
 * disposed (node gone, history record dropped). A `with`/`without` copy does share value
 * references with its origin, so freeing the dropped side of a property change must go
 * through `disposeExcept`, which spares whatever a surviving bag still holds.
 */
@serializable({
    serialize: (target: UserData) => {
        const data: SerializedData = {};
        for (const key of Object.keys(target.entries)) {
            const value = serializeEntry(target.entries[key]);
            if (value !== undefined) data[key] = value;
        }
        return data;
    },
    // The entries arrive already deserialized (`Serializer.deserialValue` recursed first).
    deserialize: (props: Serialized) => {
        const entries: Record<string, unknown> = {};
        for (const key of Object.keys(props)) {
            if (key === InternalClassName) continue;
            if (key === "document" && isInjectedDocument(props[key])) continue;
            entries[key] = props[key];
        }
        return new UserData(entries);
    },
})
export class UserData implements IDisposeExcept {
    constructor(readonly entries: Record<string, unknown> = {}) {}

    get<T>(key: string): T | undefined {
        return this.entries[key] as T | undefined;
    }

    with(key: string, value: unknown): UserData {
        return new UserData({ ...this.entries, [key]: value });
    }

    without(key: string): UserData {
        if (!(key in this.entries)) return this;
        const entries = { ...this.entries };
        delete entries[key];
        return new UserData(entries);
    }

    get size(): number {
        return Object.keys(this.entries).length;
    }

    #isDisposed = false;
    dispose(): void {
        this.disposeExcept();
    }

    /** The branded entry the undo history calls — see `DisposeExceptKey`. */
    [DisposeExceptKey](...survivors: unknown[]): void {
        this.disposeExcept(...survivors);
    }

    /**
     * Dispose this bag except the values one of `survivors` still holds. `with`/`without`
     * copies share value references with their origin, so when a history record drops this
     * bag while another bag lives on, the shared values must survive. The bag itself is
     * spent either way — a later plain `dispose()` is a no-op.
     */
    disposeExcept(...survivors: unknown[]): void {
        if (this.#isDisposed) return;
        this.#isDisposed = true;
        const kept = new Set<unknown>();
        for (const survivor of survivors) {
            if (survivor instanceof UserData) {
                for (const value of Object.values(survivor.entries)) kept.add(value);
            }
        }
        for (const value of Object.values(this.entries)) {
            if (!kept.has(value) && isDisposable(value)) value.dispose();
        }
    }
}
