// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    capturePatternLineSource,
    capturePatternPathSource,
    trackedEdgeIds,
} from "../../src/commands/patternSources";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../../src/sketch";

/** A line edge mock — the fields `captureEdgeRef` and the path sampler read. */
function edge(start: XYZ, end: XYZ): IEdge {
    const direction = end.sub(start);
    const length = direction.length();
    return {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: direction.x, y: direction.y, z: direction.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
            uniformAbscissaByCount: (count: number) =>
                Array.from({ length: count + 1 }, (_, index) => start.add(direction.multiply(index / count))),
            parameter: (point: XYZ) =>
                length === 0 ? undefined : point.sub(start).dot(direction) / (length * length),
            value: (parameter: number) => start.add(direction.multiply(parameter)),
            d1: (parameter: number) => ({
                point: start.add(direction.multiply(parameter)),
                vec: direction,
            }),
            period: () => 0,
            isPeriodic: () => false,
        },
        length: () => length,
        startPoint: () => start,
        endPoint: () => end,
    } as unknown as IEdge;
}

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 1, 0] },
        { id: 2, type: "line", params: [1, 0, 1, 1] },
        { id: 3, type: "line", params: [1, 1, 0, 1] },
        { id: 4, type: "line", params: [0, 1, 0, 0] },
    ],
    constraints: [],
};

function pick(node: any, shape: IEdge, index = 0): VisualShapeData {
    return { owner: { node }, shape, transform: Matrix4.identity(), indexes: [index] } as any;
}

describe("pattern source capture", () => {
    let doc: TestDocument;
    let body: ParametricBodyNode;
    let edges: IEdge[];

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        body = new ParametricBodyNode({ document: doc, id: "b1" });
        edges = [
            edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 })),
        ];
        rs.spyOn(body, "shape", "get").mockReturnValue(
            Result.ok({
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            } as any),
        );
    });

    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("a tracked node's edge ids ride the captured refs", () => {
        rs.spyOn(body, "edgeIdAt").mockImplementation((index: number) => ["e1", "e2"][index]);
        expect(trackedEdgeIds(body)).toEqual(["e1", "e2"]);

        const line = capturePatternLineSource(pick(body, edges[1], 1));
        expect(line).toMatchObject({ nodeId: "b1", edge: { kind: "line", edgeId: "e2" } });

        const path = capturePatternPathSource([pick(body, edges[0], 0), pick(body, edges[1], 1)]);
        expect(path?.edges.map((ref) => ref.edgeId)).toEqual(["e1", "e2"]);
        expect(path?.edges.every((ref) => ref.splitPiece !== true)).toBe(true);
    });

    test("an id two edges share marks both pieces as a split", () => {
        rs.spyOn(body, "edgeIdAt").mockReturnValue("shared");

        const path = capturePatternPathSource([pick(body, edges[0], 0), pick(body, edges[1], 1)]);

        expect(path?.edges.map((ref) => ref.splitPiece)).toEqual([true, true]);
    });

    test("an untracked node yields refs with no ids", () => {
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);

        expect(trackedEdgeIds(sketch)).toBeUndefined();
        const path = capturePatternPathSource([pick(sketch, edges[0]), pick(sketch, edges[1], 1)]);
        expect(path?.edges.every((ref) => ref.edgeId === undefined)).toBe(true);
    });

    test("picks from two nodes are refused rather than captured as one path", () => {
        const other = new ParametricBodyNode({ document: doc, id: "b2" });
        doc.modelManager.addNode(other);

        expect(capturePatternPathSource([pick(body, edges[0]), pick(other, edges[1])])).toBeUndefined();
        expect(capturePatternPathSource([])).toBeUndefined();
    });
});
