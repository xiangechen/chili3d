// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    loadSampleSitePicks,
    parseSampleSitePicks,
    SAMPLE_SITE_PATH,
    type SampleSiteParseResult,
} from "../src/sampleSite";

function expectFailure(result: SampleSiteParseResult): SampleSiteParseResult & { ok: false } {
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the sample site to be rejected.");
    return result;
}

describe("sample-site pick loader", () => {
    test("loads all five picks from the canonical sample-site JSON", () => {
        const result = loadSampleSitePicks();

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected the bundled sample site to be valid.");

        expect(SAMPLE_SITE_PATH).toBe("public/sample-site/sample-site.json");
        expect(result.picks.map((pick) => pick.label)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
        expect(result.picks.map((pick) => pick.loadT)).toEqual([2.0, 1.5, 2.6, 4.2, 1.8]);

        // from_xy -> supply, to_xy -> drop.
        expect(result.picks[0].supply).toEqual({ x: 26, y: 5.5 });
        expect(result.picks[0].drop).toEqual({ x: 62, y: 39 });
        expect(result.picks[1].supply).toEqual({ x: 83, y: 13 });
        expect(result.picks[1].drop).toEqual({ x: 28, y: 23 });
        expect(result.picks[2].supply).toEqual({ x: 6, y: 45 });
        expect(result.picks[2].drop).toEqual({ x: 64, y: 41 });
        expect(result.picks[3].supply).toEqual({ x: 33, y: 8 });
        expect(result.picks[3].drop).toEqual({ x: 38, y: 25 });
        expect(result.picks[4].supply).toEqual({ x: 85, y: 20 });
        expect(result.picks[4].drop).toEqual({ x: 68, y: 66 });

        expect(result.picks.every((pick) => pick.radiusM === undefined)).toBe(true);
    });

    test("accepts a minimal valid pick and maps it to supply/drop/loadT", () => {
        const result = parseSampleSitePicks({
            picks: [{ id: "P9", load_t: 3.25, from_xy: [1, 2], to_xy: [3, 4] }],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("Expected the pick to be valid.");
        expect(result.picks).toEqual([
            {
                label: "P9",
                loadT: 3.25,
                supply: { x: 1, y: 2 },
                drop: { x: 3, y: 4 },
            },
        ]);
    });

    test.each([
        { name: "a non-object root", data: [], path: "$" },
        { name: "a missing picks array", data: {}, path: "picks" },
        { name: "an empty picks array", data: { picks: [] }, path: "picks" },
    ])("rejects $name", ({ data, path }) => {
        const result = expectFailure(parseSampleSitePicks(data));

        expect(result.issues.map((issue) => issue.path)).toContain(path);
    });

    test.each([
        { name: "zero", load: 0 },
        { name: "negative", load: -2 },
        { name: "a string", load: "2.0" },
    ])("rejects a $name load", ({ load }) => {
        const result = expectFailure(
            parseSampleSitePicks({
                picks: [{ id: "P1", load_t: load, from_xy: [0, 0], to_xy: [10, 10] }],
            }),
        );

        expect(result.issues.map((issue) => issue.path)).toContain("picks[0].load_t");
    });

    test("rejects a malformed coordinate pair and keeps the JSON path", () => {
        const result = expectFailure(
            parseSampleSitePicks({
                picks: [{ id: "P1", load_t: 1, from_xy: [0], to_xy: [10, 10] }],
            }),
        );

        expect(result.issues.map((issue) => issue.path)).toContain("picks[0].from_xy");
    });

    test.each([
        { name: "a string x", from: ["0", 0], path: "picks[0].from_xy[0]" },
        { name: "an infinite y", from: [0, Number.POSITIVE_INFINITY], path: "picks[0].from_xy[1]" },
        { name: "a NaN drop x", to: [Number.NaN, 0], path: "picks[0].to_xy[0]" },
    ])("rejects $name", ({ from, to, path }) => {
        const result = expectFailure(
            parseSampleSitePicks({
                picks: [{ id: "P1", load_t: 1, from_xy: from ?? [0, 0], to_xy: to ?? [10, 10] }],
            }),
        );

        expect(result.issues.map((issue) => issue.path)).toContain(path);
    });

    test("rejects a missing pick id", () => {
        const result = expectFailure(
            parseSampleSitePicks({
                picks: [{ load_t: 1, from_xy: [0, 0], to_xy: [10, 10] }],
            }),
        );

        expect(result.issues.map((issue) => issue.path)).toContain("picks[0].id");
    });

    test("rejects duplicate pick ids", () => {
        const result = expectFailure(
            parseSampleSitePicks({
                picks: [
                    { id: "P1", load_t: 1, from_xy: [0, 0], to_xy: [10, 10] },
                    { id: "P1", load_t: 2, from_xy: [1, 1], to_xy: [11, 11] },
                ],
            }),
        );

        expect(result.issues.map((issue) => issue.path)).toContain("picks[1].id");
    });
});
