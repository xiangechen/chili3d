// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const mockLocalStorage = () => {
    const localStorageData: Record<string, string> = {};
    const localStorage = new Proxy(
        {
            getItem: (key: string) => localStorageData[key] ?? null,
            setItem: (key: string, value: string) => {
                localStorageData[key] = value;
            },
            removeItem: (key: string) => delete localStorageData[key],
            clear: () => {
                Object.keys(localStorageData).forEach((k) => delete localStorageData[k]);
            },
            get length() {
                return Object.keys(localStorageData).length;
            },
            key: (index: number) => Object.keys(localStorageData)[index] ?? null,
        },
        {
            get: (target, prop) => {
                if (prop === "getItem") return target.getItem;
                if (prop === "setItem") return target.setItem;
                if (prop === "removeItem") return target.removeItem;
                if (prop === "clear") return target.clear;
                if (prop === "length") return target.length;
                if (prop === "key") return target.key;
                return target.getItem(prop as string);
            },
            set: (target, prop, value) => {
                target.setItem(prop as string, value);
                return true;
            },
            ownKeys: () => Object.keys(localStorageData),
            getOwnPropertyDescriptor: (_target, prop) => {
                if (typeof prop === "string" && prop in localStorageData) {
                    return {
                        value: localStorageData[prop],
                        enumerable: true,
                        configurable: true,
                        writable: true,
                    };
                }
                return undefined;
            },
        },
    );

    Object.defineProperty(global, "localStorage", {
        value: localStorage,
        writable: true,
    });

    return localStorage;
};
