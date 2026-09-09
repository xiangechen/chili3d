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
export class CompletionsProvider implements LLMProvider {
    readonly id = "completions";
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

export function* convertChunk(
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
    for (const [index, slot] of [...toolBuf].sort((a, b) => a[0] - b[0])) {
        yield { type: "tool_call", id: slot.id, name: slot.name, arguments: slot.args || "{}" };
        toolBuf.delete(index);
    }
}

function toTool(t: Tool) {
    return {
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
    };
}

export function toMessages(system: string, messages: ChatMessage[]): MessageParam[] {
    const out: MessageParam[] = [{ role: "system", content: system }];
    // OpenAI tool messages cannot carry images; collect them and forward in a follow-up user
    // message once the tool-message run ends (a user message must not split consecutive tools).
    const pendingImages: ImagePart[] = [];
    const flushImages = () => {
        if (!pendingImages.length) return;
        out.push({
            role: "user",
            content: mixedContent("Images from the tool result above:", pendingImages),
        });
        pendingImages.length = 0;
    };
    for (const m of messages) {
        if (m.role === "user") {
            flushImages();
            out.push(toUserMessage(m));
        } else if (m.role === "assistant") {
            flushImages();
            const message = toAssistantMessage(m);
            if (message) out.push(message);
        } else {
            out.push(toToolMessage(m));
            if (m.images?.length) pendingImages.push(...m.images);
        }
    }
    flushImages();
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
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
}

function mixedContent(text: string, images: ImagePart[]): unknown[] {
    const content: unknown[] = [];
    if (text) content.push({ type: "text", text });
    for (const img of images) {
        content.push({
            type: "image_url",
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        });
    }
    return content;
}
