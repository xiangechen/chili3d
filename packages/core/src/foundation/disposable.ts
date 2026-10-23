// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface IDisposable {
    dispose(): void;
}

export function isDisposable(value: unknown): value is IDisposable {
    return (
        value != null &&
        typeof value === "object" &&
        "dispose" in value &&
        typeof (value as IDisposable).dispose === "function" &&
        (value as IDisposable).dispose.length === 0
    );
}

/**
 * The explicit contract behind "dispose me, but spare what one of these survivors still
 * holds" (implemented by model/UserData). Branded with a symbol so the history's structural
 * check cannot collide with an unrelated disposable that happens to grow a `disposeExcept`
 * method — and without importing the model layer into the foundation one.
 */
export const DisposeExceptKey: unique symbol = Symbol("chili3d.disposeExcept");

export interface IDisposeExcept extends IDisposable {
    [DisposeExceptKey](...survivors: unknown[]): void;
}

export function isDisposeExcept(value: unknown): value is IDisposeExcept {
    return (
        value != null &&
        typeof value === "object" &&
        typeof (value as IDisposeExcept)[DisposeExceptKey] === "function"
    );
}
