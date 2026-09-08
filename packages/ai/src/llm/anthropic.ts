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

export class AnthropicProvider implements LLMProvider {
    readonly id = "anthropic";
    private readonly client: Anthropic;

    constructor(config: LLMConfig) {
        this.client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true });
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

        const toolBuf: ToolCallBuffer = new Map();
        for await (const raw of stream) {
            yield* convertEvent(raw as RawStreamEvent, toolBuf);
        }
    }
}

function* convertEvent(e: RawStreamEvent, toolBuf: ToolCallBuffer): Iterable<StreamEvent> {
    if (e.type === "content_block_start") {
        bufferToolUseStart(e, toolBuf);
    } else if (e.type === "content_block_delta") {
        const event = convertDelta(e, toolBuf);
        if (event) yield event;
    } else if (e.type === "content_block_stop") {
        const tb = toolBuf.get(e.index!);
        if (tb) {
            yield { type: "tool_call", id: tb.id, name: tb.name, arguments: tb.args };
            toolBuf.delete(e.index!);
        }
    } else if (e.type === "message_stop") {
        yield { type: "done", stopReason: "end_turn" };
    }
}

function bufferToolUseStart(e: RawStreamEvent, toolBuf: ToolCallBuffer): void {
    if (e.content_block?.type === "tool_use") {
        toolBuf.set(e.index!, { id: e.content_block.id, name: e.content_block.name, args: "" });
    }
}

function convertDelta(e: RawStreamEvent, toolBuf: ToolCallBuffer): StreamEvent | undefined {
    if (e.delta?.type === "text_delta") {
        return { type: "text", text: e.delta.text };
    }
    if (e.delta?.type === "input_json_delta") {
        const tb = toolBuf.get(e.index!);
        if (tb) tb.args += e.delta.partial_json;
    }
    return undefined;
}

function toTool(t: Tool): any {
    return { name: t.name, description: t.description, input_schema: t.parameters };
}

function toMessages(messages: ChatMessage[]): MessageParam[] {
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
    const content: unknown[] = [];
    if (m.content) content.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) });
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
    return [
        ...images.map((img) => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
        })),
        { type: "text", text },
    ];
}
