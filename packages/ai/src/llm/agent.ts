// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { LLMConfig } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { CompletionsProvider } from "./completions";
import { ResponsesProvider } from "./responses";
import type { ChatMessage, ImagePart, LLMProvider, ThinkingBlock, Tool, ToolCall } from "./types";

export interface ChatCallbacks {
    onTextDelta(text: string): void;
    onToolCall(call: { name: string; arguments: string; result?: string }): void;
}

/** Upper bound on model<->tool round trips per run, so a stuck tool loop cannot spin forever. */
export const MAX_AGENT_ITERATIONS = 25;

const STEP_LIMIT_NOTICE = "(Reached the maximum number of steps; stopping here.)";

interface RunAgentOptions {
    config: LLMConfig;
    system: string;
    messages: ChatMessage[];
    tools: Tool[];
    callbacks: ChatCallbacks;
    signal?: AbortSignal;
    provider?: LLMProvider;
}

type ToolOutput = { toolCallId: string; name: string; content: string; images?: ImagePart[] };

export function createProvider(config: LLMConfig): LLMProvider {
    if (config.provider === "anthropic") return new AnthropicProvider(config);
    if (config.provider === "responses") return new ResponsesProvider(config);
    return new CompletionsProvider(config);
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
    const provider = opts.provider ?? createProvider(opts.config);
    let producedText = false;

    try {
        for (let iteration = 0; ; iteration++) {
            if (opts.signal?.aborted) break;
            const { text, toolCalls, thinking } = await streamTurn(provider, opts);

            opts.messages.push(assistantMessage(text, toolCalls, thinking));
            if (text) producedText = true;
            if (toolCalls.length === 0) break;

            appendToolResults(opts, await runToolCalls(opts, toolCalls));

            if (opts.signal?.aborted) break;
            if (iteration + 1 >= MAX_AGENT_ITERATIONS) {
                if (!producedText) opts.callbacks.onTextDelta(STEP_LIMIT_NOTICE);
                break;
            }
        }
    } catch (err) {
        // The SDKs surface user cancellation as an AbortError mid-stream; treat it as a clean stop.
        if (opts.signal?.aborted) return;
        throw err;
    }
}

function assistantMessage(text: string, toolCalls: ToolCall[], thinking: ThinkingBlock[]): ChatMessage {
    return {
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        thinking: thinking.length ? thinking : undefined,
    };
}

function appendToolResults(opts: RunAgentOptions, results: ToolOutput[]): void {
    opts.messages.push(
        ...results.map((r) => ({
            role: "tool" as const,
            toolCallId: r.toolCallId,
            name: r.name,
            content: r.content,
            images: r.images,
        })),
    );
}

/** Streams one model turn, forwarding text deltas to the UI and collecting tool calls. */
async function streamTurn(
    provider: LLMProvider,
    opts: RunAgentOptions,
): Promise<{ text: string; toolCalls: ToolCall[]; thinking: ThinkingBlock[] }> {
    let text = "";
    const toolCalls: ToolCall[] = [];
    const thinking: ThinkingBlock[] = [];
    for await (const ev of provider.streamChat({
        model: opts.config.model,
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
        signal: opts.signal,
    })) {
        if (ev.type === "text") {
            text += ev.text;
            opts.callbacks.onTextDelta(ev.text);
        } else if (ev.type === "tool_call") {
            toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
        } else if (ev.type === "thinking") {
            thinking.push(ev.block);
        }
    }
    return { text, toolCalls, thinking };
}

// Runs tool calls sequentially: ref-chained ops (run_box -> run_fillet) depend on
// earlier results being registered in the session, so parallel execution breaks them.
async function runToolCalls(opts: RunAgentOptions, toolCalls: ToolCall[]): Promise<ToolOutput[]> {
    const results: ToolOutput[] = [];
    for (const tc of toolCalls) {
        const tool = opts.tools.find((t) => t.name === tc.name);
        const { content, images } = await invokeTool(tc, tool, opts.signal);
        opts.callbacks.onToolCall({ name: tc.name, arguments: tc.arguments, result: content });
        results.push({ toolCallId: tc.id, name: tc.name, content, images });
    }
    return results;
}

/** Executes a single tool call; unknown tools and thrown errors become JSON the model can read. */
async function invokeTool(
    tc: ToolCall,
    tool: Tool | undefined,
    signal?: AbortSignal,
): Promise<{ content: string; images?: ImagePart[] }> {
    if (!tool) {
        return { content: JSON.stringify({ error: `unknown tool "${tc.name}"` }) };
    }
    try {
        const result = await tool.handler(JSON.parse(tc.arguments), signal);
        if (typeof result === "string") {
            return { content: result };
        }
        return { content: result.content, images: result.images };
    } catch (err) {
        return { content: JSON.stringify({ error: (err as Error).message }) };
    }
}
