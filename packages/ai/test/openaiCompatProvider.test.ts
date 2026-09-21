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
    test("reports usage from the trailing chunk, which carries no choices", () => {
        const toolBuf: ToolCallBuffer = new Map();
        const events = [
            ...convertChunk(chunk({ content: "hi" }), toolBuf),
            ...convertChunk(
                {
                    choices: [],
                    usage: {
                        prompt_tokens: 1000,
                        completion_tokens: 20,
                        prompt_tokens_details: { cached_tokens: 800 },
                    },
                } as never,
                toolBuf,
            ),
        ];

        // That last chunk is the one the `choices[0]` guard would otherwise skip, taking the only
        // copy of the numbers with it. `prompt_tokens` includes the cached part; the fields have to
        // come out disjoint or the context meter counts the cached half twice.
        expect(events).toEqual([
            { type: "text", text: "hi" },
            {
                type: "usage",
                usage: {
                    inputTokens: 200,
                    outputTokens: 20,
                    cacheReadTokens: 800,
                    cacheCreationTokens: 0,
                },
            },
        ]);
    });

    test("streams an extension reasoning_content field as thinking deltas", () => {
        const toolBuf: ToolCallBuffer = new Map();
        const events = [
            ...convertChunk(chunk({ reasoning_content: "weighing " }), toolBuf),
            ...convertChunk(chunk({ reasoning_content: "options" }), toolBuf),
            ...convertChunk(chunk({ content: "Done." }), toolBuf),
        ];

        // Reasoning leads the answer, and stays a display channel: no `thinking` block is emitted,
        // so the agent never carries it back in the conversation.
        expect(events).toEqual([
            { type: "thinking_delta", text: "weighing " },
            { type: "thinking_delta", text: "options" },
            { type: "text", text: "Done." },
        ]);
    });

    test("emits nothing extra for an endpoint that does not stream reasoning", () => {
        const toolBuf: ToolCallBuffer = new Map();
        const events = [...convertChunk(chunk({ content: "hi" }), toolBuf)];

        expect(events).toEqual([{ type: "text", text: "hi" }]);
    });

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
