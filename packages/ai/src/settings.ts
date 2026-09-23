// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage } from "@chili3d/core";

/**
 * How deep the model may think before it answers. Unset sends nothing at all and leaves whatever
 * the endpoint does by itself — which is the right default on a relay that may reject a field it
 * does not know. Lowering it is the lever for a model that spends its whole output budget on
 * reasoning and never gets to the answer (see the truncation notice in agent.ts); `xhigh` and
 * `max` are for a problem that needs more of it than the default.
 */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface LLMConfig {
    provider: "anthropic" | "completions" | "responses";
    baseURL?: string;
    apiKey: string;
    model: string;
    /** Omitted is not "medium" — it is "whatever this endpoint does when nothing is asked". */
    reasoningEffort?: ReasoningEffort;
    /**
     * How many tokens the model can hold, used to turn a context reading into a fraction of what
     * is left. No provider reports it, so it is the user's to set — the meter says nothing without
     * a denominator, and guessing one per model would be wrong the moment someone points baseURL
     * at a different model. Optional because configs predating the meter have none; `loadConfig`
     * fills in the default.
     */
    contextWindow?: number;
}

export interface ProviderPreset {
    id: string;
    label: string;
    provider: LLMConfig["provider"];
    baseURL?: string;
    defaultModel: string;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

/** What the context meter divides by until the user says otherwise. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/**
 * The context-window sizes models actually ship at, smallest first. Every entry has real models
 * behind it — 200K is Claude's whole line plus o3, 256K is Mistral Large and Command A, 400K is
 * GPT-5.5, 512K is MiniMax-M3 and Mixtral v2, 1M is GPT-4.1 and Gemini 2.5 — rather than a neat
 * power-of-two ladder that no provider follows.
 */
export const CONTEXT_WINDOW_OPTIONS = [200_000, 256_000, 400_000, 512_000, 1_000_000];

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: "anthropic",
        label: "Anthropic API",
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        defaultModel: DEFAULT_ANTHROPIC_MODEL,
    },
    {
        id: "openai",
        label: "Completions API",
        provider: "completions",
        baseURL: "https://api.openai.com/v1",
        defaultModel: DEFAULT_OPENAI_MODEL,
    },
    {
        id: "responses",
        label: "Responses API",
        provider: "responses",
        baseURL: "https://api.openai.com/v1",
        defaultModel: DEFAULT_OPENAI_MODEL,
    },
];

const STORAGE_KEY = "ai.config";

/**
 * The API key never touches persistent storage: it lives in this module for the
 * current session, and long-term keeping is delegated to the browser's password
 * manager (the settings panel is a real login-style form).
 */
let sessionApiKey = "";

/** Older versions persisted the key in plain text; migrate it out on first read. */
type StoredConfig = Omit<LLMConfig, "apiKey"> & { apiKey?: string };

export function loadConfig(): LLMConfig | undefined {
    const saved = ObjectStorage.default.value<StoredConfig>(STORAGE_KEY);
    if (!saved) return undefined;
    if (saved.apiKey) {
        sessionApiKey = saved.apiKey;
        persist(saved);
    }
    return {
        provider: saved.provider,
        baseURL: saved.baseURL,
        model: saved.model,
        reasoningEffort: saved.reasoningEffort,
        // Configs saved before the meter existed have no window; they get the default.
        contextWindow: saved.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        apiKey: sessionApiKey,
    };
}

export function saveConfig(config: LLMConfig): void {
    sessionApiKey = config.apiKey;
    persist(config);
}

function persist(config: StoredConfig): void {
    const { apiKey: _apiKey, ...rest } = config;
    ObjectStorage.default.setValue(STORAGE_KEY, rest);
}

/** The config to run with: what is saved, or the defaults a first run has nothing to save yet. */
export function currentConfig(): LLMConfig {
    return (
        loadConfig() ?? {
            provider: "anthropic",
            baseURL: undefined,
            apiKey: "",
            model: DEFAULT_ANTHROPIC_MODEL,
            contextWindow: DEFAULT_CONTEXT_WINDOW,
        }
    );
}

/**
 * Hand the key to the browser's password manager (Chrome/Edge support the Credential Management
 * API) — the other half of keeping it, next to the session copy above. Unsupported browsers or a
 * declined prompt leave the key session-only, and the user re-enters it next time.
 */
export async function offerKeyToPasswordManager(id: string, password: string): Promise<void> {
    if (!password) return;
    try {
        const ctor = (
            globalThis as {
                PasswordCredential?: new (data: { id: string; password: string }) => Credential;
            }
        ).PasswordCredential;
        if (ctor && navigator.credentials?.store) {
            await navigator.credentials.store(new ctor({ id, password }));
        }
    } catch {
        // Declined or blocked — session-only it is.
    }
}
