// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { convertEvent, ResponsesProvider } from "../src/llm/responses";
import type { StreamEvent } from "../src/llm/types";

const providerMock = rs.hoisted(() => {
    // `unknown` rather than the shape of the empty stream the default yields, so a test can feed
    // the events it wants to watch go past.
    const create = rs.fn(
        async (_params: { reasoning?: unknown }): Promise<AsyncGenerator<unknown>> =>
            (async function* () {})(),
    );
    return { create };
});

rs.mock("openai", () => ({
    default: class {
        responses = { create: providerMock.create };
    },
}));

const SYSTEM = { stable: "sys", volatile: "" };

function run(events: unknown[]): StreamEvent[] {
    const state = { toolArgs: new Map<string, string>(), reasoned: false, texted: false, calls: 0 };
    const out: StreamEvent[] = [];
    for (const event of events) out.push(...convertEvent(event as never, state));
    return out;
}

describe("responses convertEvent", () => {
    test("streams a reasoning summary as thinking deltas, ahead of the answer", () => {
        const events = run([
            { type: "response.reasoning_summary_part.added", item_id: "r1" },
            { type: "response.reasoning_summary_text.delta", item_id: "r1", delta: "weighing " },
            { type: "response.reasoning_summary_text.delta", item_id: "r1", delta: "options" },
            { type: "response.output_text.delta", delta: "Done." },
        ]);

        // Deltas only, never a `thinking` block: that event carries a signature for the replay,
        // and OpenAI's reasoning has none — so none of this reaches the conversation sent back.
        expect(events).toEqual([
            { type: "thinking_delta", text: "weighing " },
            { type: "thinking_delta", text: "options" },
            { type: "text", text: "Done." },
        ]);
    });

    test("splits cached input out of the reported usage", () => {
        const events = run([
            {
                type: "response.completed",
                response: {
                    status: "completed",
                    usage: {
                        input_tokens: 1000,
                        output_tokens: 20,
                        input_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
                    },
                },
            },
        ]);

        // `input_tokens` is the whole prompt, cached part included; the three fields have to stay
        // disjoint or `contextTokens` counts the cached half twice and the meter reads double.
        expect(events).toEqual([
            {
                type: "usage",
                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    cacheReadTokens: 800,
                    cacheCreationTokens: 100,
                },
            },
            { type: "done", stopReason: "completed" },
        ]);
    });

    test("falls back to the finished reasoning item when no deltas streamed", () => {
        const events = run([
            {
                type: "response.output_item.done",
                item: {
                    type: "reasoning",
                    id: "r1",
                    summary: [{ type: "summary_text", text: "weighed the options" }],
                },
            },
            { type: "response.output_text.delta", delta: "Done." },
        ]);

        // The SDK points at the finished item as the reliable source while streaming, so a backend
        // that sends no deltas still gets its reasoning shown.
        expect(events).toEqual([
            { type: "thinking_delta", text: "weighed the options" },
            { type: "text", text: "Done." },
        ]);
    });

    test("does not repeat reasoning that already streamed", () => {
        const events = run([
            { type: "response.reasoning_summary_text.delta", delta: "weighing " },
            {
                type: "response.output_item.done",
                item: {
                    type: "reasoning",
                    id: "r1",
                    summary: [{ type: "summary_text", text: "weighing " }],
                },
            },
        ]);

        expect(events).toEqual([{ type: "thinking_delta", text: "weighing " }]);
    });

    test("shows nothing rather than ciphertext when the reasoning came back encrypted", () => {
        const events = run([
            {
                type: "response.output_item.done",
                item: {
                    type: "reasoning",
                    id: "r1",
                    summary: [],
                    encrypted_content: "gAAAAA-blob",
                },
            },
        ]);

        // Documented dead end: some backends return reasoning as encrypted content only. It must
        // never be handed to the transcript as if it were readable text.
        expect(events).toEqual([]);
    });

    test("leaves a stream that carries no reasoning alone", () => {
        const events = run([{ type: "response.output_text.delta", delta: "hi" }]);

        expect(events).toEqual([{ type: "text", text: "hi" }]);
    });

    test("joins function call arguments from both the deltas and the finished item", () => {
        const events = run([
            { type: "response.function_call_arguments.delta", item_id: "i1", delta: '{"a"' },
            { type: "response.function_call_arguments.delta", item_id: "i1", delta: ":1}" },
            {
                type: "response.output_item.done",
                item: { type: "function_call", call_id: "c1", name: "f", id: "i1", arguments: "" },
            },
        ]);

        expect(events).toEqual([{ type: "tool_call", id: "c1", name: "f", arguments: '{"a":1}' }]);
    });
});

