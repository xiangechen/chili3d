// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import Anthropic from "@anthropic-ai/sdk";
import type { LLMConfig } from "../settings";
import type {
    ChatMessage,
    ImagePart,
    LLMProvider,
    StreamChatOptions,
    StreamEvent,
    SystemPrompt,
    TokenUsage,
    Tool,
    ToolCallBuffer,
} from "./types";

type RawUsage = {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
};

type RawStreamEvent = {
    type: string;
    index?: number;
    content_block?: any;
    delta?: any;
    message?: { usage?: RawUsage };
    usage?: RawUsage;
};

export interface StreamState {
    toolBuf: ToolCallBuffer;
    thinkingBuf: Map<number, { thinking: string; signature: string }>;
    stopReason?: string;
    /** Filled from message_start, completed from message_delta, reported as one usage event. */
    usage?: TokenUsage;
}

export class AnthropicProvider implements LLMProvider {
    readonly id = "anthropic";
    private readonly client: Anthropic;

    constructor(config: LLMConfig) {
        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: (config.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, ""),
            dangerouslyAllowBrowser: true,
        });
    }

    async *streamChat(opts: StreamChatOptions): AsyncIterable<StreamEvent> {
        const messages = toMessages(opts.messages);
        markConversationTail(messages);
        const stream = this.client.messages.stream(
            {
                model: opts.model,
                max_tokens: 64000,
                thinking: { type: "adaptive" },
                system: systemBlocks(opts.system),
                messages: messages as any,
                tools: opts.tools.map(toTool) as any,
                disable_parallel_tool_use: true,
            },
            { signal: opts.signal },
        );

        const state: StreamState = { toolBuf: new Map(), thinkingBuf: new Map() };
        for await (const raw of stream) {
            yield* convertEvent(raw as RawStreamEvent, state);
        }
    }
}

/**
 * The stable half carries the first of the two cache breakpoints (the other is the conversation
 * tail — see `markConversationTail`). Rendered order is `tools` -> `system` -> `messages` and
 * caching is a prefix match, so this one marker covers the tool schemas and the stable prompt
 * together; the per-run snapshot that follows stays outside the cached prefix, where it can only
 * invalidate itself.
 */
export function systemBlocks(system: SystemPrompt): Anthropic.TextBlockParam[] {
    const blocks: Anthropic.TextBlockParam[] = [
        {
            type: "text",
            text: system.stable,
            // An hour, because the gaps that matter here are human: inside a run the agent's turns
            // are seconds apart and the default five minutes would do, but a user who answers
            // twenty minutes later would otherwise re-pay for the whole prefix. Writes cost 2x
            // instead of 1.25x, and any read refreshes the timer for free. An entry with a longer
            // TTL must precede the shorter-lived ones, so this one stays ahead of the tail marker.
            cache_control: { type: "ephemeral", ttl: "1h" },
        },
    ];
    // The API rejects an empty text block.
    if (system.volatile) blocks.push({ type: "text", text: system.volatile });
    return blocks;
}

/** The conversation tail keeps the default 5-minute TTL: each turn appends and re-writes it. */
const TAIL_CACHE_CONTROL: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

/**
 * Mark the last block of the conversation, so every request reads the turns before it instead of
 * re-processing them; within a run the agent appends a turn per iteration and the hits accrue as
 * it grows. This is the second of the two breakpoints (the system prefix carries the first).
 *
 * Block-level `cache_control` rather than the request-level automatic field, which would place
 * this marker for us: the automatic field is newer, and an older Anthropic-compatible gateway
 * behind a custom `baseURL` may reject a request field it does not know, while an unknown block
 * field is simply ignored.
 */
export function markConversationTail(messages: MessageParam[]): void {
    const last = messages[messages.length - 1];
    if (last === undefined) return;

    if (typeof last.content === "string") {
        // A plain string has no block for the marker to sit on; promote it. An empty one has
        // nothing to promote and would be a rejected empty text block, so it is left alone.
        if (last.content) {
            last.content = [{ type: "text", text: last.content, cache_control: TAIL_CACHE_CONTROL }];
        }
        return;
    }

    const blocks = last.content as any[] | undefined;
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: TAIL_CACHE_CONTROL };
}

function toUsage(source: RawUsage | undefined): TokenUsage {
    return {
        inputTokens: source?.input_tokens ?? 0,
        outputTokens: source?.output_tokens ?? 0,
        cacheReadTokens: source?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: source?.cache_creation_input_tokens ?? 0,
    };
}

