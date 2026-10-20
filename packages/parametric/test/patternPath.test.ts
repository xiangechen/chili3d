// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, Matrix4, ShapeTypes, XYZ } from "@chili3d/core";
import { measuredPath, orderPathEdges } from "../src/features/patternPath";

/** A line edge whose parameter runs 0 → 1 from start to end. */
function lineEdge(start: XYZ, end: XYZ): IEdge {
    const direction = end.sub(start);
    const length = direction.length();
    const curve = {
        uniformAbscissaByCount: (count: number) =>
            Array.from({ length: count + 1 }, (_, index) => start.add(direction.multiply(index / count))),
        parameter: (point: XYZ) =>
            length === 0 ? undefined : point.sub(start).dot(direction) / (length * length),
        value: (parameter: number) => start.add(direction.multiply(parameter)),
        d1: (parameter: number) => ({ point: start.add(direction.multiply(parameter)), vec: direction }),
        period: () => 0,
        isPeriodic: () => false,
    };
    return {
        shapeType: ShapeTypes.edge,
        startPoint: () => start,
        endPoint: () => end,
        length: () => length,
        curve,
    } as unknown as IEdge;
}

/** A counter-clockwise arc about +Z, parameterised by its angle in radians. */
function arcEdge(center: XYZ, radius: number, from: number, to: number): IEdge {
    const at = (angle: number) =>
        center.add(new XYZ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 }));
    const curve = {
        uniformAbscissaByCount: (count: number) =>
            Array.from({ length: count + 1 }, (_, index) => at(from + ((to - from) * index) / count)),
        parameter: (point: XYZ) => Math.atan2(point.y - center.y, point.x - center.x),
        value: (parameter: number) => at(parameter),
        d1: (parameter: number) => ({
            point: at(parameter),
            vec: new XYZ({ x: -Math.sin(parameter) * radius, y: Math.cos(parameter) * radius, z: 0 }),
        }),
        period: () => Math.PI * 2,
        isPeriodic: () => false,
    };
    return {
        shapeType: ShapeTypes.edge,
        startPoint: () => at(from),
        endPoint: () => at(to),
        length: () => radius * Math.abs(to - from),
        curve,
    } as unknown as IEdge;
}

const point = (x: number, y: number, z = 0) => new XYZ({ x, y, z });

describe("orderPathEdges", () => {
    test("walks a shuffled pick into its end-to-end chain", () => {
        const first = lineEdge(point(0, 0), point(10, 0));
        const second = lineEdge(point(10, 0), point(10, 10));
        const third = lineEdge(point(10, 10), point(0, 10));

        const ordered = orderPathEdges([first, second, third]);

        expect(ordered.isOk).toBe(true);
        expect(ordered.value.map((edge) => [edge.edge, edge.reversed])).toEqual([
            [first, false],
            [second, false],
            [third, false],
        ]);
    });

    test("turns an edge around when the walk meets its far end", () => {
        const first = lineEdge(point(0, 0), point(10, 0));
        // Picked and stored end-to-start: the chain has to run it backwards.
        const reversed = lineEdge(point(20, 0), point(10, 0));
        const last = lineEdge(point(20, 0), point(30, 0));

        const ordered = orderPathEdges([first, last, reversed]);

        expect(ordered.isOk).toBe(true);
        expect(ordered.value.map((edge) => edge.edge)).toEqual([first, reversed, last]);
        expect(ordered.value.map((edge) => edge.reversed)).toEqual([false, true, false]);
    });

    test("closes a loop and starts it from the first picked edge", () => {
        const corners = [point(0, 0), point(10, 0), point(10, 10), point(0, 10)];
        const edges = corners.map((corner, index) => lineEdge(corner, corners[(index + 1) % corners.length]));

        const ordered = orderPathEdges(edges);

        expect(ordered.isOk).toBe(true);
        expect(ordered.value).toHaveLength(4);
        expect(ordered.value.every((edge) => !edge.reversed)).toBe(true);
        expect(ordered.value.map((edge) => edge.edge)).toEqual(edges);
    });

    test("refuses edges that do not connect end to end", () => {
        const first = lineEdge(point(0, 0), point(10, 0));
        const second = lineEdge(point(20, 0), point(30, 0));

        const ordered = orderPathEdges([first, second]);

        expect(ordered.isOk).toBe(false);
        expect(ordered.error).toBe("Pattern path edges must connect end to end");
    });

    test("refuses a fork", () => {
        const stem = lineEdge(point(0, 0), point(10, 0));
        const up = lineEdge(point(10, 0), point(10, 10));
        const down = lineEdge(point(10, 0), point(10, -10));

        const ordered = orderPathEdges([stem, up, down]);

        expect(ordered.isOk).toBe(false);
        expect(ordered.error).toBe("Pattern path branches; its edges must form a single chain");
    });
});

