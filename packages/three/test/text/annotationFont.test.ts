// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Contour2D, type FontOutline, Result } from "@chili3d/core";
import { AnnotationFont } from "../../src/text/annotationFont";

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function fakeOutline(): FontOutline {
    const square: Contour2D = {
        start: { x: 0, y: 0 },
        segments: [
            { kind: "line", to: { x: 0, y: 700 } },
            { kind: "line", to: { x: 500, y: 700 } },
            { kind: "line", to: { x: 500, y: 0 } },
            { kind: "line", to: { x: 0, y: 0 } },
        ],
    };
    return {
        familyName: "fake",
        unitsPerEm: 1000,
        missingAdvance: 250,
        glyph: () => ({ advance: 500, contours: [structuredClone(square)] }),
    };
}

describe("AnnotationFont", () => {
    test("loads once, notifies listeners and serves em-sized glyphs", async () => {
        const load = rs.fn(() => Promise.resolve(Result.ok(fakeOutline())));
        const font = new AnnotationFont(load);
        const listener = rs.fn();
        font.onLoaded(listener);

        font.ensureLoaded();
        font.ensureLoaded();
        await flush();
        await flush();

        expect(load).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(font.outline?.familyName).toBe("fake");

        const glyph = font.glyph(65);
        expect(glyph?.advance).toBeCloseTo(0.5);
        expect(glyph?.triangles.length).toBeGreaterThan(0);
        expect(font.glyph(65)).toBe(glyph);
        expect(font.missingAdvance).toBeCloseTo(0.25);
    });

    test("retries a failed load while listeners wait", async () => {
        rs.useFakeTimers();
        try {
            let calls = 0;
            const font = new AnnotationFont(() =>
                Promise.resolve(++calls === 1 ? Result.err("offline") : Result.ok(fakeOutline())),
            );
            const listener = rs.fn();
            font.onLoaded(listener);
            const warn = rs.spyOn(console, "warn").mockImplementation(() => {});

            font.ensureLoaded();
            await flush();
            expect(font.outline).toBeUndefined();
            expect(listener).not.toHaveBeenCalled();

            await rs.advanceTimersByTimeAsync(5000);
            expect(font.outline?.familyName).toBe("fake");
            expect(listener).toHaveBeenCalledTimes(1);
            expect(calls).toBe(2);
            warn.mockRestore();
        } finally {
            rs.useRealTimers();
        }
    });

    test("gives up after three retries", async () => {
        rs.useFakeTimers();
        try {
            const load = rs.fn(() => Promise.resolve(Result.err("offline")));
            const font = new AnnotationFont(load);
            font.onLoaded(rs.fn());
            const warn = rs.spyOn(console, "warn").mockImplementation(() => {});

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000);

            expect(load).toHaveBeenCalledTimes(4);
            expect(font.outline).toBeUndefined();
            warn.mockRestore();
        } finally {
            rs.useRealTimers();
        }
    });

    test("does not retry when no annotation waits for the font", async () => {
        rs.useFakeTimers();
        try {
            const load = rs.fn(() => Promise.resolve(Result.err("offline")));
            const font = new AnnotationFont(load);
            const warn = rs.spyOn(console, "warn").mockImplementation(() => {});

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000);

            expect(load).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        } finally {
            rs.useRealTimers();
        }
    });
});
