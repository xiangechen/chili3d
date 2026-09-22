// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICurve, type IEdge, type Result, ShapeTypes, XYZ } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { type PathFrame, type PathFrames, pathFrames } from "../../src/text/pathFrames";

const TAU = Math.PI * 2;

/**
 * A circle stated the way the kernel states one: a parameter that runs around
 * the turn, a length that grows with the radius, and a derivative at right
 * angles to the radius. Hand-written so the expected frames are exact.
 */
function circleEdge(radius: number, periodic = true): IEdge {
    const at = (parameter: number) =>
        new XYZ({ x: radius * Math.cos(parameter), y: radius * Math.sin(parameter), z: 0 });
    const tangentAt = (parameter: number) =>
        new XYZ({ x: -Math.sin(parameter), y: Math.cos(parameter), z: 0 });

    const curve = {
        length: () => TAU * radius,
        isPeriodic: () => periodic,
        period: () => TAU,
        firstParameter: () => 0,
        lastParameter: () => TAU,
        uniformAbscissaByCount: (count: number) =>
            Array.from({ length: count }, (_, index) => at((index / (count - 1)) * TAU)),
        // The seam answers with the start of the range, as a real projection does.
        parameter: (point: XYZ) => {
            const angle = Math.atan2(point.y, point.x);
            return angle < 0 ? angle + TAU : angle;
        },
        value: at,
        d1: (parameter: number) => ({ point: at(parameter), vec: tangentAt(parameter) }),
    };

    return { shapeType: ShapeTypes.edge, curve: curve as unknown as ICurve, isClosed: () => true } as IEdge;
}

/** A straight edge: collinear samples, so it fixes no plane. */
function lineEdge(): IEdge {
    const at = (parameter: number) => new XYZ({ x: parameter, y: 0, z: 0 });

    const curve = {
        length: () => 100,
        isPeriodic: () => false,
        period: () => 0,
        firstParameter: () => 0,
        lastParameter: () => 100,
        uniformAbscissaByCount: (count: number) =>
            Array.from({ length: count }, (_, index) => at((index / (count - 1)) * 100)),
        parameter: (point: XYZ) => point.x,
        value: at,
        d1: () => ({ point: XYZ.zero, vec: XYZ.unitX }),
    };

    return { shapeType: ShapeTypes.edge, curve: curve as unknown as ICurve, isClosed: () => false } as IEdge;
}

/** A circle of the given radius, measured with the text facing up. */
const circle = (radius: number) => {
    const frames = pathFrames(circleEdge(radius), XYZ.unitZ);
    if (!frames.isOk) throw new Error(`the circle was refused: ${frames.error}`);
    return frames;
};

/** The frame at a distance the tests expect a path to have one at. */
function frameAt(frames: Result<PathFrames>, abscissa: number): PathFrame {
    const frame = frames.value.at(abscissa);
    if (frame === undefined) throw new Error(`the path has no frame at ${abscissa}`);
    return frame;
}

describe("pathFrames", () => {
    test("measures the path's length", () => {
        expect(circle(20).value.length).toBeCloseTo(TAU * 20, 6);
    });

    test("orients the normal toward the direction the caller faces", () => {
        const up = circle(20);
        const down = pathFrames(circleEdge(20), XYZ.unitZ.reverse());

        expect(up.value.normal).toEqual(XYZ.unitZ);
        expect(down.value.normal).toEqual(XYZ.unitZ.reverse());
    });

    test("places a frame on the path, turning with it", () => {
        const frames = circle(20);

        const atZero = frameAt(frames, 0);
        const atQuarter = frameAt(frames, (TAU * 20) / 4);

        expect(atZero.point.x).toBeCloseTo(20, 6);
        expect(atZero.point.y).toBeCloseTo(0, 6);
        expect(atZero.tangent.x).toBeCloseTo(0, 6);
        expect(atZero.tangent.y).toBeCloseTo(1, 6);
        expect(atZero.up.x).toBeCloseTo(-1, 6);
        expect(atZero.up.y).toBeCloseTo(0, 6);
        expect(atQuarter.point.x).toBeCloseTo(0, 6);
        expect(atQuarter.point.y).toBeCloseTo(20, 6);
        expect(atQuarter.tangent.x).toBeCloseTo(-1, 6);
    });

    test("keeps the frames' distances evenly spaced around a closed path", () => {
        const frames = circle(20);
        const length = frames.value.length;

        const points = [0, 0.25, 0.5, 0.75].map((fraction) => frameAt(frames, length * fraction).point);
        const angles = points.map((point) => (Math.atan2(point.y, point.x) + TAU) % TAU);

        expect(angles[0]).toBeCloseTo(0, 6);
        expect(angles[1]).toBeCloseTo(TAU / 4, 5);
        expect(angles[2]).toBeCloseTo(TAU / 2, 5);
        expect(angles[3]).toBeCloseTo((TAU * 3) / 4, 5);
    });

    test("takes a distance past a loop's end round again", () => {
        const frames = circle(20);
        const length = TAU * 20;
        const past = frameAt(frames, length + 5);

        // What goes past the seam comes round: the text set on a ring reads on round it
        // rather than piling up on the point it started at.
        const turned = frameAt(frames, 5);
        expect(past.point.x).toBeCloseTo(turned.point.x, 5);
        expect(past.point.y).toBeCloseTo(turned.point.y, 5);
        expect(past.tangent.x).toBeCloseTo(turned.tangent.x, 5);
        expect(past.tangent.y).toBeCloseTo(turned.tangent.y, 5);
    });

    test("carries on past the end of an open path, the way the end was heading", () => {
        // The same curve, except that nothing says it closes.
        const frames = pathFrames(circleEdge(20, false), XYZ.unitZ);
        const length = TAU * 20;
        const past = frameAt(frames, length + 5);

        const end = frameAt(frames, length);
        // Five further along the tangent the end was pointing in, so how far the text runs
        // past the path is there to be seen.
        expect(past.point.x).toBeCloseTo(end.point.x + end.tangent.x * 5, 5);
        expect(past.point.y).toBeCloseTo(end.point.y + end.tangent.y * 5, 5);
        expect(past.tangent.x).toBeCloseTo(end.tangent.x, 5);
        expect(past.tangent.y).toBeCloseTo(end.tangent.y, 5);
    });

    test("carries a distance before the start back the other way", () => {
        const frames = pathFrames(circleEdge(20, false), XYZ.unitZ);
        const before = frameAt(frames, -5);

        const start = frameAt(frames, 0);
        expect(before.point.x).toBeCloseTo(start.point.x - start.tangent.x * 5, 5);
        expect(before.point.y).toBeCloseTo(start.point.y - start.tangent.y * 5, 5);
    });

    test("refuses a straight path, which fixes no plane", () => {
        const frames = pathFrames(lineEdge(), XYZ.unitZ);

        expect(frames.isOk).toBe(false);
        expect(frames.error).toContain("straight");
    });

    test("the frame's axes are all perpendicular", () => {
        const frames = circle(20);
        const frame = frameAt(frames, 3);

        expect(frame.tangent.dot(frame.up)).toBeCloseTo(0, 6);
        expect(frame.tangent.dot(frames.value.normal)).toBeCloseTo(0, 6);
        expect(frame.up.dot(frames.value.normal)).toBeCloseTo(0, 6);
        expect(frame.tangent.length()).toBeCloseTo(1, 6);
        expect(frame.up.length()).toBeCloseTo(1, 6);
    });
});
