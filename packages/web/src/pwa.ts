// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Logger } from "@chili3d/core";
import { UpdatePrompt } from "./updatePrompt";

/** Mirrors the prefix built in public/sw.js: the registration scope is part of every cache name. */
const LEGACY_CACHE = /^chili3d-[0-9a-f]+$/;

function cachePrefix(scope: string): string {
    return `chili3d|${encodeURIComponent(new URL(scope).pathname)}|`;
}

function reloadAllTabsAfterActivation(): void {
    let hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) {
            hadController = true;
            return;
        }
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });
}

function showUpdatePrompt(registration: ServiceWorkerRegistration): void {
    if (document.getElementById("pwa-update")) return;
    document.body.appendChild(new UpdatePrompt(registration));
}

function watchWorker(registration: ServiceWorkerRegistration, worker: ServiceWorker): void {
    const notify = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdatePrompt(registration);
        }
    };
    notify();
    worker.addEventListener("statechange", notify);
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration);
    if (registration.installing) watchWorker(registration, registration.installing);
    registration.addEventListener("updatefound", () => {
        if (registration.installing) watchWorker(registration, registration.installing);
    });
}

async function clearDevelopmentCache(): Promise<void> {
    const scope = new URL("./", window.location.href).href;
    const prefix = cachePrefix(scope);
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((item) => item.scope === scope).map((item) => item.unregister()));
    if (!("caches" in globalThis)) return;
    const names = await caches.keys();
    await Promise.all(
        names
            .filter((name) => name.startsWith(prefix) || LEGACY_CACHE.test(name))
            .map((name) => caches.delete(name)),
    );
}

async function register(): Promise<void> {
    try {
        const registration = await navigator.serviceWorker.register("./sw.js");
        reloadAllTabsAfterActivation();
        watchForUpdates(registration);
    } catch (error) {
        Logger.warn("Service worker registration failed", error);
    }
}

export function registerServiceWorker(enabled: boolean): void {
    if (!("serviceWorker" in navigator)) return;
    if (!enabled) {
        clearDevelopmentCache().catch((error) => Logger.warn("Service worker cleanup failed", error));
        return;
    }
    window.addEventListener("load", () => void register(), { once: true });
}
