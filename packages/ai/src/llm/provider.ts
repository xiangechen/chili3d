// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { LLMConfig } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { CompletionsProvider } from "./completions";
import { ResponsesProvider } from "./responses";
import type { LLMProvider } from "./types";

/** The provider the configured surface names, with the default surface as the fallback. */
export function createProvider(config: LLMConfig): LLMProvider {
    if (config.provider === "anthropic") return new AnthropicProvider(config);
    if (config.provider === "responses") return new ResponsesProvider(config);
    return new CompletionsProvider(config);
}
