// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MAX_AGENT_ITERATIONS, runAgent } from "../src/llm/agent";
import type { ChatMessage, LLMProvider, StreamEvent, Tool } from "../src/llm/types";

async function* fakeStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
    for (const e of events) yield e;
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
            system: "sys",
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
            system: "sys",
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
            system: "sys",
            messages,
            tools,
            callbacks: { onTextDelta: (t) => deltas.push(t), onToolCall: () => {} },
            provider,
        });

        expect(handlerCalls).toBe(MAX_AGENT_ITERATIONS);
        // No text was ever produced, so the UI gets a termination notice instead.
        expect(deltas.length).toBe(1);
        expect(deltas[0]).toContain("maximum number of steps");
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
            system: "sys",
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
});
