// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import {
    contextLimitFromError,
    isContextOverflowError,
    MAX_AGENT_ITERATIONS,
    MAX_IDLE_NUDGES,
    MAX_LOST_CALL_NUDGES,
    MAX_TRUNCATION_CONTINUES,
    promisedToAct,
    runAgent,
} from "../src/llm/agent";
import type { ChatMessage, LLMProvider, StreamEvent, SystemPrompt, Tool } from "../src/llm/types";

/** The system prompt is irrelevant to these tests — one stable half, no snapshot. */
const SYSTEM: SystemPrompt = { stable: "sys", volatile: "" };

async function* fakeStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
    for (const e of events) yield e;
}

/** An async iterable that rejects on its first pull, like an endpoint refusing the request. */
function rejectingStream(err: unknown): AsyncIterable<StreamEvent> {
    return {
        [Symbol.asyncIterator]() {
            return { next: () => Promise.reject(err) };
        },
    };
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
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(handlerCalls).toEqual([{ a: 1 }]);
        expect(messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
        expect((messages[1] as { toolCallId: string }).toolCallId).toBe("t1");
    });

    test("stops between tool calls and drops their results once aborted", async () => {
        const controller = new AbortController();
        const ran: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "tool_call", id: "t1", name: "first", arguments: "{}" };
                yield { type: "tool_call", id: "t2", name: "second", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tool = (name: string): Tool => ({
            name,
            description: "",
            parameters: { type: "object" },
            handler: async () => {
                ran.push(name);
                return "{}";
            },
        });
        const tools: Tool[] = [
            {
                ...tool("first"),
                handler: async () => {
                    ran.push("first");
                    // The user pressed Stop while the first call was running.
                    controller.abort();
                    return "{}";
                },
            },
            tool("second"),
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            signal: controller.signal,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(ran).toEqual(["first"]);
        // The aborted batch's result must not land in whatever history replaced this one.
        expect(messages.some((message) => message.role === "tool")).toBe(false);
    });

    test("announces each tool batch before running it", async () => {
        let batches = 0;
        let calls = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                if (calls === 1) {
                    yield { type: "tool_call", id: "t1", name: "my_tool", arguments: "{}" };
                    yield { type: "done", stopReason: "tool_use" };
                } else {
                    yield { type: "done", stopReason: "end_turn" };
                }
            },
        };
        const tools: Tool[] = [
            { name: "my_tool", description: "", parameters: { type: "object" }, handler: async () => "{}" },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
                onToolBatchStart: () => batches++,
            },
            provider,
        });

        expect(batches).toBe(1);
    });

    test("runs every call one response carries, in the order the model listed them", async () => {
        const ran: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "text", text: "done" };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                // One response, two calls, the second naming what the first returns. Parallel
                // calls are supposed to be independent, but a model that batches a chain is
                // common enough that running them in order is what makes the batch safe.
                yield {
                    type: "tool_call",
                    id: "t1",
                    name: "make_box",
                    arguments: JSON.stringify({ id: "a" }),
                };
                yield {
                    type: "tool_call",
                    id: "t2",
                    name: "fillet",
                    arguments: JSON.stringify({ shape: "a" }),
                };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "make_box",
                description: "",
                parameters: { type: "object" },
                handler: async (args) => {
                    ran.push(`box:${(args as { id: string }).id}`);
                    return JSON.stringify({ ref: "a" });
                },
            },
            {
                name: "fillet",
                description: "",
                parameters: { type: "object" },
                // Fails loudly if the batch is ever executed out of order or at once.
                handler: async (args) => {
                    if (!ran.includes("box:a")) throw new Error("ran before the shape it names");
                    ran.push(`fillet:${(args as { shape: string }).shape}`);
                    return JSON.stringify({ ok: true });
                },
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(ran).toEqual(["box:a", "fillet:a"]);
        expect(messages.filter((m) => m.role === "tool").length).toBe(2);
        // One round trip carried both, which is the whole point of allowing them at once.
        expect(messages.filter((m) => m.role === "assistant").length).toBe(2);
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
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
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
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(handlerCalls).toBe(MAX_AGENT_ITERATIONS);
        // No text was ever produced, so the notice is the only thing the user sees.
        expect(deltas.length).toBe(1);
        // The ai package's tests don't load the locale data, so a key comes back untranslated;
        // this still pins which message the run ends with.
        expect(deltas[0]).toBe("ai.stepLimit");
    });

    test("asks for the rest when the output limit cut the turn off", async () => {
        const efforts: (string | undefined)[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                efforts.push(opts.effort);
                if (opts.messages.some((m) => m.content?.startsWith("Your last message was cut off"))) {
                    yield { type: "text", text: "carried on" };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                // Nothing but reasoning, and the budget gone: the shape a planning-heavy model
                // leaves behind, and the one stop where continuing is worth a round trip.
                yield { type: "thinking", block: { type: "thinking", thinking: "…", signature: "s" } };
                yield { type: "done", stopReason: "max_tokens" };
            },
        };
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // The answer came through on the continuation, and the user was never asked to say
        // "continue" themselves.
        expect(deltas).toEqual(["carried on"]);
        // The continuation is sent exactly as the user configured it: the nudge to carry on is not
        // a reason to quietly reason less than the settings asked for.
        expect(efforts).toEqual([undefined, undefined]);
    });

    test("stops asking once the continuations are used up, and says why", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "thinking", block: { type: "thinking", thinking: "…", signature: "s" } };
                yield { type: "done", stopReason: "max_tokens" };
            },
        };
        const deltas: string[] = [];
        let calls = 0;
        const counting: LLMProvider = {
            id: "counting",
            streamChat: (opts) => {
                calls++;
                return provider.streamChat(opts);
            },
        };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider: counting,
        });

        expect(calls).toBe(1 + MAX_TRUNCATION_CONTINUES);
        expect(deltas).toEqual(["ai.truncated"]);
    });

    test("runs the call a truncated turn did carry, and asks for nothing more", async () => {
        const ran: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "text", text: "done" };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: "t1", name: "probe", arguments: "{}" };
                yield { type: "done", stopReason: "max_tokens" };
            },
        };
        const tools: Tool[] = [
            {
                name: "probe",
                description: "",
                parameters: { type: "object" },
                handler: async () => {
                    ran.push("probe");
                    return "{}";
                },
            },
        ];
        const messages: ChatMessage[] = [];
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // A cut after a call is work in hand, not a lost turn: the call runs, the run carries
        // on normally, and no truncation notice is shown — the only text is the next turn's.
        expect(ran).toEqual(["probe"]);
        expect(deltas).toEqual(["done"]);
        expect(messages.some((m) => m.role === "user" && m.content.startsWith("Your last message"))).toBe(
            false,
        );
    });

    test("says so when the output limit cut the turn off", async () => {
        // What a model that reasons past its whole output budget looks like from here: one
        // thinking block, no text, no call, and a stop reason that names the limit. The run used
        // to end silently, which reads the same as a model with nothing to say.
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "thinking", block: { type: "thinking", thinking: "…", signature: "s" } };
                yield { type: "done", stopReason: "max_tokens" };
            },
        };
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // The locale data is not loaded in this package, so a key comes back untranslated — which
        // is what pins which message the turn ends with.
        expect(deltas).toEqual(["ai.truncated"]);
    });

    test("asks again when a tool call the model asked for never arrived", async () => {
        let calls = 0;
        const ran: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                calls++;
                if (calls === 1) {
                    yield { type: "done", stopReason: "tool_use" };
                    return;
                }
                if (calls === 2) {
                    // The nudge is a synthetic user message and must have reached the model.
                    const nudge = opts.messages.find((m) => m.role === "user" && m.synthetic);
                    expect(nudge?.role === "user" && nudge.content).toContain("payload arrived empty");
                    yield { type: "tool_call", id: "t1", name: "my_tool", arguments: "{}" };
                    yield { type: "done", stopReason: "tool_use" };
                    return;
                }
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const deltas: string[] = [];
        const messages: ChatMessage[] = [];
        const tools: Tool[] = [
            {
                name: "my_tool",
                description: "",
                parameters: { type: "object" },
                handler: async () => {
                    ran.push("ran");
                    return JSON.stringify({ ok: true });
                },
            },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(calls).toBe(3);
        expect(ran).toEqual(["ran"]);
        expect(messages.some((m) => m.role === "user" && m.synthetic)).toBe(true);
        expect(deltas).not.toContain("ai.lostToolCall");
    });

    test("gives up on a lost call after MAX_LOST_CALL_NUDGES", async () => {
        let calls = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(calls).toBe(1 + MAX_LOST_CALL_NUDGES);
        expect(deltas).toEqual(["ai.lostToolCall"]);
    });

    test("nudges a turn that promised to act but made no call", async () => {
        let calls = 0;
        const ran: string[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                if (calls === 1) {
                    yield { type: "text", text: "Let me build that." };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                if (calls === 2) {
                    yield { type: "tool_call", id: "t1", name: "my_tool", arguments: "{}" };
                    yield { type: "done", stopReason: "tool_use" };
                    return;
                }
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const tools: Tool[] = [
            {
                name: "my_tool",
                description: "",
                parameters: { type: "object" },
                handler: async () => {
                    ran.push("ran");
                    return "{}";
                },
            },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(calls).toBe(3);
        expect(ran).toEqual(["ran"]);
    });

    test.each([
        "Which face should I fillet?",
        "Let me know if you want it taller.",
        "The box is 10x20x5.",
    ])("does not nudge an ordinary answer: %s", async (text) => {
        let calls = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                yield { type: "text", text };
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(calls).toBe(1);
    });

    test("caps idle nudges at MAX_IDLE_NUDGES", async () => {
        let calls = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                yield { type: "text", text: "Next I'll make the cut." };
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(calls).toBe(1 + MAX_IDLE_NUDGES);
    });

    test("retries once after the endpoint reports an oversized context", async () => {
        let calls = 0;
        const compactCalls: { reason: string; limit?: number }[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                calls++;
                if (calls === 1) {
                    throw Object.assign(new Error("prompt is too long: 210000 tokens > 200000 maximum"), {
                        status: 400,
                    });
                }
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
            compact: (reason, limit) => {
                compactCalls.push({ reason, limit });
                return true;
            },
        });

        expect(calls).toBe(2);
        // The endpoint's own number travels with the compaction: the configured window is not
        // necessarily the one the request was rejected past.
        expect(compactCalls).toEqual([{ reason: "context-overflow", limit: 200000 }]);
    });

    test("does not retry when compacting removed nothing", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: () =>
                rejectingStream(Object.assign(new Error("prompt is too long"), { status: 400 })),
        };

        await expect(
            runAgent({
                config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
                system: SYSTEM,
                messages: [],
                tools: [],
                callbacks: {
                    onTextDelta: () => {},
                    onToolCall: () => {},
                    onThinkingDelta: () => {},
                    onUsage: () => {},
                },
                provider,
                compact: () => false,
            }),
        ).rejects.toThrow("prompt is too long");
    });

    test("does not retry an ordinary endpoint error", async () => {
        let compacted = false;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: () => rejectingStream(Object.assign(new Error("invalid api key"), { status: 401 })),
        };

        await expect(
            runAgent({
                config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
                system: SYSTEM,
                messages: [],
                tools: [],
                callbacks: {
                    onTextDelta: () => {},
                    onToolCall: () => {},
                    onThinkingDelta: () => {},
                    onUsage: () => {},
                },
                provider,
                compact: () => {
                    compacted = true;
                    return true;
                },
            }),
        ).rejects.toThrow("invalid api key");
        expect(compacted).toBe(false);
    });

    test.each([
        [{ status: 400, message: "prompt is too long: 210000 tokens > 200000 maximum" }, true],
        [{ code: "context_length_exceeded", message: "nope" }, true],
        [{ status: 413, message: "request too large" }, true],
        [{ status: 400, message: "invalid tool schema" }, false],
        [{ status: 401, message: "too many tokens in your account" }, false],
        [new Error("network down"), false],
    ])("recognizes an overflow error: %j", (err, expected) => {
        expect(isContextOverflowError(err)).toBe(expected);
    });

    test.each([
        ["prompt is too long: 210000 tokens > 200000 maximum", 200000],
        [
            "This model's maximum context length is 128000 tokens. However, you requested 210000 tokens",
            128000,
        ],
        ["This model's context length of only 8192 tokens is too small", 8192],
        ["the context window is 32000", 32000],
        ["prompt is too long", undefined],
    ])("reads the context limit from an overflow error: %j", (message, expected) => {
        expect(contextLimitFromError(new Error(message))).toBe(expected);
    });

    test.each([
        ["Let me build that.", true],
        ["Next I'll make the cut.", true],
        ["Here is the plan:", true],
        ["Here is what I changed:", false],
        ["The remaining options are:", false],
        ["I’ll build that.", true],
        ["Let’s make it.", true],
        ["Which face should I fillet?", false],
        ["Let me know if you want it taller.", false],
        ["The box is 10x20x5.", false],
        // A closing that names no action is not a promise to act.
        ["I'll be here if you need anything.", false],
        ["I'll let you know when it's done.", false],
        ["Let's see how it looks.", false],
        // Waiting or negating is not consent to act.
        ["I'll wait for your confirmation.", false],
        ["I will not delete that.", false],
        ["I won’t delete that.", false],
        // CJK punctuation is a sentence boundary and the intent words are localized too.
        ["我先创建底板，然后拉伸。", true],
        ["我来建一个盒子。", true],
        ["我先等你确认。", false],
        ["Vou criar a placa agora.", true],
        ["Aguardo sua confirmação.", false],
        ["", false],
    ])("reads a promise to act: %j", (text, expected) => {
        expect(promisedToAct(text)).toBe(expected);
    });

    test("rebuilds the system prompt after an overflow compaction", async () => {
        let calls = 0;
        const systems: SystemPrompt[] = [];
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                calls++;
                systems.push(opts.system);
                if (calls === 1) throw Object.assign(new Error("prompt is too long"), { status: 400 });
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const refreshed: SystemPrompt = { stable: "sys2", volatile: "condensed" };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
            compact: () => true,
            refreshSystem: () => refreshed,
        });

        expect(calls).toBe(2);
        expect(systems[0]).toBe(SYSTEM);
        // The retry must carry the journal the compaction just wrote into the volatile half.
        expect(systems[1]).toBe(refreshed);
    });

    test("a turn that ended short is reported where the console shows it", async () => {
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        const debug = rs.spyOn(console, "debug").mockImplementation(() => {});
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield {
                    type: "usage",
                    usage: {
                        inputTokens: 5,
                        outputTokens: 128000,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                    },
                };
                yield { type: "done", stopReason: "max_tokens" };
            },
        };

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // Chrome filters `debug` out as verbose, so the line that explains a missing reply is a
        // warning: the numbers in it are what tells an endpoint cap from the app's own.
        expect(warn.mock.calls[0][0]).toContain("output=128000");
        expect(warn.mock.calls[0][0]).toContain("stop=max_tokens");
        expect(debug.mock.calls.some((c) => String(c[0]).includes("tokens:"))).toBe(false);
        rs.restoreAllMocks();
    });

    test("a turn that simply ended says nothing extra", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const deltas: string[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [],
            tools: [],
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // An empty answer is the panel's to report; only a stop that *was* a limit is news here.
        expect(deltas).toEqual([]);
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
            callbacks: {
                onTextDelta: (t) => deltas.push(t),
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
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
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
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
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(messages).toEqual([
            { role: "assistant", content: "answer", toolCalls: undefined, thinking: [block] },
        ]);
    });

    test("replays the turn in flight's thinking while its tool loop is open", async () => {
        const block = { type: "thinking" as const, thinking: "hmm", signature: "sig" };
        let resent: unknown;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    resent = opts.messages
                        .filter((m) => m.role === "assistant")
                        .map((m) => (m as { thinking?: unknown }).thinking);
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "thinking", block };
                yield { type: "tool_call", id: "t1", name: "probe", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "probe",
                description: "",
                parameters: { type: "object" },
                handler: async () => "ok",
            },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages: [{ role: "user", content: "go" }],
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // The block must reach the API with the tool_use it belongs to, in the same turn.
        expect(resent).toEqual([[block]]);
    });

    test("sends a new turn without the previous turns' thinking", async () => {
        const block = { type: "thinking" as const, thinking: "x".repeat(200), signature: "sig" };
        let resent: unknown = "not re-sent";
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                resent = opts.messages
                    .filter((m) => m.role === "assistant")
                    .map((m) => (m as { thinking?: unknown }).thinking);
                yield { type: "text", text: "second" };
                yield { type: "done", stopReason: "end_turn" };
            },
        };
        const messages: ChatMessage[] = [
            { role: "user", content: "first" },
            { role: "assistant", content: "done", thinking: [block] },
            { role: "user", content: "second" },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools: [],
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // Reasoning costs input like anything else, and the API needs none of it once the loop
        // that produced it has closed.
        expect(resent).toEqual([undefined]);
        expect(messages[1]).toEqual({
            role: "assistant",
            content: "done",
            toolCalls: undefined,
            thinking: undefined,
        });
    });

    test("keeps image bytes out of a tool result", async () => {
        const body = "A".repeat(400_000);
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: "t1", name: "echo_texture", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "echo_texture",
                description: "",
                parameters: { type: "object" },
                handler: async () => JSON.stringify({ texture: `data:image/png;base64,${body}` }),
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // A result is history every later request replays, and base64 in it is text: 400k
        // characters measured some 300k tokens. The bytes stay in the document.
        const content = (messages.find((m) => m.role === "tool") as { content: string }).content;
        expect(content).not.toContain(body);
        expect(content).toContain("data:image/png;base64,<293 KB omitted");
    });

    test("keeps image bytes out of a tool error", async () => {
        const body = "A".repeat(400_000);
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: "t1", name: "boom_texture", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "boom_texture",
                description: "",
                parameters: { type: "object" },
                // Coercion errors quote the rejected value in full (`describe` stringifies it),
                // so failing on an image argument echoes its whole data URL into the message.
                handler: async () => {
                    throw new Error(`invalid texture: {"texture":"data:image/png;base64,${body}"}`);
                },
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // The error is replayed with the history exactly like a result, so the same redaction
        // covers it — and the message around the bytes survives for the model to read.
        const content = (messages.find((m) => m.role === "tool") as { content: string }).content;
        const parsed = JSON.parse(content) as { error: string };
        expect(parsed.error).not.toContain(body);
        expect(parsed.error).toContain("data:image/png;base64,<293 KB omitted");
        expect(parsed.error).toContain("invalid texture:");
    });

    test("leaves a data URL too small to be an image alone", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                if (opts.messages.some((m) => m.role === "tool")) {
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: "t1", name: "swatch", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tiny = "data:image/png;base64,AAAA";
        const tools: Tool[] = [
            {
                name: "swatch",
                description: "",
                parameters: { type: "object" },
                handler: async () => JSON.stringify({ texture: tiny }),
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect((messages.find((m) => m.role === "tool") as { content: string }).content).toContain(tiny);
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
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
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
                callbacks: {
                    onTextDelta: () => {},
                    onToolCall: () => {},
                    onThinkingDelta: () => {},
                    onUsage: () => {},
                },
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
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
            signal: controller.signal,
        });

        expect(received).toBe(controller.signal);
    });

    test("keeps only the newest tool result's images while a run accumulates them", async () => {
        const image = (n: number) => [{ mediaType: "image/jpeg", data: `img${n}` }];
        let resentImages: unknown = "not re-sent";
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                const toolMessages = opts.messages.filter((m) => m.role === "tool");
                if (toolMessages.length >= 2) {
                    // The resent history must not carry the first screenshot's base64 anymore.
                    resentImages = toolMessages[0].images;
                    yield { type: "text", text: "done" };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: `t${toolMessages.length}`, name: "shot", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        let shots = 0;
        const tools: Tool[] = [
            {
                name: "shot",
                description: "",
                parameters: { type: "object" },
                handler: async () => ({ content: "{}", images: image(shots++) }),
            },
        ];
        const messages: ChatMessage[] = [];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        expect(resentImages).toBeUndefined();
        const toolMessages = messages.filter((m) => m.role === "tool");
        expect(toolMessages.length).toBe(2);
        expect(toolMessages[0].images).toBeUndefined();
        expect(toolMessages[1].images).toEqual(image(1));
    });

    test("keeps the user's own images while the run takes screenshots", async () => {
        const older = [{ mediaType: "image/png", data: "the user's first picture" }];
        const newer = [{ mediaType: "image/png", data: "the user's second picture" }];
        const shot = (n: number) => [{ mediaType: "image/jpeg", data: `shot${n}` }];
        let shots = 0;
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                const toolMessages = opts.messages.filter((m) => m.role === "tool");
                if (toolMessages.length >= 2) {
                    yield { type: "text", text: "done" };
                    yield { type: "done", stopReason: "end_turn" };
                    return;
                }
                yield { type: "tool_call", id: `t${toolMessages.length}`, name: "shot", arguments: "{}" };
                yield { type: "done", stopReason: "tool_use" };
            },
        };
        const tools: Tool[] = [
            {
                name: "shot",
                description: "",
                parameters: { type: "object" },
                handler: async () => ({ content: "{}", images: shot(shots++) }),
            },
        ];
        // A picture the user gave a turn ago, and one they gave for this turn.
        const messages: ChatMessage[] = [
            { role: "user", content: "make it look like this", images: older },
            { role: "assistant", content: "done" },
            { role: "user", content: "and now like this", images: newer },
        ];

        await runAgent({
            config: { provider: "anthropic", apiKey: "k", model: "claude-opus-5" },
            system: SYSTEM,
            messages,
            tools,
            callbacks: {
                onTextDelta: () => {},
                onToolCall: () => {},
                onThinkingDelta: () => {},
                onUsage: () => {},
            },
            provider,
        });

        // Every image the user gave stays; a screenshot is superseded by the next one taken.
        const users = messages.filter((m) => m.role === "user");
        expect(users[0].images).toEqual(older);
        expect(users[1].images).toEqual(newer);
        const toolMessages = messages.filter((m) => m.role === "tool");
        expect(toolMessages[0].images).toBeUndefined();
        expect(toolMessages[1].images).toEqual(shot(1));
    });
});
