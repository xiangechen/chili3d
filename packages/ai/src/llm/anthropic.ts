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
    Tool,
    ToolCallBuffer,
} from "./types";

type RawStreamEvent = { type: string; index?: number; content_block?: any; delta?: any };

export interface StreamState {
    toolBuf: ToolCallBuffer;
    thinkingBuf: Map<number, { thinking: string; signature: string }>;
    stopReason?: string;
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
        const stream = this.client.messages.stream(
            {
                model: opts.model,
                max_tokens: 64000,
                thinking: { type: "adaptive" },
                system: opts.system,
                messages: toMessages(opts.messages) as any,
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

export function* convertEvent(e: RawStreamEvent, state: StreamState): Iterable<StreamEvent> {
    if (e.type === "content_block_start") {
        yield* bufferBlockStart(e, state);
    } else if (e.type === "content_block_delta") {
        const event = convertDelta(e, state);
        if (event) yield event;
    } else if (e.type === "content_block_stop") {
        const event = finishBlock(e.index!, state);
        if (event) yield event;
    } else if (e.type === "message_delta") {
        // The real stop reason (end_turn / tool_use / max_tokens) only appears here.
        if (e.delta?.stop_reason) state.stopReason = e.delta.stop_reason;
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
