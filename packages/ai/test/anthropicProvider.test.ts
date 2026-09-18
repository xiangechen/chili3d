// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    convertEvent,
    markConversationTail,
    type StreamState,
    systemBlocks,
    toMessages,
} from "../src/llm/anthropic";
import type { ChatMessage, StreamEvent } from "../src/llm/types";

type RawEvent = Parameters<typeof convertEvent>[0];

function runEvents(rawEvents: RawEvent[]): StreamEvent[] {
    const state: StreamState = { toolBuf: new Map(), thinkingBuf: new Map() };
    const out: StreamEvent[] = [];
    for (const raw of rawEvents) {
        out.push(...convertEvent(raw, state));
    }
    return out;
}

describe("anthropic systemBlocks", () => {
    const CACHED = { type: "ephemeral", ttl: "1h" };

    test("marks the stable half so tools and prompt cache together, and leaves the snapshot out", () => {
        const blocks = systemBlocks({ stable: "STABLE", volatile: "SNAPSHOT" });

        expect(blocks).toEqual([
            { type: "text", text: "STABLE", cache_control: CACHED },
            { type: "text", text: "SNAPSHOT" },
        ]);
    });

    test("sends one block when there is no snapshot (the API rejects an empty text block)", () => {
        expect(systemBlocks({ stable: "STABLE", volatile: "" })).toEqual([
            { type: "text", text: "STABLE", cache_control: CACHED },
        ]);
    });
});

describe("anthropic markConversationTail", () => {
    const TAIL = { type: "ephemeral" };

    test("promotes a plain string tail so the breakpoint has a block to sit on", () => {
        const messages = toMessages([{ role: "user", content: "hi" }]);

        markConversationTail(messages);

        expect(messages[0]).toEqual({
            role: "user",
            content: [{ type: "text", text: "hi", cache_control: TAIL }],
        });
    });

    test("marks only the last tool result, leaving the earlier ones intact", () => {
        const messages = toMessages([
            { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "a", arguments: "{}" }] },
            { role: "tool", toolCallId: "c1", name: "a", content: "one" },
            { role: "tool", toolCallId: "c2", name: "b", content: "two" },
        ]);

        markConversationTail(messages);

        expect(messages[1]).toEqual({
            role: "user",
            content: [
                { type: "tool_result", tool_use_id: "c1", content: "one" },
                { type: "tool_result", tool_use_id: "c2", content: "two", cache_control: TAIL },
            ],
        });
    });

    test("leaves an empty tail alone — an empty text block would be rejected", () => {
        const messages = toMessages([{ role: "user", content: "" }]);

        markConversationTail(messages);

        expect(messages[0]).toEqual({ role: "user", content: "" });
    });
});

describe("anthropic convertEvent", () => {
    test("captures a thinking block with its signature", () => {
        const events = runEvents([
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me " } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think" } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig1" } },
            { type: "content_block_stop", index: 0 },
        ]);

        expect(events).toEqual([
            { type: "thinking", block: { type: "thinking", thinking: "let me think", signature: "sig1" } },
        ]);
    });

    test("passes redacted_thinking blocks through at block start", () => {
        const events = runEvents([
            {
                type: "content_block_start",
                index: 0,
                content_block: { type: "redacted_thinking", data: "enc" },
            },
        ]);

        expect(events).toEqual([{ type: "thinking", block: { type: "redacted_thinking", data: "enc" } }]);
    });

    test("flushes a tool call with no input_json_delta as an empty object", () => {
        const events = runEvents([
            {
                type: "content_block_start",
                index: 0,
                content_block: { type: "tool_use", id: "t1", name: "my_tool" },
            },
            { type: "content_block_stop", index: 0 },
        ]);

        expect(events).toEqual([{ type: "tool_call", id: "t1", name: "my_tool", arguments: "{}" }]);
        expect(JSON.parse((events[0] as { arguments: string }).arguments)).toEqual({});
    });

    test("takes the stop reason from message_delta instead of hardcoding end_turn", () => {
        const events = runEvents([
            { type: "message_delta", delta: { stop_reason: "max_tokens" } },
            { type: "message_stop" },
        ]);

        expect(events).toEqual([{ type: "done", stopReason: "max_tokens" }]);
    });

    test("reports the cache counters and the final output count as one usage event", () => {
        const events = runEvents([
            {
                type: "message_start",
                message: {
                    usage: {
                        input_tokens: 120,
                        output_tokens: 1,
                        cache_read_input_tokens: 9000,
                        cache_creation_input_tokens: 0,
                    },
                },
            },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } },
        ]);

        expect(events).toEqual([
            {
                type: "usage",
                usage: {
                    inputTokens: 120,
                    outputTokens: 42,
                    cacheReadTokens: 9000,
                    cacheCreationTokens: 0,
                },
            },
        ]);
    });

    test("waits for message_delta before reporting usage, so the output count is final", () => {
        const events = runEvents([
            {
                type: "message_start",
                message: { usage: { input_tokens: 120, cache_read_input_tokens: 9000 } },
            },
        ]);

        expect(events).toEqual([]);
    });
});

describe("anthropic toMessages", () => {
    test("replays thinking blocks first and parses empty tool arguments", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "hi" },
            {
                role: "assistant",
                content: "",
                thinking: [{ type: "thinking", thinking: "t", signature: "s" }],
                toolCalls: [{ id: "t1", name: "my_tool", arguments: "" }],
            },
            { role: "tool", toolCallId: "t1", name: "my_tool", content: "ok" },
        ];

        const out = toMessages(messages);

        expect(out[1]).toEqual({
            role: "assistant",
            content: [
                { type: "thinking", thinking: "t", signature: "s" },
                { type: "tool_use", id: "t1", name: "my_tool", input: {} },
            ],
        });
        expect(out[2]).toEqual({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        });
    });

    test("omits the empty text block next to images", () => {
        const out = toMessages([
            { role: "user", content: "", images: [{ mediaType: "image/png", data: "AAA" }] },
        ]);

        expect(out[0]).toEqual({
            role: "user",
            content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }],
        });
    });
});
