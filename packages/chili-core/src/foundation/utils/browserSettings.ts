// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

class BrowserSettings {
    private readonly organization: string;
    private readonly application: string;
    private readonly prefix: string;

    constructor(organization: string, application: string) {
        this.organization = organization;
        this.application = application;
        this.prefix = `${organization}.${application}.`;
    }

    setValue(key: string, value: any): void {
        const storageKey = this.prefix + key;
        try {
            const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
            localStorage.setItem(storageKey, stringValue);
        } catch (error) {
            console.error(`Failed to set setting ${key}:`, error);
        }
    }

    value<T>(key: string, defaultValue: T): T {
        const storageKey = this.prefix + key;
        const item = localStorage.getItem(storageKey);
        if (item === null) {
            return defaultValue;
        }

        try {
            return JSON.parse(item) as T;
        } catch (error) {
            return item as unknown as T;
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

function initializeSettings(organization: string, application: string): BrowserSettings {
    return new BrowserSettings(organization, application);
}

const appSettings = (() => {
    const organization = "Chili3d";
    const application = "DefaultApp";
    let instance: BrowserSettings | null = null;

    return () => {
        if (!instance) {
            instance = initializeSettings(organization, application);
        }
        return instance;
    };
})();

export { appSettings };
