// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import OpenAI from "openai";
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

/** OpenAI-compatible Chat Completions provider (GPT / DeepSeek / Kimi / any endpoint). */
export class OpenAICompatProvider implements LLMProvider {
    readonly id = "openai-compatible";
    private readonly client: OpenAI;

    constructor(config: LLMConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: (config.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
            dangerouslyAllowBrowser: true,
        });
    }

    async *streamChat(opts: StreamChatOptions): AsyncIterable<StreamEvent> {
        const stream = await this.client.chat.completions.create(
            {
                model: opts.model,
                messages: toMessages(opts.system, opts.messages) as any,
                tools: opts.tools.map(toTool) as any,
                stream: true,
                parallel_tool_calls: false,
            },
            { signal: opts.signal },
        );

        const toolBuf: ToolCallBuffer = new Map();
        for await (const chunk of stream) {
            yield* convertChunk(chunk, toolBuf);
        }
        // Some compatible endpoints end the stream without finish_reason; flush anyway so
        // buffered tool calls are not silently dropped.
        yield* flushToolCalls(toolBuf);
    }
}

function* convertChunk(
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    toolBuf: ToolCallBuffer,
): Iterable<StreamEvent> {
    const choice = chunk.choices[0];
    if (!choice) return;
    if (choice.delta.content) {
        yield { type: "text", text: choice.delta.content };
    }
    accumulateToolCalls(choice.delta, toolBuf);
    if (choice.finish_reason) {
        yield* flushToolCalls(toolBuf);
        yield { type: "done", stopReason: choice.finish_reason };
    }
}

function accumulateToolCalls(
    delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
    toolBuf: ToolCallBuffer,
): void {
    for (const tc of delta.tool_calls ?? []) {
        const slot = toolBuf.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        toolBuf.set(tc.index, slot);
    }
}

function* flushToolCalls(toolBuf: ToolCallBuffer): Iterable<StreamEvent> {
    for (const [index, slot] of [...toolBuf]) {
        yield { type: "tool_call", id: slot.id, name: slot.name, arguments: slot.args };
        toolBuf.delete(index);
    }
}

function toTool(t: Tool) {
    return {
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
    };
}

function toMessages(system: string, messages: ChatMessage[]): MessageParam[] {
    const out: MessageParam[] = [{ role: "system", content: system }];
    for (const m of messages) {
        if (m.role === "user") {
            out.push(toUserMessage(m));
        } else if (m.role === "assistant") {
            const message = toAssistantMessage(m);
            if (message) out.push(message);
        } else {
            out.push(toToolMessage(m));
        }
    }
    return out;
}

type MessageParam = Record<string, unknown>;

function toUserMessage(m: ChatMessage & { role: "user" }): MessageParam {
    if (!m.images?.length) return { role: "user", content: m.content };
    return { role: "user", content: mixedContent(m.content, m.images) };
}

function toAssistantMessage(m: ChatMessage & { role: "assistant" }): MessageParam | undefined {
    // Some compatible endpoints reject `content: null` with no tool calls; skip those.
    if (!m.content && !m.toolCalls?.length) return undefined;
    const msg: MessageParam = { role: "assistant", content: m.content || null };
    if (m.toolCalls?.length) {
        msg["tool_calls"] = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
        }));
    }
    return msg;
}

function toToolMessage(m: ChatMessage & { role: "tool" }): MessageParam {
    const content = m.images?.length ? mixedContent(m.content, m.images) : m.content;
    return { role: "tool", tool_call_id: m.toolCallId, content };
}

function mixedContent(text: string, images: ImagePart[]): unknown[] {
    return [
        { type: "text", text },
        ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        })),
    ];
}
