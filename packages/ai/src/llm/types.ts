// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export type JsonSchema = Record<string, unknown>;

/** A tool the AI can call. Providers read name/description/parameters; the agent reads handler. */
export interface Tool {
    name: string;
    description: string;
    parameters: JsonSchema;
    handler: (args: Record<string, unknown>) => Promise<string | ToolResult>;
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
    | { type: "done"; stopReason: string };

export type ToolCallBuffer = Map<number, { id: string; name: string; args: string }>;

export interface StreamChatOptions {
    model: string;
    system: string;
    messages: ChatMessage[];
    tools: Tool[];
    signal?: AbortSignal;
}

export interface LLMProvider {
    readonly id: string;
    streamChat(opts: StreamChatOptions): AsyncIterable<StreamEvent>;
}