export function* convertEvent(e: RawStreamEvent, state: StreamState): Iterable<StreamEvent> {
    if (e.type === "content_block_start") {
        yield* bufferBlockStart(e, state);
    } else if (e.type === "content_block_delta") {
        const event = convertDelta(e, state);
        if (event) yield event;
    } else if (e.type === "content_block_stop") {
        const event = finishBlock(e.index!, state);
        if (event) yield event;
    } else if (e.type === "message_start") {
        state.usage = toUsage(e.message?.usage);
    } else if (e.type === "message_delta") {
        // The real stop reason (end_turn / tool_use / max_tokens) only appears here.
        if (e.delta?.stop_reason) state.stopReason = e.delta.stop_reason;
        // Output tokens are only final here; the input and cache counts came from message_start.
        if (state.usage && typeof e.usage?.output_tokens === "number") {
            state.usage.outputTokens = e.usage.output_tokens;
        }
        if (state.usage) yield { type: "usage", usage: state.usage };
    } else if (e.type === "message_stop") {
        yield { type: "done", stopReason: state.stopReason ?? "end_turn" };
    }
}

function* bufferBlockStart(e: RawStreamEvent, state: StreamState): Iterable<StreamEvent> {
    const block = e.content_block;
    if (block?.type === "tool_use") {
        state.toolBuf.set(e.index!, { id: block.id, name: block.name, args: "" });
    } else if (block?.type === "thinking") {
        state.thinkingBuf.set(e.index!, { thinking: block.thinking ?? "", signature: "" });
    } else if (block?.type === "redacted_thinking") {
        yield { type: "thinking", block: { type: "redacted_thinking", data: block.data } };
    }
}

function convertDelta(e: RawStreamEvent, state: StreamState): StreamEvent | undefined {
    if (e.delta?.type === "text_delta") {
        return { type: "text", text: e.delta.text };
    }
    if (e.delta?.type === "input_json_delta") {
        const tb = state.toolBuf.get(e.index!);
        if (tb) tb.args += e.delta.partial_json;
    } else if (e.delta?.type === "thinking_delta") {
        const tb = state.thinkingBuf.get(e.index!);
        if (tb) tb.thinking += e.delta.thinking;
    } else if (e.delta?.type === "signature_delta") {
        const tb = state.thinkingBuf.get(e.index!);
        if (tb) tb.signature += e.delta.signature;
    }
    return undefined;
}

function finishBlock(index: number, state: StreamState): StreamEvent | undefined {
    const thinking = state.thinkingBuf.get(index);
    if (thinking) {
        state.thinkingBuf.delete(index);
        return { type: "thinking", block: { type: "thinking", ...thinking } };
    }
    const tb = state.toolBuf.get(index);
    if (tb) {
        state.toolBuf.delete(index);
        // A parameterless tool may stream no input_json_delta at all; "" is not valid JSON.
        return { type: "tool_call", id: tb.id, name: tb.name, arguments: tb.args || "{}" };
    }
    return undefined;
}

function toTool(t: Tool): any {
    return { name: t.name, description: t.description, input_schema: t.parameters };
}

export function toMessages(messages: ChatMessage[]): MessageParam[] {
    const out: MessageParam[] = [];
    for (const m of messages) {
        if (m.role === "user") {
            out.push(toUserMessage(m));
        } else if (m.role === "assistant") {
            const message = toAssistantMessage(m);
            if (message) out.push(message);
        } else {
            appendToolResult(out, m);
        }
    }
    return out;
}

type MessageParam = { role: string; content: unknown };

function toUserMessage(m: ChatMessage & { role: "user" }): MessageParam {
    if (!m.images?.length) return { role: "user", content: m.content };
    return { role: "user", content: imageContent(m.content, m.images) };
}

function toAssistantMessage(m: ChatMessage & { role: "assistant" }): MessageParam | undefined {
    // Thinking blocks must be replayed first and unmodified while thinking is enabled.
    const content: unknown[] = [...(m.thinking ?? [])];
    if (m.content) content.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: JSON.parse(tc.arguments || "{}") });
    }
    // The API rejects an assistant message with empty content.
    if (content.length === 0) return undefined;
    return { role: "assistant", content };
}

function appendToolResult(out: MessageParam[], m: ChatMessage & { role: "tool" }): void {
    const resultContent = m.images?.length ? imageContent(m.content, m.images) : m.content;
    const last = out[out.length - 1];
    const blocks = last?.content as any[] | undefined;
    if (last?.role === "user" && Array.isArray(blocks) && blocks.every((b) => b.type === "tool_result")) {
        blocks.push({ type: "tool_result", tool_use_id: m.toolCallId, content: resultContent });
    } else {
        out.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: resultContent }],
        });
    }
}

function imageContent(text: string, images: ImagePart[]): unknown[] {
    const content: unknown[] = images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
    }));
    // Empty text blocks are rejected by the API.
    if (text) content.push({ type: "text", text });
    return content;
}
