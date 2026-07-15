// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, type IWire, Line, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { ShapeFactory } from "../src/factory";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = new ShapeFactory();
});

const plane = Plane.XY;
const shiftedPlane = new Plane({
    origin: new XYZ({ x: 5, y: 0, z: 0 }),
    normal: XYZ.unitZ,
    xvec: XYZ.unitX,
});

// ============================================================================
// Basic primitives
// ============================================================================

describe("ShapeFactory — basic primitives", () => {
    describe("box", () => {
        test("should create a box successfully", () => {
            const result = factory.box(plane, 10, 20, 30);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeDefined();
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });

        test("box should have non-empty mesh", () => {
            const result = factory.box(plane, 10, 20, 30);
            const faces = result.value.mesh.faces;
            expect(faces).toBeDefined();
            if (!faces) return;
            expect(faces.position.length).toBeGreaterThan(0);
            expect(faces.index.length).toBeGreaterThan(0);
            expect(faces.index.length % 3).toBe(0);
        });
    });

    describe("sphere", () => {
        test("should create a sphere successfully", () => {
            const result = factory.sphere(XYZ.zero, 10);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });

    describe("cylinder", () => {
        test("should create a cylinder successfully", () => {
            const result = factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });

    describe("cone", () => {
        test("should create a cone successfully", () => {
            const result = factory.cone(XYZ.unitZ, XYZ.zero, 5, 3, 20);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });

    describe("pyramid", () => {
        test("should create a pyramid successfully", () => {
            const result = factory.pyramid(plane, 10, 10, 20);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });
});

// ============================================================================
// Curves & wires
// ============================================================================

describe("ShapeFactory — curves & wires", () => {
    describe("line", () => {
        test("should create a line successfully", () => {
            const result = factory.line(XYZ.zero, XYZ.unitX);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.edge);
        });

        test("should return error when start and end are too close", () => {
            const result = factory.line(XYZ.zero, XYZ.zero);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The start and end points are too close.");
        });
    });

    describe("arc", () => {
        test("should create an arc successfully", () => {
            const result = factory.arc(XYZ.unitZ, XYZ.zero, XYZ.unitX, 90);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.edge);
        });

        test("should create a full-circle arc (360°)", () => {
            const result = factory.arc(XYZ.unitZ, XYZ.zero, XYZ.unitX, 360);
            expect(result.isOk).toBe(true);
        });
    });

    describe("circle", () => {
        test("should create a circle successfully", () => {
            const result = factory.circle(XYZ.unitZ, XYZ.zero, 5);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.edge);
        });
    });

    describe("ellipse", () => {
        test("should create an ellipse successfully", () => {
            const result = factory.ellipse(XYZ.unitZ, XYZ.zero, XYZ.unitX, 10, 5);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.edge);
        });
    });

    describe("bezier", () => {
        test("should create a bezier curve from three points", () => {
            const points = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
            const result = factory.bezier(points);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.edge);
        });

        test("should create a bezier curve with weights", () => {
            const points = [XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })];
            const result = factory.bezier(points, [1, 2, 1]);
            expect(result.isOk).toBe(true);
        });
    });

    describe("rect", () => {
        test("should create a rectangle face", () => {
            const result = factory.rect(plane, 10, 20);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.face);
        });
    });

    describe("polygon", () => {
        test("should create a polygon wire from 4 points", () => {
            const points = [
                XYZ.zero,
                new XYZ({ x: 10, y: 0, z: 0 }),
                new XYZ({ x: 10, y: 10, z: 0 }),
                new XYZ({ x: 0, y: 10, z: 0 }),
            ];
            const result = factory.polygon(points);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.wire);
        });
    });

    describe("point", () => {
        test("should create a vertex point", () => {
            const result = factory.point(XYZ.zero);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.vertex);
        });
    });

    describe("wire", () => {
        test("should create a wire from edges", () => {
            const e1 = factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })).value;
            const e2 = factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })).value;
            const result = factory.wire([e1, e2]);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.wire);
        });
    });
});

