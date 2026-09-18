// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MAX_AGENT_ITERATIONS, runAgent } from "../src/llm/agent";
import type { ChatMessage, LLMProvider, StreamEvent, SystemPrompt, Tool } from "../src/llm/types";

/** The system prompt is irrelevant to these tests — one stable half, no snapshot. */
const SYSTEM: SystemPrompt = { stable: "sys", volatile: "" };

async function* fakeStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
    for (const e of events) yield e;
}

/** An async iterable that runs `before` then fails on first pull, like an SDK abort mid-stream. */
function failingStream(before: () => void, message: string): AsyncIterable<StreamEvent> {
    return {
        [Symbol.asyncIterator]() {
            return {
                next: () => {
                    before();
                    return Promise.reject(new Error(message));
                },
            };
        },
    };
}

describe("runAgent", () => {
    test("runs tool calls and accumulates normalized messages", async () => {
        const handlerCalls: unknown[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "text", text: "done" };
                    yield { type: "done", stopReason: "end_turn" };
                } else {
                    yield { type: "text", text: "creating" };
                    yield {
                        type: "tool_call",
                        id: "t1",
                        name: "my_tool",
                        arguments: JSON.stringify({ a: 1 }),
                    };
                    yield { type: "done", stopReason: "tool_use" };
                }
            },
        };

        const messages: ChatMessage[] = [];
        const tools: Tool[] = [
            {
                name: "my_tool",
                description: "",
                parameters: { type: "object" },
                handler: async (args) => {
                    handlerCalls.push(args);
                    return JSON.stringify({ ok: true });
                },
            },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
            provider,
        });

        expect(handlerCalls).toEqual([{ a: 1 }]);
        expect(messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
        expect((messages[1] as { toolCallId: string }).toolCallId).toBe("t1");
    });

    test("streams text deltas through callbacks", async () => {
        const deltas: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "text", text: "hel" };
                yield { type: "text", text: "lo" };
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools: [],
            callbacks: { onTextDelta: (t) => deltas.push(t), onToolCall: () => {} },
            provider,
        });

        expect(deltas).toEqual(["hel", "lo"]);
        expect(messages).toEqual([{ role: "assistant", content: "hello", toolCalls: undefined }]);
    });

    test("stops after MAX_AGENT_ITERATIONS when the model never stops calling tools", async () => {
        let handlerCalls = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "tool_call", id: "t", name: "loop_tool", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "loop_tool",
                description: "",
                parameters: { type: "object" },
                handler: async () => {
                    handlerCalls++;
                    return JSON.stringify({ ok: true });
                },
            },
        ];
        const deltas: string[] = [];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: { onTextDelta: (t) => deltas.push(t), onToolCall: () => {} },
            provider,
        });

        expect(handlerCalls).toBe(MAX_AGENT_ITERATIONS);
        // No text was ever produced, so the notice is the only thing the user sees.
        expect(deltas.length).toBe(1);
        // The ai package's tests don't load the locale data, so a key comes back untranslated;
        // this still pins which message the run ends with.
        expect(deltas[0]).toBe("ai.stepLimit");
    });

    test("says the step limit was hit even when the model had been talking", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "text", text: "tick" };
                yield { type: "tool_call", id: "t", name: "loop_tool", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "loop_tool",
                description: "",
                parameters: { type: "object" },
                handler: async () => JSON.stringify({ ok: true }),
            },
        ];
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools,
            callbacks: { onTextDelta: (t) => deltas.push(t), onToolCall: () => {} },
            provider,
        });

        // The run stopped mid-plan, and that has to be said out loud — the model's own last
        // words read like a finished answer.
        expect(deltas.at(-1)).toBe("ai.stepLimit");
        expect(deltas.length).toBe(MAX_AGENT_ITERATIONS + 1);
    });

    test("returns tool handler errors to the model as JSON and continues the loop", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "text", text: "recovered" };
                    yield { type: "done", stopReason: "end_turn" };
                } else {
                    yield { type: "tool_call", id: "t1", name: "boom_tool", arguments: "{}" };
                    yield { type: "done", stopReason: "tool_use" };
                }
            },
        };
        const tools: Tool[] = [
            {
                name: "boom_tool",
                description: "",
                parameters: { type: "object" },
                handler: async () => {
                    throw new Error("boom");
                },
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
            provider,
        });

        const toolMessage = messages.find((m) => m.role === "tool");
        expect(toolMessage).toBeDefined();
        expect(JSON.parse((toolMessage as { content: string }).content)).toEqual({ error: "boom" });
        expect(messages[messages.length - 1]).toEqual({
            role: "assistant",
            content: "recovered",
            toolCalls: undefined,
        });
    });

    test("stores thinking blocks on the assistant message", async () => {
        const block = { type: "thinking" as const, thinking: "hmm", signature: "sig" };
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "thinking", block };
                yield { type: "text", text: "answer" };
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools: [],
            callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
            provider,
        });

        expect(messages).toEqual([
            { role: "assistant", content: "answer", toolCalls: undefined, thinking: [block] },
        ]);
    });

    test("treats an abort error from the provider as a clean stop", async () => {
        const controller = new AbortController();
        const provider: LLMProvider = {
            id: "fake",
            streamChat: () => failingStream(() => controller.abort(), "The operation was aborted"),
        };
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools: [],
            callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
            provider,
            signal: controller.signal,
        });

        expect(messages).toEqual([]);
    });

    test("rethrows provider errors when not aborted", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: () => failingStream(() => {}, "boom"),
        };

        await expect(
            runAgent({
                config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
                system: SYSTEM,
                messages: [],
                tools: [],
                callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
                provider,
            }),
        ).rejects.toThrow("boom");
    });

    test("passes the abort signal through to tool handlers", async () => {
        let received: unknown;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "done", stopReason: "end_turn" };
                } else {
                    yield { type: "tool_call", id: "t1", name: "probe", arguments: "{}" };
                    yield { type: "done", stopReason: "tool_use" };
                }
            },
        };
        const controller = new AbortController();
        const tools: Tool[] = [
            {
                name: "probe",
                description: "",
                parameters: { type: "object" },
                handler: async (_args, signal) => {
                    received = signal;
                    return "ok";
                },
            },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools,
            callbacks: { onTextDelta: () => {}, onToolCall: () => {} },
            provider,
            signal: controller.signal,
        });

        expect(received).toBe(controller.signal);
    });
});
