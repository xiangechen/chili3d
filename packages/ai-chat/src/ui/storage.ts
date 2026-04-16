export type Provider = "anthropic" | "openai";

// Bumped from the single-blob format to a per-provider map so switching
// providers in the settings dialog recalls that provider's own saved
// key/model instead of reusing whatever was last active.
const KEY = "chili3d-ai-chat.apiKey.v2";
const LEGACY_KEY = "chili3d-ai-chat.apiKey";

export interface ApiKey {
    provider: Provider;
    key: string;
    model?: string;
}

export interface ProviderEntry {
    key: string;
    model?: string;
}

export type ProviderMap = { [P in Provider]?: ProviderEntry };

interface Stored {
    active: Provider;
    providers: ProviderMap;
}

export const defaultModel: Record<Provider, string> = {
    anthropic: "claude-sonnet-4-5",
    openai: "gpt-4o-mini",
};

function readStored(): Stored | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Stored;
            if (parsed?.providers) return parsed;
        }
        // One-time migration from the old single-blob format.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            const old = JSON.parse(legacy) as ApiKey;
            if (old?.provider && old?.key) {
                const migrated: Stored = {
                    active: old.provider,
                    providers: { [old.provider]: { key: old.key, model: old.model } },
                };
                localStorage.setItem(KEY, JSON.stringify(migrated));
                localStorage.removeItem(LEGACY_KEY);
                return migrated;
            }
        }
    } catch {
        // fall through
    }
    return null;
}

function writeStored(s: Stored) {
    localStorage.setItem(KEY, JSON.stringify(s));
}

/** Returns the currently active provider's key, or null if none set. */
export function loadApiKey(): ApiKey | null {
    const s = readStored();
    if (!s) return null;
    const entry = s.providers[s.active];
    if (!entry?.key) return null;
    return { provider: s.active, key: entry.key, model: entry.model };
}

/** Read the stored key/model for a specific provider without changing the active one. */
export function loadProviderEntry(provider: Provider): ProviderEntry | null {
    const s = readStored();
    return s?.providers[provider] ?? null;
}

/** Save a provider's key + model, and mark that provider as active. */
export function saveApiKey(v: ApiKey) {
    const s = readStored() ?? { active: v.provider, providers: {} };
    s.active = v.provider;
    s.providers[v.provider] = { key: v.key, model: v.model };
    writeStored(s);
}

/** Remove the active provider's entry. If another provider still has a key,
 *  switch active to it; otherwise drop storage entirely. */
export function clearApiKey() {
    const s = readStored();
    if (!s) {
        localStorage.removeItem(KEY);
        return;
    }
    delete s.providers[s.active];
    const remaining = (Object.keys(s.providers) as Provider[]).filter((p) => s.providers[p]?.key);
    if (remaining.length === 0) {
        localStorage.removeItem(KEY);
        return;
    }
    s.active = remaining[0];
    writeStored(s);
}