// ============================================================================
// Faces, shells & solids
// ============================================================================

describe("ShapeFactory — faces, shells & solids", () => {
    describe("face", () => {
        test("should create a face from a single wire", () => {
            const rect = factory.rect(plane, 10, 10).value;
            const outerWire = rect.findSubShapes(ShapeTypes.wire)[0];
            const result = factory.face([outerWire as IWire]);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.face);
        });

        test("should return error when wire is empty", () => {
            const result = factory.face([]);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The wire is empty.");
        });
    });

    describe("shell", () => {
        test("should create a shell from faces", () => {
            // Create 6 faces of a cube
            const bottom = factory.rect(plane, 10, 10).value;
            const top = factory.rect(
                new Plane({
                    origin: new XYZ({ x: 0, y: 0, z: 10 }),
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                }),
                10,
                10,
            ).value;
            // shell creation from non-sealed faces may or may not succeed — just verify no crash
            const result = factory.shell([bottom, top]);
            expect(result.isOk).toBeTruthy();
        });
    });

    describe("solid", () => {
        test("should create a solid from a closed shell", () => {
            // Create a box then extract its shell
            const box = factory.box(plane, 10, 10, 10).value;
            const shells = box.findSubShapes(ShapeTypes.shell);
            expect(shells.length).toBeGreaterThan(0);
            const result = factory.solid(shells);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });
});

// ============================================================================
// Operations (prism, pushPull, revolve, sweep, loft, fuse)
// ============================================================================

describe("ShapeFactory — operations", () => {
    describe("prism", () => {
        test("should extrude a face into a solid", () => {
            const rect = factory.rect(plane, 10, 10).value;
            const result = factory.prism(rect, new XYZ({ x: 0, y: 0, z: 20 }));
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });

        test("should return error when vector length is zero", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.prism(boxValue, XYZ.zero);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("vector length is 0");
        });
    });

    describe("pushPull", () => {
        test("should push/pull a face on a solid", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const faces = box.findSubShapes(ShapeTypes.face);
            expect(faces.length).toBeGreaterThanOrEqual(6);
            // May fail on certain faces — just verify it doesn't crash
            const pushPullResult = factory.pushPull(box, faces[0], new XYZ({ x: 0, y: 0, z: 5 }));
            expect(pushPullResult.isOk).toBeTruthy();
        });

        test("should return error when vector length is zero", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const faces = box.findSubShapes(ShapeTypes.face);
            const result = factory.pushPull(box, faces[0], XYZ.zero);
            expect(result.isOk).toBe(false);
        });
    });

    describe("revolve", () => {
        test("should revolve a face around an axis", () => {
            const rect = factory.rect(
                new Plane({
                    origin: new XYZ({ x: 5, y: 0, z: 0 }),
                    normal: XYZ.unitX,
                    xvec: XYZ.unitZ,
                }),
                10,
                20,
            ).value;
            const axis = new Line({ point: XYZ.zero, direction: XYZ.unitZ });
            const result = factory.revolve(rect, axis, 360);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });
    });

    describe("sweep", () => {
        test("should return error for non-OccShape profile", () => {
            const fakeShape = { shapeType: "edge" } as unknown as IShape;
            const pathEdge = factory.line(XYZ.zero, new XYZ({ x: 0, y: 0, z: 10 })).value;
            const pathWire = factory.wire([pathEdge]).value;
            // ensureOccShape throws — verify we get an error
            expect(() => factory.sweep([fakeShape], pathWire, false)).toThrow();
        });
    });

    describe("loft", () => {
        test("should loft between two circles", () => {
            const c1 = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
            const c2 = factory.circle(XYZ.unitZ, new XYZ({ x: 0, y: 0, z: 20 }), 8).value;
            const result = factory.loft([c1, c2], true, false, "c0");
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.solid);
        });

        test("should loft as ruled surface", () => {
            const c1 = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
            const c2 = factory.circle(XYZ.unitZ, new XYZ({ x: 5, y: 5, z: 15 }), 3).value;
            const result = factory.loft([c1, c2], true, true, "c0");
            expect(result.isOk).toBe(true);
        });
    });

    describe("fuse", () => {
        test("should fuse two shapes", () => {
            const box1 = factory.box(plane, 10, 10, 10).value;
            const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
            const result = factory.fuse(box1, box2);
            expect(result.isOk).toBe(true);
        });
    });
});

