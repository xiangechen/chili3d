// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger } from "@chili3d/core";
import { registerServiceWorker } from "../src/pwa";

describe("registerServiceWorker", () => {
    const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");

    afterEach(() => {
        rs.restoreAllMocks();
        document.getElementById("pwa-update")?.remove();
        restoreProperty(navigator, "serviceWorker", originalServiceWorker);
        restoreProperty(globalThis, "caches", originalCaches);
    });

    function restoreProperty(target: object, key: string, descriptor?: PropertyDescriptor) {
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
    }

    function mockServiceWorker() {
        const registration = {
            addEventListener: rs.fn(
                (
                    _type: string,
                    _listener: EventListenerOrEventListenerObject,
                    _options?: boolean | AddEventListenerOptions,
                ) => {},
            ),
            installing: null,
            waiting: null,
        } as unknown as ServiceWorkerRegistration;
        const register = rs.fn((_scriptURL: string | URL, _options?: RegistrationOptions) =>
            Promise.resolve(registration),
        );
        const getRegistrations = rs.fn((): Promise<ServiceWorkerRegistration[]> => Promise.resolve([]));
        const container = {
            addEventListener: () => {},
            controller: null,
            getRegistrations,
            register,
        };
        const cache = {
            delete: rs.fn((_name: string) => Promise.resolve(true)),
            keys: rs.fn((): Promise<string[]> => Promise.resolve([])),
        };
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
        Object.defineProperty(globalThis, "caches", { configurable: true, value: cache });
        return { cache, container, getRegistrations, register, registration };
    }

    function flushPromises() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    test("should unregister and clear application caches when disabled", async () => {
        const { cache, getRegistrations, register } = mockServiceWorker();
        const unregister = rs.fn(() => Promise.resolve(true));
        const scope = new URL("./", window.location.href);
        getRegistrations.mockResolvedValue([
            {
                scope: scope.href,
                unregister,
            } as unknown as ServiceWorkerRegistration,
        ]);
        const ownCache = `chili3d|${encodeURIComponent(scope.pathname)}|old`;
        const siblingCache = `chili3d|${encodeURIComponent("/pro/")}|old`;
        cache.keys.mockResolvedValue([ownCache, siblingCache, "chili3d-0123456789abcdef", "another-cache"]);

        registerServiceWorker(false);
        window.dispatchEvent(new Event("load"));
        await flushPromises();

        expect(register).not.toHaveBeenCalled();
        expect(unregister).toHaveBeenCalledTimes(1);
        expect(cache.delete).toHaveBeenCalledWith(ownCache);
        expect(cache.delete).toHaveBeenCalledWith("chili3d-0123456789abcdef");
        // Another Chili3D app on the same origin owns its own scope's caches.
        expect(cache.delete).not.toHaveBeenCalledWith(siblingCache);
        expect(cache.delete).not.toHaveBeenCalledWith("another-cache");
    });

    test("should not add a load listener when service workers are unsupported", () => {
        mockServiceWorker();
        Reflect.deleteProperty(navigator, "serviceWorker");
        const addEventListener = rs.spyOn(window, "addEventListener");

        registerServiceWorker(true);

        expect(addEventListener).not.toHaveBeenCalled();
    });

    test("should register once after the window loads", () => {
        const { register } = mockServiceWorker();

        registerServiceWorker(true);
        expect(register).not.toHaveBeenCalled();
        window.dispatchEvent(new Event("load"));
        window.dispatchEvent(new Event("load"));

        expect(register).toHaveBeenCalledTimes(1);
        expect(register).toHaveBeenCalledWith("./sw.js");
    });

    test("should log registration failures", async () => {
        const { register } = mockServiceWorker();
        const error = new Error("Registration denied");
        register.mockRejectedValue(error);
        const warn = rs.spyOn(Logger, "warn").mockImplementation(() => {});

        registerServiceWorker(true);
        window.dispatchEvent(new Event("load"));
        await flushPromises();

        expect(warn).toHaveBeenCalledWith("Service worker registration failed", error);
    });

    test("should offer a user-initiated reload when an update is waiting", async () => {
        const { container, registration } = mockServiceWorker();
        const postMessage = rs.fn((_message: unknown) => {});
        Object.defineProperty(registration, "waiting", { value: { postMessage } });
        Object.defineProperty(container, "controller", { value: {} });

        registerServiceWorker(true);
        window.dispatchEvent(new Event("load"));
        await flushPromises();
        const reload = document.getElementById("pwa-update-reload");
        expect(reload).not.toBeNull();
        (reload as HTMLButtonElement).click();

        expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });

    test("should watch an update that is already installing", async () => {
        const { container, registration } = mockServiceWorker();
        let stateListener: (() => void) | undefined;
        const worker = {
            addEventListener: rs.fn((_type: string, listener: () => void) => {
                stateListener = listener;
            }),
            state: "installing",
        };
        Object.defineProperty(registration, "installing", { value: worker });
        Object.defineProperty(container, "controller", { value: {} });

        registerServiceWorker(true);
        window.dispatchEvent(new Event("load"));
        await flushPromises();
        expect(document.getElementById("pwa-update")).toBeNull();
        expect(stateListener).toBeDefined();

        Object.defineProperty(worker, "state", { value: "installed" });
        stateListener?.();

        expect(document.getElementById("pwa-update")).not.toBeNull();
    });
});
