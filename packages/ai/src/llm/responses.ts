// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import OpenAI from "openai";
import type { LLMConfig } from "../settings";
import {
    type ChatMessage,
    flattenSystem,
    type ImagePart,
    type LLMProvider,
    type StreamChatOptions,
    type StreamEvent,
    type Tool,
} from "./types";

type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent;
type ToolArgsBuffer = Map<string, string>;

/** OpenAI Responses API provider, via the official `openai` SDK. */
export class ResponsesProvider implements LLMProvider {
    readonly id = "responses";
    private readonly client: OpenAI;

    constructor(config: LLMConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: (config.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
            dangerouslyAllowBrowser: true,
        });
    }

    async *streamChat(opts: StreamChatOptions): AsyncIterable<StreamEvent> {
        try {
            yield* this.stream(opts, toInput(opts.messages));
        } catch (err) {
            // Some compatible endpoints reject array output on function_call_output;
            // downgrade to plain-text output (images omitted) and retry once.
            const fallback = toPlainTextInput(opts.messages);
            if (!fallback) throw err;
            yield* this.stream(opts, fallback);
        }
    }

    private async *stream(opts: StreamChatOptions, input: unknown[]): AsyncIterable<StreamEvent> {
        const stream = await this.client.responses.create(
            {
                model: opts.model,
                // One instruction string, stable half first — see `SystemPrompt`.
                instructions: flattenSystem(opts.system),
                input: input as any,
                tools: opts.tools.map(toTool) as any,
                stream: true,
            },
            { signal: opts.signal },
        );

        const toolArgs: ToolArgsBuffer = new Map();
        for await (const event of stream) {
            yield* convertEvent(event, toolArgs);
        }
    }
}

function* convertEvent(event: ResponseStreamEvent, toolArgs: ToolArgsBuffer): Iterable<StreamEvent> {
    if (event.type === "response.output_text.delta") {
        yield { type: "text", text: event.delta };
    } else if (event.type === "response.function_call_arguments.delta") {
        toolArgs.set(event.item_id, (toolArgs.get(event.item_id) ?? "") + event.delta);
    } else if (event.type === "response.output_item.done") {
        if (event.item.type !== "function_call") return;
        yield {
            type: "tool_call",
            id: event.item.call_id,
            name: event.item.name,
            arguments: event.item.arguments || toolArgs.get(event.item.id ?? "") || "",
        };
    } else if (event.type === "response.completed") {
        yield { type: "done", stopReason: event.response.status ?? "completed" };
    }
}

function toTool(t: Tool) {
    return {
        type: "function" as const,
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
    };
}

/**
 * Same input, but tool outputs are plain text (images omitted). Returns undefined when
 * no tool output carries images, i.e. there is nothing to downgrade.
 */
function toPlainTextInput(messages: ChatMessage[]): unknown[] | undefined {
    if (!messages.some((m) => m.role === "tool" && m.images?.length)) return undefined;
    return toInput(messages.map((m) => (m.role === "tool" ? { ...m, images: undefined } : m)));
}

function toInput(messages: ChatMessage[]): unknown[] {
    const input: unknown[] = [];
    for (const m of messages) {
        if (m.role === "user") {
            input.push(toUserInput(m));
        } else if (m.role === "assistant") {
            input.push(...toAssistantInputs(m));
        } else {
            input.push(toToolOutput(m));
        }
    }
    return input;
}

function toUserInput(m: ChatMessage & { role: "user" }): unknown {
    const content: unknown[] = [];
    for (const image of m.images ?? []) {
        content.push(imageInput(image));
    }
    content.push({ type: "input_text", text: m.content });
    return { role: "user", content };
}

function toAssistantInputs(m: ChatMessage & { role: "assistant" }): unknown[] {
    const input: unknown[] = [];
    if (m.content) {
        input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
    }
    for (const tc of m.toolCalls ?? []) {
        input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: tc.arguments });
    }
    return input;
}

function toToolOutput(m: ChatMessage & { role: "tool" }): unknown {
    const output = m.images?.length
        ? [{ type: "input_text", text: m.content }, ...m.images.map(imageInput)]
        : m.content;
    return { type: "function_call_output", call_id: m.toolCallId, output };
}

function imageInput(image: ImagePart): unknown {
    return { type: "input_image", image_url: `data:${image.mediaType};base64,${image.data}` };
}
