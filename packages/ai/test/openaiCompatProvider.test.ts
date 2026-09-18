// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { convertChunk, toMessages } from "../src/llm/completions";
import type { ChatMessage, StreamEvent, ToolCallBuffer } from "../src/llm/types";

const IMAGE = { mediaType: "image/png", data: "AAA" };

function chunk(delta: unknown, finishReason: string | null = null) {
    return { choices: [{ delta, finish_reason: finishReason }] } as any;
}

describe("openaiCompat toMessages", () => {
    test("forwards tool result images in a follow-up user message", () => {
        const messages: ChatMessage[] = [
            { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "shot", arguments: "{}" }] },
            { role: "tool", toolCallId: "c1", name: "shot", content: "captured", images: [IMAGE] },
        ];

        const out = toMessages({ stable: "sys", volatile: "" }, messages);

        expect(out[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "captured" });
        expect(out[3]).toEqual({
            role: "user",
            content: [
                { type: "text", text: "Images from the tool result above:" },
                { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
            ],
        });
    });

    test("flushes pending images only after the tool-message run ends", () => {
        const messages: ChatMessage[] = [
            { role: "tool", toolCallId: "c1", name: "a", content: "one", images: [IMAGE] },
            { role: "tool", toolCallId: "c2", name: "b", content: "two" },
            { role: "user", content: "next" },
        ];

        const out = toMessages({ stable: "sys", volatile: "" }, messages);

        expect(out.map((m) => m["role"])).toEqual(["system", "tool", "tool", "user", "user"]);
        expect(out[4]).toEqual({ role: "user", content: "next" });
    });

    test("sends the stable half before the per-run snapshot", () => {
        // Prefix caching on OpenAI-compatible endpoints is automatic but still a prefix match:
        // the per-run snapshot has to come last or nothing before it is reusable.
        const out = toMessages({ stable: "STABLE", volatile: "SNAPSHOT" }, []);

        expect(out[0]).toEqual({ role: "system", content: "STABLE\n\nSNAPSHOT" });
    });
});

describe("openaiCompat convertChunk", () => {
    test("flushes tool calls ordered by index and defaults empty arguments", () => {
        const toolBuf: ToolCallBuffer = new Map();
        const events: StreamEvent[] = [];
        const feed = (c: ReturnType<typeof chunk>) => events.push(...convertChunk(c, toolBuf));

        feed(chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "f2", arguments: "" } }] }));
        feed(chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "f1", arguments: "" } }] }));
        feed(chunk({}, "tool_calls"));

        expect(events).toEqual([
            { type: "tool_call", id: "a", name: "f1", arguments: "{}" },
            { type: "tool_call", id: "b", name: "f2", arguments: "{}" },
            { type: "done", stopReason: "tool_calls" },
        ]);
    });
});
