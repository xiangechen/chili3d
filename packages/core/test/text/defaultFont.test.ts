// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { PubSub } from "../../src/foundation/pubsub";
import { Result } from "../../src/foundation/result";
import { DefaultFontService } from "../../src/text/defaultFont";
import { DefaultFont } from "../../src/text/fontCatalog";
import { type Contour2D, type FontOutline, forgetOutline, rememberOutline } from "../../src/text/fontOutline";

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

describe("DefaultFontService", () => {
    // the outline lives in the font cache, so a service that saw it once sees it always
    afterEach(() => forgetOutline(DefaultFont.family, DefaultFont.url));

    test("loads once, notifies listeners and serves em-sized glyphs", async () => {
        const load = rs.fn(() => Promise.resolve(Result.ok(fakeOutline())));
        const font = new DefaultFontService(load);
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

    test("lays a line out from the loaded font, centered on the origin", async () => {
        const font = new DefaultFontService(() => Promise.resolve(Result.ok(fakeOutline())));
        expect(font.layout("A").length).toBe(0);

        font.ensureLoaded();
        await flush();
        await flush();

        // one 0.5-em advance glyph, 0.5 em wide, centered: its ink spans [-0.25, 0.25]
        const xs = [...font.layout("A")].filter((_, i) => i % 2 === 0);
        expect(Math.min(...xs)).toBeCloseTo(-0.25, 6);
        expect(Math.max(...xs)).toBeCloseTo(0.25, 6);
    });

    test("an outline remembered by anyone else is available without a fetch", () => {
        rememberOutline(DefaultFont.family, DefaultFont.url, fakeOutline());
        const load = rs.fn(() => Promise.resolve(Result.err("should not be asked")));

        const font = new DefaultFontService(load);
        font.ensureLoaded();

        expect(font.outline?.familyName).toBe("fake");
        expect(load).not.toHaveBeenCalled();
    });

    test("retries a failed load while listeners wait", async () => {
        rs.useFakeTimers();
        try {
            let calls = 0;
            const font = new DefaultFontService(() =>
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

    test("rotates through the font mirrors as retries fail", async () => {
        rs.useFakeTimers();
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const load = rs.fn((_url: string) => Promise.resolve(Result.err("offline")));
            const font = new DefaultFontService(load);
            font.onLoaded(rs.fn());

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000);

            const urls = load.mock.calls.map((call) => call[0]);
            expect(urls).toEqual([
                DefaultFont.url,
                DefaultFont.url.replace("cdn.jsdelivr.net", "fastly.jsdelivr.net"),
                DefaultFont.url.replace("cdn.jsdelivr.net", "gcore.jsdelivr.net"),
                DefaultFont.url,
            ]);
        } finally {
            warn.mockRestore();
            rs.useRealTimers();
        }
    });

    test("keeps retrying slowly in the background once the quick retries are spent", async () => {
        rs.useFakeTimers();
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const load = rs.fn((_url: string) => Promise.resolve(Result.err("offline")));
            const font = new DefaultFontService(load);
            font.onLoaded(rs.fn());

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000);
            expect(load).toHaveBeenCalledTimes(4);

            // the quick retries are spent: the wait goes on at a slower pace rather than giving up
            await rs.advanceTimersByTimeAsync(60000);
            expect(load).toHaveBeenCalledTimes(5);
            await rs.advanceTimersByTimeAsync(60000);
            expect(load).toHaveBeenCalledTimes(6);
            expect(font.outline).toBeUndefined();
        } finally {
            warn.mockRestore();
            rs.useRealTimers();
        }
    });

    test("toasts once when the quick retries are spent, then keeps quiet", async () => {
        rs.useFakeTimers();
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            const load = rs.fn((_url: string) => Promise.resolve(Result.err("offline")));
            const font = new DefaultFontService(load);
            font.onLoaded(rs.fn());

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000 + 60000 * 3);

            const toasts = pub.mock.calls.filter((call) => call[0] === "showToast");
            expect(toasts).toEqual([["showToast", "toast.text.defaultFontFailed"]]);
        } finally {
            pub.mockRestore();
            warn.mockRestore();
            rs.useRealTimers();
        }
    });

    test("a slow retry that succeeds loads the font and notifies the waiters", async () => {
        rs.useFakeTimers();
        const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
        try {
            let calls = 0;
            const font = new DefaultFontService((_url: string) =>
                Promise.resolve(++calls < 5 ? Result.err("offline") : Result.ok(fakeOutline())),
            );
            const listener = rs.fn();
            font.onLoaded(listener);

            font.ensureLoaded();
            await flush();
            await rs.advanceTimersByTimeAsync(20000);
            expect(font.outline).toBeUndefined();
            expect(listener).not.toHaveBeenCalled();

            await rs.advanceTimersByTimeAsync(60000);
            expect(font.outline?.familyName).toBe("fake");
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
            rs.useRealTimers();
        }
    });

    test("does not retry when nothing waits for the font", async () => {
        rs.useFakeTimers();
        try {
            const load = rs.fn(() => Promise.resolve(Result.err("offline")));
            const font = new DefaultFontService(load);
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
