// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage } from "@chili3d/core";
import { mockLocalStorage } from "@chili3d/core/test-utils";
import { loadConfig, saveConfig } from "../src/settings";

describe("ai settings", () => {
    beforeEach(() => {
        mockLocalStorage();
    });

    test("keeps the api key in session memory and out of persistent storage", () => {
        saveConfig({ provider: "anthropic", apiKey: "sk-secret", model: "m" });

        const raw = localStorage.getItem("chili3d.app.ai.config");
        expect(raw).not.toBeNull();
        expect(raw).not.toContain("sk-secret");
        expect(JSON.parse(raw as string).apiKey).toBeUndefined();

        const loaded = loadConfig();
        expect(loaded?.apiKey).toBe("sk-secret");
        expect(loaded?.provider).toBe("anthropic");
        expect(loaded?.model).toBe("m");
    });

    test("migrates a plaintext key persisted by older versions into session memory", () => {
        ObjectStorage.default.setValue("ai.config", {
            provider: "openai-compatible",
            baseURL: "https://example.com/v1",
            apiKey: "old-key",
            model: "gpt",
        });

        const loaded = loadConfig();
        expect(loaded?.apiKey).toBe("old-key");
        expect(loaded?.baseURL).toBe("https://example.com/v1");

        const raw = localStorage.getItem("chili3d.app.ai.config");
        expect(raw).not.toBeNull();
        expect(raw).not.toContain("old-key");
    });

    test("returns undefined when nothing is stored", () => {
        expect(loadConfig()).toBeUndefined();
    });
});
