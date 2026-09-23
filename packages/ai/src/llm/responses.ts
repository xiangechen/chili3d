// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import OpenAI from "openai";
import type { LLMConfig } from "../settings";
import {
    type ChatMessage,
    flattenSystem,
    type ImagePart,
    type LLMProvider,
    openAIReasoningEffort,
    type StreamChatOptions,
    type StreamEvent,
    type TokenUsage,
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
                // Without this the API produces no reasoning events at all, and the branch that
                // reads them below simply never fires. `auto` lets the model decide how much of
                // its reasoning to summarise.
                reasoning: {
                    summary: "auto",
                    ...(opts.effort ? { effort: openAIReasoningEffort(opts.effort) } : {}),
                },
            },
            { signal: opts.signal },
        );

        const state: ConvertState = { toolArgs: new Map(), reasoned: false, texted: false, calls: 0 };
        const unconsumed = new Set<string>();
        for await (const event of stream) {
            // Which events a backend actually sends varies by model and endpoint, and a missing
            // one shows up as a feature that silently does nothing. Name each unhandled type once
            // per stream (console.debug, so it stays out of the way until someone looks).
            if (!KNOWN_EVENTS.has(event.type) && !unconsumed.has(event.type)) {
                unconsumed.add(event.type);
                console.debug(`[ai] responses: unhandled stream event "${event.type}"`);
            }
            yield* convertEvent(event, state);
        }
    }
}

/**
 * Acted on, or deliberately ignored. The second group is the lifecycle and framing events every
 * backend sends around the content — logging those once taught us nothing. Anything outside this
 * set is reported once per stream: that is how a backend quietly carrying content in a shape we
 * never read gets noticed, which is exactly how the reasoning here was found.
 *
 * The set is what a plain chat request draws from, not everything the SDK declares: the events of
 * features this app never asks for (audio, code interpreter, file search, MCP, web search) are
 * left out deliberately, so that a backend enabling one of them behind our back still logs. The
 * `*.done` twins of the deltas below are framing — the text has already arrived — and listing them
 * is what keeps a reasoning turn, which sends four of them, from reading as four unknown events.
 */
const KNOWN_EVENTS = new Set([
    // Acted on.
    "response.output_text.delta",
    "response.reasoning_summary_text.delta",
    "response.reasoning_text.delta",
    "response.function_call_arguments.delta",
    "response.output_item.done",
    "response.completed",
    "response.incomplete",
    "response.failed",
    // Frames the stream but carries nothing we use; the content arrived as deltas above.
    "response.queued",
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.done",
    "response.output_text.annotation.added",
    "response.reasoning_summary_part.added",
    "response.reasoning_summary_part.done",
    "response.reasoning_summary_text.done",
    "response.reasoning_text.done",
    "response.function_call_arguments.done",
]);

export interface ConvertState {
    toolArgs: ToolArgsBuffer;
    /** Whether reasoning text has already been shown, so a finished item will not repeat it. */
    reasoned: boolean;
    /** The same for the answer: a backend that sends no text deltas still sends the message. */
    texted: boolean;
    /** Calls this stream produced, so the line below says what a long turn actually asked for. */
    calls: number;
}

/** Everything readable a reasoning item carries: its summary parts, then any raw text parts. */
function reasoningItemText(item: { summary?: { text: string }[]; content?: { text: string }[] }): string {
    return [...(item.summary ?? []), ...(item.content ?? [])]
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n\n");
}

