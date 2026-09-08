// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage } from "@chili3d/core";

export interface LLMConfig {
    provider: "anthropic" | "openai-compatible" | "responses";
    baseURL?: string;
    apiKey: string;
    model: string;
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

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: "anthropic",
        label: "Anthropic API",
        provider: "anthropic",
        defaultModel: DEFAULT_ANTHROPIC_MODEL,
    },
    {
        id: "openai",
        label: "OpenAI API",
        provider: "openai-compatible",
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
