// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IFace, IShape } from "../src";

/**
 * Reading a shape's measurements in tests, so a conformance case can assert a closed
 * form rather than "it built something". The parameters of a CAD operation have an
 * exact answer on paper — a fillet's volume, a shell's wall, a prism's area — and the
 * only way a wrong answer is noticed is by writing that answer down. A test that
 * compares two computed values to each other notices a *change*, never a mistake both
 * sides share.
 *
 * Every reading is rounded: a kernel integrates to within a few ulps of the closed
 * form, so rounding is what lets the assertion be an equality (and the failure message
 * a readable pair of numbers) instead of a tolerance nobody can interpret.
 */

/**
 * `value` rounded to `digits` decimals. The default is the precision the kernel's
 * integrations and boolean operations reliably hold to; passing fewer digits is how a
 * case says "this one only agrees to a coarser order and here is why".
 */
export function round(value: number, digits = 6): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function rounded(shape: IShape, digits: number): number {
    return round(shape.volume(), digits);
}

/**
 * The shape's volume, rounded. Works on any shape (a face reads 0, a surface body reads
 * 0) — the caller is asserting a solid's volume and writes the solid down, so a
 * mistyped shape shows up as a wrong number rather than an error.
 */
export function volumeOf(shape: IShape, digits = 6): number {
    return rounded(shape, digits);
}

/** The face's area, rounded. */
export function areaOf(face: IFace, digits = 6): number {
    return round(face.area(), digits);
}

/**
 * Assert the shape's volume equals `expected` — a closed form written out at the call
 * site (`Math.PI * r ** 2 * h`, `40 * 40 * 20 - 36 * 36 * 18`), not a value copied from
 * a previous run. Compared after rounding, so the test reads as the arithmetic it is:
 *
 * ```ts
 * expectVolume(plateWithShell(), 40 * 40 * 20 - 36 * 36 * 18);
 * ```
 */
export function expectVolume(shape: IShape, expected: number, digits = 6): void {
    expect(rounded(shape, digits)).toBe(round(expected, digits));
}

/**
 * Assert the face's area equals `expected`, same contract as {@link expectVolume}.
 * `face` is typed as the face interface so a caller cannot pass a solid and get a
 * silent 0 — `volume` is on every shape, `area` is not.
 */
export function expectArea(face: IFace, expected: number, digits = 6): void {
    expect(areaOf(face, digits)).toBe(round(expected, digits));
}
