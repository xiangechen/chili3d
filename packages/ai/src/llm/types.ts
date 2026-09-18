// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type JsonSchema = Record<string, unknown>;

/** A tool the AI can call. Providers read name/description/parameters; the agent reads handler. */
export interface Tool {
    name: string;
    description: string;
    parameters: JsonSchema;
    /** `signal` aborts when the user cancels the chat; long-running handlers should respect it. */
    handler: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string | ToolResult>;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: string; // JSON string
}

export interface ImagePart {
    mediaType: string; // e.g. "image/png", "image/jpeg"
    data: string; // base64, without the data URL prefix
}

/**
 * An extended-thinking block, captured verbatim (signature included) so it can be replayed
 * to the API. Anthropic requires thinking blocks to be passed back unmodified during tool use.
 */
export type ThinkingBlock =
    | { type: "thinking"; thinking: string; signature: string }
    | { type: "redacted_thinking"; data: string };

/** A tool result that can carry images (e.g. a viewport screenshot) back to the model. */
export interface ToolResult {
    content: string;
    images?: ImagePart[];
}

export type ChatMessage =
    | { role: "user"; content: string; images?: ImagePart[] }
    | { role: "assistant"; content: string; toolCalls?: ToolCall[]; thinking?: ThinkingBlock[] }
    | { role: "tool"; toolCallId: string; name: string; content: string; images?: ImagePart[] };

export type StreamEvent =
    | { type: "text"; text: string }
    | { type: "thinking"; block: ThinkingBlock }
    | { type: "tool_call"; id: string; name: string; arguments: string }
    | { type: "usage"; usage: TokenUsage }
    | { type: "done"; stopReason: string };

/** What one model turn cost. `cacheRead` > 0 is the proof that prompt caching is working. */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
}

export type ToolCallBuffer = Map<number, { id: string; name: string; args: string }>;

/**
 * The system prompt split at its stability boundary: `stable` is byte-identical for every request
 * in a run, `volatile` is the per-run context (the document snapshot) appended after it.
 *
 * The split exists for prompt caching. The API matches a prefix in the order
 * `tools` -> `system` -> `messages`, so a per-run section placed *inside* the system prompt makes
 * everything after it uncacheable — breakpoints and all. Providers that support explicit
 * breakpoints mark `stable`; the others concatenate the two halves back into one string.
 */
export interface SystemPrompt {
    stable: string;
    volatile: string;
}

/** The two halves as the single string the providers without explicit caching send. */
export function flattenSystem(system: SystemPrompt): string {
    return system.volatile ? `${system.stable}\n\n${system.volatile}` : system.stable;
}

export interface StreamChatOptions {
    model: string;
    system: SystemPrompt;
    messages: ChatMessage[];
    tools: Tool[];
    signal?: AbortSignal;
}

export interface LLMProvider {
    readonly id: string;
    streamChat(opts: StreamChatOptions): AsyncIterable<StreamEvent>;
}
