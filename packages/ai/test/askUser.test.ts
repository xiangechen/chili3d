// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { type AskRequest, buildAskUserTool, setAskHandler } from "../src/tools/askUser";

describe("ask_user", () => {
    afterEach(() => setAskHandler(undefined));

    test("tells the model when no panel is open to answer", async () => {
        setAskHandler(undefined);

        const result = await buildAskUserTool().handler({ question: "which face?" });

        expect(JSON.parse(String(result))).toEqual({
            error: "no chat panel is open to answer this question",
        });
    });

    test("refuses a question that is missing or blank", () => {
        setAskHandler(async () => "unused");
        const tool = buildAskUserTool();

        expect(() => tool.handler({})).toThrow("question must be a non-empty string");
        expect(() => tool.handler({ question: "   " })).toThrow("question must be a non-empty string");
    });

    test("refuses options that are not strings", () => {
        setAskHandler(async () => "unused");

        expect(() => buildAskUserTool().handler({ question: "which?", options: [6, 8] })).toThrow(
            "options must be an array of strings",
        );
    });

    test("hands the question to the panel and returns the answer verbatim", async () => {
        const ask = rs.fn(async (_request: AskRequest, _signal?: AbortSignal) => "8mm");
        setAskHandler(ask);
        const signal = new AbortController().signal;

        const result = await buildAskUserTool().handler(
            { question: "how big?", options: ["6mm", "8mm"] },
            signal,
        );

        expect(result).toBe("8mm");
        expect(ask.mock.calls[0]).toEqual([{ question: "how big?", options: ["6mm", "8mm"] }, signal]);
    });
});
