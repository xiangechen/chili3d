// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class ObjectStorage {
    static readonly default = new ObjectStorage("chili3d", "app");

    private readonly prefix: string;

    constructor(organization: string, application: string) {
        this.prefix = `${organization}.${application}.`;
    }

    setValue(key: string, value: object): void {
        const storageKey = this.prefix + key;
        try {
            const stringValue = JSON.stringify(value);
            localStorage.setItem(storageKey, stringValue);
        } catch (error) {
            console.error(`Failed to set setting ${key}:`, error);
        }
    }

    value<T>(key: string, defaultValue?: T): T | undefined {
        const storageKey = this.prefix + key;
        const item = localStorage.getItem(storageKey);
        if (!item) {
            return defaultValue;
        }

        try {
            return JSON.parse(item) as T;
        } catch (error) {
            console.error(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    }

    remove(key: string): void {
        const storageKey = this.prefix + key;
        localStorage.removeItem(storageKey);
    }

    clear(): void {
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith(this.prefix)) {
                localStorage.removeItem(key);
            }
        });
    }
}
