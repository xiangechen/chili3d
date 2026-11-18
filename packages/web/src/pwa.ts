// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, Logger } from "@chili3d/core";

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

    const prompt = document.createElement("div");
    prompt.id = "pwa-update";
    prompt.setAttribute("role", "status");
    prompt.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;align-items:center;gap:12px;" +
        "padding:12px 16px;border-radius:6px;background:#181818;color:#eee;box-shadow:0 2px 12px #0008;";

    const message = document.createElement("span");
    message.textContent = I18n.translate("pwa.updateAvailable");
    const reload = document.createElement("button");
    reload.id = "pwa-update-reload";
    reload.textContent = I18n.translate("pwa.reload");
    const dismiss = document.createElement("button");
    dismiss.textContent = I18n.translate("pwa.later");
    dismiss.addEventListener("click", () => prompt.remove());
    reload.addEventListener("click", () => {
        if (!registration.waiting) {
            prompt.remove();
            window.location.reload();
            return;
        }
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
    });
    prompt.append(message, reload, dismiss);
    document.body.appendChild(prompt);
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
