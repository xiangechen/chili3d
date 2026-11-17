const CACHE_PREFIX = "chili3d-";
const CACHE_NAME = `${CACHE_PREFIX}${"__BUILD_HASH__"}`;
const PRECACHE_URLS = "__PRECACHE_MANIFEST__";
const STATIC_DESTINATIONS = new Set(["font", "image", "manifest", "script", "style", "worker"]);
const OPTIONAL_URLS = new Set(["images/wechat.jpg", "videos.json"]);
const CONTENT_HASH = /(?:^|\/|\.)[0-9a-f]{8,}\./;
let development = false;

function assetUrl(path) {
    return new URL(path, self.registration.scope).href;
}

function isOptional(path) {
    return OPTIONAL_URLS.has(path) || path.startsWith("plugins/");
}

function assetRequest(path) {
    const cache = CONTENT_HASH.test(path) ? "default" : "reload";
    return new Request(assetUrl(path), { cache });
}

async function reuseHashedAssets(cache, urls) {
    const names = (await caches.keys()).filter(
        (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
    );
    const oldCaches = await Promise.all(names.map((name) => caches.open(name)));
    const remaining = new Set(urls);
    for (const url of urls.filter((path) => CONTENT_HASH.test(path))) {
        for (const oldCache of oldCaches) {
            const response = await oldCache.match(assetUrl(url));
            if (response) {
                await cache.put(assetUrl(url), response);
                remaining.delete(url);
                break;
            }
        }
    }
    return [...remaining];
}

async function cacheOptional(cache, path) {
    try {
        const response = await fetch(assetRequest(path));
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        await cache.put(assetUrl(path), response);
    } catch (error) {
        console.warn(`Optional precache failed: ${path}`, error);
    }
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const urls = [...new Set(["index.html", "manifest.webmanifest", ...PRECACHE_URLS])];
            const remaining = await reuseHashedAssets(cache, urls);
            const coreUrls = remaining.filter((path) => !isOptional(path));
            await cache.addAll(coreUrls.map(assetRequest));
            await Promise.all(remaining.filter(isOptional).map((path) => cacheOptional(cache, path)));
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                    .map((name) => caches.delete(name)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

async function clearDevelopmentCache() {
    const names = await caches.keys();
    await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
    );
    await self.registration.unregister();
}

async function handleNavigation(request) {
    try {
        const response = await fetch(request);
        if (response.headers.get("X-Chili3D-Development") === "true") {
            development = true;
            await clearDevelopmentCache();
        }
        return response;
    } catch {
        const cached = await caches.match(assetUrl("index.html"));
        return cached || Response.error();
    }
}

async function resolveAsset(request, cacheResponse) {
    if (development) return { response: await fetch(request) };
    const cached = await caches.match(request);
    if (cached) return { response: cached };

    const response = await fetch(request);
    const cacheCopy = cacheResponse && response.status === 200 ? response.clone() : undefined;
    return { response, cacheCopy };
}

async function cacheRuntimeResponse(request, resultPromise) {
    try {
        const { cacheCopy } = await resultPromise;
        if (!cacheCopy) return;
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, cacheCopy);
    } catch (error) {
        console.warn("Runtime cache write failed", error);
    }
}

function shouldCache(request, url) {
    if (STATIC_DESTINATIONS.has(request.destination) || url.pathname.endsWith(".wasm")) return true;
    const scopePath = new URL(self.registration.scope).pathname;
    const path = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : "";
    return path === "videos.json" || path.startsWith("plugins/");
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
    } else if (!url.pathname.endsWith("/sw.js")) {
        const result = resolveAsset(request, shouldCache(request, url));
        event.respondWith(result.then(({ response }) => response));
        event.waitUntil(cacheRuntimeResponse(request, result));
    }
});