// ============================================================================
// Boolean operations
// ============================================================================

describe("ShapeFactory — boolean operations", () => {
    test("booleanFuse should merge two boxes (no simplify)", () => {
        const box1 = factory.box(plane, 10, 10, 10).value;
        const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
        const result = factory.booleanFuse([box1], [box2], false);
        expect(result.isOk).toBe(true);
    });

    test("booleanFuse should merge two boxes with simplify", () => {
        const box1 = factory.box(plane, 10, 10, 10).value;
        const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
        const result = factory.booleanFuse([box1], [box2], true);
        expect(result.isOk).toBe(true);
    });

    test("booleanCommon should compute intersection", () => {
        const box1 = factory.box(plane, 10, 10, 10).value;
        const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
        const result = factory.booleanCommon([box1], [box2]);
        expect(result.isOk).toBe(true);
    });

    test("booleanCut should cut one box from another", () => {
        const box1 = factory.box(plane, 10, 10, 10).value;
        const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
        const result = factory.booleanCut([box1], [box2]);
        expect(result.isOk).toBe(true);
    });
});

// ============================================================================
// Feature operations
// ============================================================================

describe("ShapeFactory — feature operations", () => {
    describe("fillet", () => {
        test("should apply fillet on box edges", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(box, [0, 1, 2, 3], 1);
            expect(result.isOk).toBe(true);
        });

        test("should return error when radius is too small", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [0], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The radius is too small.");
        });

        test("should return error when edges is empty", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The edges is empty.");
        });

        test("should return error when shape is not OccShape", () => {
            const fakeShape = { shapeType: "edge" } as unknown as IShape;
            const result = factory.fillet(fakeShape, [0], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Not OccShape");
        });

        test("should catch WASM error on invalid edge index", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [999], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("Fillet Error");
        });
    });

    describe("chamfer", () => {
        test("should apply chamfer on box edges", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const result = factory.chamfer(box, [0, 1, 2, 3], 1);
            expect(result.isOk).toBe(true);
        });

        test("should return error when distance is too small", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.chamfer(boxValue, [0], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The distance is too small.");
        });

        test("should return error when edges is empty", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.chamfer(boxValue, [], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The edges is empty.");
        });

        test("should return error when shape is not OccShape", () => {
            const fakeShape = { shapeType: "solid" } as unknown as IShape;
            const result = factory.chamfer(fakeShape, [0], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Not OccShape");
        });

        test("should catch WASM error on invalid edge index", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.chamfer(boxValue, [999], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("Chamfer Error");
        });
    });

    describe("removeFillet", () => {
        test("should return error when shape is not OccShape", () => {
            const fakeShape = { shapeType: "solid" } as unknown as IShape;
            const result = factory.removeFillet(fakeShape, []);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Not OccShape");
        });
    });

    describe("removeSubShape", () => {
        test("should remove a sub-shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const edges = box.findSubShapes(ShapeTypes.edge);
            expect(edges.length).toBeGreaterThan(0);
            // May or may not succeed depending on topology — just verify no crash
            const removeSubResult = factory.removeSubShape(box, [edges[0]]);
            expect(removeSubResult.isOk).toBe(true);
        });
    });

    describe("replaceSubShape", () => {
        test("should replace a sub-shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const edges = box.findSubShapes(ShapeTypes.edge);
            // Replace may not always make sense — check no crash
            const replaceResult = factory.replaceSubShape(box, edges[0], edges[1]);
            expect(replaceResult.isOk).toBe(true);
        });
    });
});

