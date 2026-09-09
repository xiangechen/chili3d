// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { convertEvent, type StreamState, toMessages } from "../src/llm/anthropic";
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
