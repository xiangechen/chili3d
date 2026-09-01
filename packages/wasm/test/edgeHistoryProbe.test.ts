// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Probe tests: pin down what OCCT shape history actually delivers for edges and
// boolean tools, so the parametric edge-id layer knows what it can rely on.

import { type IShape, Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createBox, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

function edgeCount(shape: IShape): number {
    return shape.findSubShapes(ShapeTypes.edge).length;
}

function summarize(map: number[]): string {
    const kept = map.filter((x) => x >= 0);
    return `len=${map.length} kept=${kept.length} new=${map.length - kept.length} map=[${map.join(",")}]`;
}

describe("edge history probe", () => {
    test("prism edgeMap", () => {
        const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
        const result = unwrapOk(factory.prismTracked(rect, new XYZ({ x: 0, y: 0, z: 30 })));
        console.log("prism edges:", summarize(result.edgeMap));
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(4);
        }
    });

    test("fillet edgeMap", () => {
        const box = createBox(factory, 10, 20, 30);
        const result = unwrapOk(factory.filletTracked(box, [0], 2));
        console.log("fillet edges:", summarize(result.edgeMap));
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(12);
        }
    });

    test("chamfer edgeMap", () => {
        const box = createBox(factory, 10, 20, 30);
        const result = unwrapOk(factory.chamferTracked(box, [0], 2));
        console.log("chamfer edges:", summarize(result.edgeMap));
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(12);
        }
    });

    test("booleanCut edgeMap enumerates args edges before tools edges", () => {
        const box = createBox(factory, 10, 10, 10);
        const tool = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 2, 20));
        const toolEdgeCount = edgeCount(tool);
        const result = unwrapOk(factory.booleanCutTracked([box], [tool]));
        console.log("cut edges:", summarize(result.edgeMap), "toolEdgeCount:", toolEdgeCount);
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        // Any surviving input edge points into [0, 12 + toolEdgeCount).
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(12 + toolEdgeCount);
        }
        // The intersection circle is a new edge.
        expect(result.edgeMap).toContain(-1);
    });

    test("booleanFuse with simplify merges coplanar faces and keeps history", () => {
        const a = createBox(factory, 10, 10, 10);
        const b = unwrapOk(
            factory.box(
                new Plane({
                    origin: new XYZ({ x: 10, y: 0, z: 0 }),
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                }),
                10,
                10,
                10,
            ),
        );
        const result = unwrapOk(factory.booleanFuseTracked([a], [b]));
        console.log("fuse faces:", summarize(result.faceMap), "edges:", summarize(result.edgeMap));
        // Two boxes side by side fuse into one 20x10x10 box: 6 faces after simplify.
        expect(result.faceMap.length).toBe(6);
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        for (const index of result.faceMap) {
            expect(index).toBeLessThan(12);
        }
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(24);
        }
    });

    test("revolve edgeMap", () => {
        const rect = unwrapOk(factory.rect(Plane.XY, 10, 20));
        const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
        const result = unwrapOk(factory.revolveTracked(rect, axis, 360));
        console.log("revolve edges:", summarize(result.edgeMap));
        expect(result.edgeMap.length).toBe(edgeCount(result.shape));
        for (const index of result.edgeMap) {
            expect(index).toBeLessThan(4);
        }
    });
});