describe("responses request", () => {
    beforeEach(() => {
        providerMock.create.mock.calls.length = 0;
    });

    test("asks for a reasoning summary, without which no reasoning events are ever sent", async () => {
        const provider = new ResponsesProvider({ provider: "responses", apiKey: "k", model: "m" });
        const drained: StreamEvent[] = [];
        for await (const event of provider.streamChat({
            model: "m",
            system: SYSTEM,
            messages: [],
            tools: [],
        })) {
            drained.push(event);
        }

        // Not a tuning knob: omit it and the stream simply never carries reasoning, which is a
        // silent regression rather than an error.
        expect(drained).toEqual([]);
        expect(providerMock.create.mock.calls[0][0].reasoning).toEqual({ summary: "auto" });
    });

    test("reports only the stream events it does not know, once each", async () => {
        const provider = new ResponsesProvider({ provider: "responses", apiKey: "k", model: "m" });
        providerMock.create.mockImplementationOnce(async () =>
            (async function* () {
                // A reasoning turn as it actually arrives: the framing around the content is
                // what a `reasoning_summary_text.delta` is wrapped in, and logging four of
                // those per turn would bury the one event this is here to surface.
                for (const event of [
                    { type: "response.queued" },
                    { type: "response.created" },
                    { type: "response.in_progress" },
                    { type: "response.reasoning_summary_part.added" },
                    { type: "response.reasoning_summary_text.delta", delta: "weighing " },
                    { type: "response.reasoning_summary_text.done" },
                    { type: "response.reasoning_summary_part.done" },
                    { type: "response.content_part.added" },
                    { type: "response.output_text.delta", delta: "Done." },
                    { type: "response.output_text.done" },
                    { type: "response.content_part.done" },
                    { type: "response.function_call_arguments.done" },
                    { type: "response.completed", response: { status: "completed" } },
                    // Never seen before, twice: exactly one line, not one per occurrence.
                    { type: "response.something_new", n: 1 },
                    { type: "response.something_new", n: 2 },
                ]) {
                    yield event;
                }
            })(),
        );

        const logged: string[] = [];
        const original = console.debug;
        console.debug = (...args: unknown[]) => void logged.push(args.join(" "));
        try {
            for await (const _event of provider.streamChat({
                model: "m",
                system: SYSTEM,
                messages: [],
                tools: [],
            })) {
                void _event;
            }
        } finally {
            console.debug = original;
        }

        const unknown = logged.filter((line) => line.includes("unhandled stream event"));
        expect(unknown).toEqual(['[ai] responses: unhandled stream event "response.something_new"']);
    });
});
describe("a response that stopped short", () => {
    test("an incomplete response ends the turn and names the reason", () => {
        const events = run([
            {
                type: "response.incomplete",
                response: {
                    status: "incomplete",
                    incomplete_details: { reason: "max_output_tokens" },
                    usage: { input_tokens: 10, output_tokens: 900 },
                },
            },
        ]);

        // Not an error and not a `completed`: the agent reads this status as the truncation it is
        // and says so, where leaving the event unhandled ended the turn silently.
        expect(events).toContainEqual({ type: "done", stopReason: "incomplete" });
        expect(events.some((e) => e.type === "usage")).toBe(true);
    });

    test("a failed response is an error, not an empty answer", () => {
        expect(() =>
            run([{ type: "response.failed", response: { status: "failed", error: { message: "boom" } } }]),
        ).toThrow("boom");
    });

    test("an answer only the finished item carries is not lost", () => {
        // A backend that streams finished items instead of deltas used to leave the turn looking
        // like a model with nothing to say.
        const events = run([
            {
                type: "response.output_item.done",
                item: { type: "message", content: [{ type: "output_text", text: "Done." }] },
            },
        ]);

        expect(events).toEqual([{ type: "text", text: "Done." }]);
    });

    test("that item does not repeat an answer that streamed as deltas", () => {
        const events = run([
            { type: "response.output_text.delta", delta: "Do" },
            { type: "response.output_text.delta", delta: "ne." },
            {
                type: "response.output_item.done",
                item: { type: "message", content: [{ type: "output_text", text: "Done." }] },
            },
        ]);

        expect(events).toEqual([
            { type: "text", text: "Do" },
            { type: "text", text: "ne." },
        ]);
    });
});
