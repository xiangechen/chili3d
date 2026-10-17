// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Standard hole presets: metric thread sizes M3–M20 with the dimensions a hole for each
 * needs, from the ISO tables:
 *
 * - `clearance` — ISO 273 clearance-hole diameters, all three classes: `close` (H12),
 *   `normal` (H13) and `loose` (H14), for a screw that simply passes through.
 * - `counterbore` — for an ISO 4762 socket-head cap screw: the diameter is the head's
 *   dk(max) + 1 mm of diametral clearance (the common shop convention for a normal fit —
 *   the standard fixes the HEAD, not the recess), the depth the head's nominal height k,
 *   which sits the head top flush with the surface.
 * - `countersink` — for an ISO 10642 flat countersunk head (90°): the diameter is the
 *   head's theoretical sharp-corner dk; the real head is truncated below it and so sits
 *   flush. M14 carries no countersink entry — the standard's M14 head size is not
 *   consistently tabulated across editions, so the presets simply skip the size there
 *   rather than invent one.
 *
 * A preset is a starting point, not a binding: picking one writes its NUMBERS into the
 * feature's own fields (the name is never stored — see `hole.ts`'s `setParameter`), so a
 * later edit to the table cannot silently retune existing holes, and the user tunes the
 * numbers from there. Non-ISO series (ANSI/Imperial) extend this table without a shape
 * change — one row per size, the optional entries naming what the style needs.
 */
export interface HoleStandardRow {
    /** The designation as the panel shows it, e.g. "M8". */
    readonly size: string;
    /** ISO 273 clearance-hole diameters: close / normal / loose. */
    readonly clearance: { readonly close: number; readonly normal: number; readonly loose: number };
    /** ISO 4762 socket head: counterbore diameter (dk + 1) and depth (k) — see the module doc. */
    readonly counterbore: { readonly diameter: number; readonly depth: number };
    /** ISO 10642 flat head: countersink diameter (theoretical dk) at 90°. Absent for M14. */
    readonly countersink?: { readonly diameter: number; readonly angle: number };
}

export const HOLE_STANDARDS: readonly HoleStandardRow[] = [
    {
        size: "M3",
        clearance: { close: 3.2, normal: 3.4, loose: 3.6 },
        counterbore: { diameter: 6.5, depth: 3 },
        countersink: { diameter: 6.72, angle: 90 },
    },
    {
        size: "M4",
        clearance: { close: 4.3, normal: 4.5, loose: 4.8 },
        counterbore: { diameter: 8, depth: 4 },
        countersink: { diameter: 8.96, angle: 90 },
    },
    {
        size: "M5",
        clearance: { close: 5.3, normal: 5.5, loose: 5.8 },
        counterbore: { diameter: 9.5, depth: 5 },
        countersink: { diameter: 11.2, angle: 90 },
    },
    {
        size: "M6",
        clearance: { close: 6.4, normal: 6.6, loose: 7.0 },
        counterbore: { diameter: 11, depth: 6 },
        countersink: { diameter: 13.44, angle: 90 },
    },
    {
        size: "M8",
        clearance: { close: 8.4, normal: 9.0, loose: 10.0 },
        counterbore: { diameter: 14, depth: 8 },
        countersink: { diameter: 17.92, angle: 90 },
    },
    {
        size: "M10",
        clearance: { close: 10.5, normal: 11.0, loose: 12.0 },
        counterbore: { diameter: 17, depth: 10 },
        countersink: { diameter: 22.4, angle: 90 },
    },
    {
        size: "M12",
        clearance: { close: 13.0, normal: 13.5, loose: 14.5 },
        counterbore: { diameter: 19, depth: 12 },
        countersink: { diameter: 26.88, angle: 90 },
    },
    {
        size: "M14",
        clearance: { close: 15.0, normal: 15.5, loose: 16.5 },
        counterbore: { diameter: 22, depth: 14 },
    },
    {
        size: "M16",
        clearance: { close: 17.0, normal: 17.5, loose: 18.5 },
        counterbore: { diameter: 25, depth: 16 },
        countersink: { diameter: 33.6, angle: 90 },
    },
    {
        size: "M20",
        clearance: { close: 21.0, normal: 22.0, loose: 24.0 },
        counterbore: { diameter: 31, depth: 20 },
        countersink: { diameter: 40.32, angle: 90 },
    },
];

/** The clearance classes a simple-hole preset offers, in panel order. */
export const CLEARANCE_CLASSES = ["close", "normal", "loose"] as const;

export type ClearanceClass = (typeof CLEARANCE_CLASSES)[number];

/**
 * The preset row's choice tokens: the value doubles as its own label (a dynamic string cannot
 * be an i18n key), so it carries the numbers the pick will write — `M8 · normal · ⌀9` for a
 * clearance hole, `M8 · ⌀9 / ⌀14×8` for a counterbore, `M8 · ⌀9 / ⌀17.92×90°` for a
 * countersink. `parsePresetToken` reads them back; anything it does not recognise selects
 * nothing.
 */
export function presetTokens(style: "simple" | "counterbore" | "countersink"): string[] {
    if (style === "simple") {
        return HOLE_STANDARDS.flatMap((row) =>
            CLEARANCE_CLASSES.map((cls) => `${row.size} · ${cls} · ⌀${row.clearance[cls]}`),
        );
    }
    if (style === "counterbore") {
        return HOLE_STANDARDS.map(
            (row) =>
                `${row.size} · ⌀${row.clearance.normal} / ⌀${row.counterbore.diameter}×${row.counterbore.depth}`,
        );
    }
    return HOLE_STANDARDS.flatMap((row) =>
        row.countersink === undefined
            ? []
            : [
                  `${row.size} · ⌀${row.clearance.normal} / ⌀${row.countersink.diameter}×${row.countersink.angle}°`,
              ],
    );
}

/** Reads a preset token back into its table row and clearance class (simple holes only). */
export function parsePresetToken(
    token: string,
): { readonly row: HoleStandardRow; readonly clearance: ClearanceClass } | undefined {
    const match = /^(M\d+)\s·\s*(?:(close|normal|loose)\s·)?/.exec(token);
    if (match === null) return undefined;
    const row = HOLE_STANDARDS.find((x) => x.size === match[1]);
    return row === undefined
        ? undefined
        : { row, clearance: (match[2] as ClearanceClass | undefined) ?? "normal" };
}
