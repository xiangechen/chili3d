// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class Signal<T extends (...args: any[]) => void> {
    private _listeners = new Set<T>();

    sub(listener: T): void {
        this._listeners.add(listener);
    }

    remove(listener: T): void {
        this._listeners.delete(listener);
    }

    emit(...args: Parameters<T>): void {
        for (const listener of this._listeners) {
            listener(...args);
        }
    }

    dispose(): void {
        this._listeners.clear();
    }
}