describe("measuredPath", () => {
    test("reports the length and the frame at either end of a line", () => {
        const line = lineEdge(point(0, 0), point(10, 0));

        const measured = measuredPath([{ edge: line, reversed: false }]);

        expect(measured.isOk).toBe(true);
        expect(measured.value.length).toBe(10);
        expect(measured.value.closed).toBe(false);
        expect(measured.value.at(0)?.point).toEqual(point(0, 0));
        expect(measured.value.at(5)?.point).toEqual(point(5, 0));
        expect(measured.value.at(10)?.point).toEqual(point(10, 0));
        expect(measured.value.at(5)?.tangent).toEqual(new XYZ({ x: 1, y: 0, z: 0 }));
    });

    test("walks a reversed edge from its end", () => {
        const line = lineEdge(point(0, 0), point(10, 0));

        const measured = measuredPath([{ edge: line, reversed: true }]);

        expect(measured.isOk).toBe(true);
        expect(measured.value.at(0)?.point).toEqual(point(10, 0));
        expect(measured.value.at(0)?.tangent).toEqual(new XYZ({ x: -1, y: 0, z: 0 }));
        expect(measured.value.at(10)?.point).toEqual(point(0, 0));
    });

    test("follows the tangent of an arc at its middle", () => {
        const arc = arcEdge(point(0, 0), 10, 0, Math.PI / 2);

        const measured = measuredPath([{ edge: arc, reversed: false }]);

        expect(measured.isOk).toBe(true);
        expect(measured.value.length).toBeCloseTo((10 * Math.PI) / 2, 6);
        const middle = measured.value.at((10 * Math.PI) / 4);
        expect(middle).toBeDefined();
        expect(middle!.point.x).toBeCloseTo(10 * Math.cos(Math.PI / 4), 6);
        expect(middle!.point.y).toBeCloseTo(10 * Math.sin(Math.PI / 4), 6);
        expect(middle!.tangent.x).toBeCloseTo(-Math.sin(Math.PI / 4), 6);
        expect(middle!.tangent.y).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    });

    test("joins two edges into one measured path", () => {
        const first = lineEdge(point(0, 0), point(10, 0));
        const second = lineEdge(point(10, 0), point(10, 10));

        const measured = measuredPath([
            { edge: first, reversed: false },
            { edge: second, reversed: false },
        ]);

        expect(measured.isOk).toBe(true);
        expect(measured.value.length).toBe(20);
        expect(measured.value.at(10)?.point).toEqual(point(10, 0));
        expect(measured.value.at(15)?.point).toEqual(point(10, 5));
        expect(measured.value.at(15)?.tangent).toEqual(new XYZ({ x: 0, y: 1, z: 0 }));
    });

    test("wraps a closed path's abscissa", () => {
        const corners = [point(0, 0), point(10, 0), point(10, 10), point(0, 10)];
        const edges = corners.map((corner, index) => ({
            edge: lineEdge(corner, corners[(index + 1) % corners.length]),
            reversed: false,
        }));

        const measured = measuredPath(edges);

        expect(measured.isOk).toBe(true);
        expect(measured.value.closed).toBe(true);
        expect(measured.value.at(40)?.point).toEqual(point(0, 0));
        expect(measured.value.at(45)?.point).toEqual(point(5, 0));
    });

    test("maps points and tangents through a transform", () => {
        const line = lineEdge(point(0, 0), point(10, 0));

        const measured = measuredPath([{ edge: line, reversed: false }], Matrix4.fromTranslation(0, 5, 0));

        expect(measured.isOk).toBe(true);
        expect(measured.value.at(0)?.point).toEqual(point(0, 5));
        expect(measured.value.at(5)?.tangent).toEqual(new XYZ({ x: 1, y: 0, z: 0 }));
    });

    test("refuses a path with no length", () => {
        const degenerate = lineEdge(point(0, 0), point(0, 0));

        const measured = measuredPath([{ edge: degenerate, reversed: false }]);

        expect(measured.isOk).toBe(false);
        expect(measured.error).toBe("Pattern path has an edge with no length");
    });
});