// ============================================================================
// Advanced operations
// ============================================================================

describe("ShapeFactory — advanced operations", () => {
    describe("combine", () => {
        test("should combine multiple shapes into a compound", () => {
            const box1 = factory.box(plane, 5, 5, 5).value;
            const box2 = factory.box(
                new Plane({
                    origin: new XYZ({ x: 20, y: 0, z: 0 }),
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                }),
                5,
                5,
                5,
            ).value;
            const result = factory.combine([box1, box2]);
            expect(result.isOk).toBe(true);
            expect(result.value.shapeType).toBe(ShapeTypes.compound);
        });
    });

    describe("sewing", () => {
        test("should handle sewing two shapes", () => {
            // Sewing is complex — just check the method exists and doesn't crash
            const box1 = factory.box(plane, 10, 10, 10).value;
            const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
            const sewResult = factory.sewing(box1, box2);
            expect(sewResult.isOk).toBe(true);
        });
    });

    describe("makeThickSolidBySimple", () => {
        test("should create a thick solid (hollow box)", () => {
            const rect = factory.rect(plane, 10, 10).value;
            const thickResult = factory.makeThickSolidBySimple(rect, 1);
            expect(thickResult.isOk).toBe(true);
        });
    });

    describe("makeThickSolidByJoin", () => {
        test("should create a thick solid with closing faces", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const faces = box.findSubShapes(ShapeTypes.face);
            // May succeed or fail — just verify no crash
            const thickJoinResult = factory.makeThickSolidByJoin(box, [faces[0] as IFace], 0.5);
            expect(thickJoinResult.isOk).toBe(true);
        });
    });

    describe("curveProjection", () => {
        test("should project a curve onto a face", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const topFace = box.findSubShapes(ShapeTypes.face)[4]; // typically top face
            const curve = factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })).value;
            // Projection may succeed or fail — just verify no crash
            const projResult = factory.curveProjection(curve, topFace as IFace, XYZ.unitZ);
            expect(projResult.isOk).toBe(true);
        });
    });

    describe("simplifyShape", () => {
        test("should simplify a shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const result = factory.simplifyShape(box, true, true, [], 1e-5, 1e-5);
            expect(result.isOk).toBe(true);
        });
    });
});

// ============================================================================
// Error catching (convertShapeResult coverage)
// ============================================================================

describe("ShapeFactory — convertShapeResult error catching", () => {
    test("should return error when WASM throws on fillet with invalid edge", () => {
        const boxValue = factory.box(plane, 10, 10, 10).value;
        const result = factory.fillet(boxValue, [999], 5);
        expect(result.isOk).toBe(false);
        expect(result.error).toContain("Fillet Error");
    });

    test("should return error when WASM throws on chamfer with invalid edge", () => {
        const boxValue = factory.box(plane, 10, 10, 10).value;
        const result = factory.chamfer(boxValue, [999], 5);
        expect(result.isOk).toBe(false);
        expect(result.error).toContain("Chamfer Error");
    });

    test("should throw error on removeSubShape with non-OccShape", () => {
        const fakeShape = { shapeType: "solid" } as unknown as IShape;
        expect(() => factory.removeSubShape(fakeShape, [])).toThrow(
            "OCC kernel only supports OCC geometries",
        );
    });

    test("should throw error on replaceSubShape with non-OccShape", () => {
        const fakeShape = { shapeType: "solid" } as unknown as IShape;
        const fakeSub = { shapeType: "edge" } as unknown as IShape;
        expect(() => factory.replaceSubShape(fakeShape, fakeSub, fakeSub)).toThrow(
            "OCC kernel only supports OCC geometries",
        );
    });
});