export function* convertEvent(event: ResponseStreamEvent, state: ConvertState): Iterable<StreamEvent> {
    if (event.type === "response.output_text.delta") {
        state.texted = true;
        yield { type: "text", text: event.delta };
    } else if (
        event.type === "response.reasoning_summary_text.delta" ||
        event.type === "response.reasoning_text.delta"
    ) {
        // Both families are reasoning text: the summary is what most backends send, the raw text
        // is what some send instead. Display only — unlike Anthropic's thinking blocks there is
        // no signature to replay, so no `thinking` block is emitted for the agent to carry back.
        state.reasoned = true;
        yield { type: "thinking_delta", text: event.delta };
    } else if (event.type === "response.function_call_arguments.delta") {
        state.toolArgs.set(event.item_id, (state.toolArgs.get(event.item_id) ?? "") + event.delta);
    } else if (event.type === "response.output_item.done") {
        const item = event.item;
        if (item.type === "reasoning") {
            // The SDK notes that while streaming, the finished item is the reliable source for a
            // reasoning item's content — so a backend that sends no deltas is covered here. The
            // rule is not the deltas' rule above: this text is the whole of it, so it is only for
            // a turn that streamed none, where every delta is a fragment and all of them belong.
            if (!state.reasoned) {
                const text = reasoningItemText(item);
                if (text) {
                    state.reasoned = true;
                    yield { type: "thinking_delta", text };
                }
            }
            return;
        }
        if (item.type === "message") {
            // The same rule as the reasoning item above, for the answer: what the item holds is
            // the whole of it, so it is only used when no delta streamed. Without this a backend
            // that streams only finished items leaves the turn looking like a model with nothing
            // to say — which is exactly how an "empty reply" gets filed as a model problem.
            if (!state.texted) {
                const text = messageItemText(item);
                if (text) {
                    state.texted = true;
                    yield { type: "text", text };
                }
            }
            return;
        }
        if (item.type !== "function_call") return;
        state.calls++;
        yield {
            type: "tool_call",
            id: item.call_id,
            name: item.name,
            arguments: item.arguments || state.toolArgs.get(item.id ?? "") || "",
        };
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
        // `incomplete` is how a response that ran out of output budget arrives: not an error, and
        // not a `completed` either. Leaving it unhandled is what made a turn that reasoned its
        // budget away end with no stop reason, no text and nothing on screen saying why — the
        // agent treats the status ("incomplete") as the truncation it is.
        // Said at a level the console shows by default when the response stopped short, and not
        // contingent on usage arriving — a relay that omits usage used to hide the one line that
        // explains the missing reply.
        (event.type === "response.completed" ? console.debug : console.warn)(
            stopReport(event.response, state),
        );
        if (event.response.usage) yield { type: "usage", usage: toUsage(event.response.usage) };
        yield { type: "done", stopReason: event.response.status ?? "completed" };
    } else if (event.type === "response.failed") {
        throw new Error(`the model's response failed: ${event.response.error?.message ?? "no reason given"}`);
    }
}

/** Everything readable an assistant message carries: its `output_text` parts, in order. */
function messageItemText(item: { content?: { type?: string; text?: string }[] }): string {
    return (item.content ?? [])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("");
}

/**
 * One line per finished response: what came back and why it stopped. It is the only thing that
 * tells a run which reasoned its budget away from one whose answer the backend never sent — the
 * panel shows both as "no text".
 */
function stopReport(response: OpenAI.Responses.Response, state: ConvertState): string {
    const reason = response.incomplete_details?.reason;
    return (
        `[ai] responses: status=${response.status ?? "?"}${reason ? ` (${reason})` : ""}` +
        ` text=${state.texted ? "yes" : "none"} calls=${state.calls}` +
        ` reasoning=${state.reasoned ? "shown" : "none"}` +
        ` tokens=${response.usage?.output_tokens_details?.reasoning_tokens ?? 0} reasoning`
    );
}

function toUsage(usage: OpenAI.Responses.ResponseUsage): TokenUsage {
    const details = usage.input_tokens_details;
    const cached = details?.cached_tokens ?? 0;
    const written = details?.cache_write_tokens ?? 0;
    return {
        // OpenAI counts cached input inside `input_tokens`, where Anthropic reports it in fields
        // of its own. `TokenUsage` keeps the three apart, so they must be subtracted out here or
        // `contextTokens` counts the cached half twice and the meter reads double.
        inputTokens: usage.input_tokens - cached - written,
        outputTokens: usage.output_tokens,
        cacheReadTokens: cached,
        cacheCreationTokens: written,
    };
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
