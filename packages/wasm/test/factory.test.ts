// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
    type IEdge,
    type IFace,
    type IShape,
    type IVertex,
    type IWire,
    Line,
    Matrix4,
    Plane,
    ShapeTypes,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { MockShape } from "@chili3d/core/test-utils";
import type { ShapeFactory } from "../src/factory";
import type { OccEdge, OccFace, OccSolid } from "../src/shape";
import { OccCylindricalSurface, OccPlane } from "../src/surface";
import { createTestConverter, createTestFactory, surfaceOfFace, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
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

        test("should return error for disconnected edges", () => {
            const e1 = factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })).value;
            const e2 = factory.line(new XYZ({ x: 20, y: 0, z: 0 }), new XYZ({ x: 30, y: 0, z: 0 })).value;
            const result = factory.wire([e1, e2]);
            expect(result.isOk).toBe(false);
        });

        test("should create a wire from edges extracted from another wire", () => {
            const e1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })));
            const e2 = unwrapOk(
                factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
            );
            const e3 = unwrapOk(
                factory.line(new XYZ({ x: 10, y: 10, z: 0 }), new XYZ({ x: 20, y: 10, z: 0 })),
            );

            const wire12 = unwrapOk(factory.wire([e1, e2]));
            expect(wire12.shapeType).toBe(ShapeTypes.wire);

            const edges = wire12.findSubShapes(ShapeTypes.edge) as IEdge[];
            expect(edges.length).toBe(2);

            const wire123 = factory.wire([...edges, e3]);
            expect(wire123.isOk).toBe(true);
            expect(wire123.value.shapeType).toBe(ShapeTypes.wire);
            expect(wire123.value.findSubShapes(ShapeTypes.edge).length).toBe(3);
        });

        test("should not corrupt input edges on repeated wire calls", () => {
            // BRepBuilderAPI_MakeWire shares/reverses the vertices of the added edges in
            // place; wire() must build from copies so the same edges can be reused (e.g.
            // convert-to-wire, undo, convert again).
            const e1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })));
            const e2 = unwrapOk(
                factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
            );

            const w1 = factory.wire([e1, e2]);
            expect(w1.isOk).toBe(true);

            const w2 = factory.wire([e1, e2]);
            expect(w2.isOk).toBe(true);
            expect(w2.value.shapeType).toBe(ShapeTypes.wire);
        });

        test("should not corrupt transformed edges on repeated wire calls", () => {
            // ConvertToWire passes `shape.transformedMul(worldTransform)` results to wire().
            const e1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })));
            const e2 = unwrapOk(
                factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
            );

            const w1 = factory.wire([
                e1.transformedMul(Matrix4.identity()) as IEdge,
                e2.transformedMul(Matrix4.identity()) as IEdge,
            ]);
            expect(w1.isOk).toBe(true);

            const w2 = factory.wire([
                e1.transformedMul(Matrix4.identity()) as IEdge,
                e2.transformedMul(Matrix4.identity()) as IEdge,
            ]);
            expect(w2.isOk).toBe(true);
        });

        test("should chain edges connected at the start of the first edge (edgeWire.brep)", () => {
            // The compound lists the edges as [top, bottom, vertical]; the geometric chain
            // is bottom -> vertical -> top, so the first edge only connects at its START.
            const brep = readFileSync(path.resolve(import.meta.dirname, "models", "edgeWire.brep"), "utf-8");
            const shape = unwrapOk(createTestConverter().convertFromBrep(brep));
            const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
            expect(edges.length).toBe(3);

            const wire = factory.wire(edges);
            expect(wire.isOk).toBe(true);
            expect(wire.value.shapeType).toBe(ShapeTypes.wire);
            expect(wire.value.findSubShapes(ShapeTypes.edge).length).toBe(3);
        });
    });

    describe("wire ordering", () => {
        const lineEdge = (x1: number, y1: number, x2: number, y2: number) =>
            unwrapOk(factory.line({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 })) as IEdge;

        // Thin L-shaped band outline (6 edges); the inner long edge is derived from an
        // offset curve (near-coincident endpoints used to break the old wire ordering).
        const bandEdges = (): IEdge[] => {
            const bottom = lineEdge(0, 0, 200, 0);
            const offseted = bottom.offset(-12, XYZ.unitZ);
            if (!offseted.isOk) throw new Error(`offset failed: ${offseted.error}`);
            const curve = offseted.value.curve;
            const p1 = curve.parameter({ x: 78, y: 12, z: 0 }, curve.length() * 0.5);
            const p2 = curve.parameter({ x: 200, y: 12, z: 0 }, curve.length());
            const inner = offseted.value.trim(p1!, p2!);
            return [
                bottom,
                lineEdge(200, 0, 200, 12),
                inner,
                lineEdge(78, 12, 38, 102),
                lineEdge(38, 102, 26, 96),
                lineEdge(26, 96, 0, 0),
            ];
        };

        function* permutations<T>(arr: T[]): Generator<T[]> {
            if (arr.length <= 1) {
                yield [...arr];
                return;
            }
            for (let i = 0; i < arr.length; i++) {
                const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
                for (const perm of permutations(rest)) {
                    yield [arr[i], ...perm];
                }
            }
        }

        test("should build the same face regardless of edge order", () => {
            const edges = bandEdges();
            let count = 0;
            for (const perm of permutations(edges)) {
                count++;
                const wire = factory.wire(perm);
                expect(wire.isOk).toBe(true);
                const face = factory.face([wire.value as IWire]);
                expect(face.isOk).toBe(true);
                // hexagon area via shoelace: 6180
                expect(face.value.area()).toBeCloseTo(6180, 6);
            }
            expect(count).toBe(720);
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

    describe("faceFromSurface", () => {
        const sourceRect = () => unwrapOk(factory.rect(plane, 10, 20)) as OccFace;

        test("should create a face on the source plane surface", () => {
            const wire = unwrapOk(
                factory.polygon([
                    XYZ.zero,
                    new XYZ({ x: 4, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 5, z: 0 }),
                    new XYZ({ x: 0, y: 5, z: 0 }),
                ]),
            );
            const result = factory.faceFromSurface([wire], sourceRect());
            expect(result.isOk).toBe(true);
            const face = result.value as OccFace;
            expect(face.shapeType).toBe(ShapeTypes.face);
            expect(face.area()).toBeCloseTo(20, 6);
            const [, normal] = face.normal(0.5, 0.5);
            expect(normal.z).toBeCloseTo(1, 6);
            expect(surfaceOfFace(face) instanceof OccPlane).toBe(true);
        });

        test("should create a face with a hole from outer and inner wires", () => {
            const outer = unwrapOk(
                factory.polygon([
                    XYZ.zero,
                    new XYZ({ x: 4, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 5, z: 0 }),
                    new XYZ({ x: 0, y: 5, z: 0 }),
                ]),
            );
            const inner = unwrapOk(
                factory.polygon([
                    new XYZ({ x: 1, y: 1, z: 0 }),
                    new XYZ({ x: 2, y: 1, z: 0 }),
                    new XYZ({ x: 2, y: 3, z: 0 }),
                    new XYZ({ x: 1, y: 3, z: 0 }),
                ]),
            );
            const result = factory.faceFromSurface([outer, inner], sourceRect());
            expect(result.isOk).toBe(true);
            const face = result.value as OccFace;
            // 4*5 outer minus 1*2 hole
            expect(face.area()).toBeCloseTo(16, 6);
            expect(face.findSubShapes(ShapeTypes.wire).length).toBe(2);
        });

        test("should return error when wires are empty", () => {
            const result = factory.faceFromSurface([], sourceRect());
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The wire is empty.");
        });

        test("should throw when the source face is not an OccShape", () => {
            const wire = unwrapOk(
                factory.polygon([
                    XYZ.zero,
                    new XYZ({ x: 4, y: 0, z: 0 }),
                    new XYZ({ x: 4, y: 5, z: 0 }),
                    new XYZ({ x: 0, y: 5, z: 0 }),
                ]),
            );
            const fakeFace = new MockShape({ shapeType: ShapeTypes.face }) as unknown as IFace;
            expect(() => factory.faceFromSurface([wire], fakeFace)).toThrow(
                "OCC kernel only supports OCC geometries",
            );
        });
    });

    describe("facesFromEdges", () => {
        function rectEdges(x1: number, y1: number, x2: number, y2: number): IEdge[] {
            return [
                unwrapOk(factory.line(new XYZ({ x: x1, y: y1, z: 0 }), new XYZ({ x: x2, y: y1, z: 0 }))),
                unwrapOk(factory.line(new XYZ({ x: x2, y: y1, z: 0 }), new XYZ({ x: x2, y: y2, z: 0 }))),
                unwrapOk(factory.line(new XYZ({ x: x2, y: y2, z: 0 }), new XYZ({ x: x1, y: y2, z: 0 }))),
                unwrapOk(factory.line(new XYZ({ x: x1, y: y2, z: 0 }), new XYZ({ x: x1, y: y1, z: 0 }))),
            ];
        }

        test("two overlapping rectangles without shared endpoints produce three regions", () => {
            const edges = [...rectEdges(0, 0, 4, 4), ...rectEdges(2, 2, 6, 6)];
            const result = factory.facesFromEdges(edges, plane);
            expect(result.isOk).toBe(true);
            const { faces, sources } = result.value;
            expect(faces.length).toBe(3);
            expect(sources.length).toBe(3);
            expect(faces.every((f) => f.shapeType === ShapeTypes.face)).toBe(true);
            // Regions: A-only 4*4-2*2, overlap 2*2, B-only.
            const areas = faces.map((f) => f.area()).sort((a, b) => a - b);
            expect(areas[0]).toBeCloseTo(4, 5);
            expect(areas[1]).toBeCloseTo(12, 5);
            expect(areas[2]).toBeCloseTo(12, 5);
            // The overlap region [2,4]x[2,4] is bounded by A's right/top edges (1, 2)
            // and B's bottom/left edges (4, 7); the L-shaped outer regions are also
            // bounded by the inner corner segments of the other rectangle.
            const bySources = new Map(sources.map((set, i) => [set.join(","), faces[i].area()]));
            expect(bySources.get("0,1,2,3,4,7")).toBeCloseTo(12, 5);
            expect(bySources.get("1,2,4,7")).toBeCloseTo(4, 5);
            expect(bySources.get("1,2,4,5,6,7")).toBeCloseTo(12, 5);
        });

        test("a line crossing a circle splits the disk into two faces", () => {
            const circle = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
            const line = unwrapOk(
                factory.line(new XYZ({ x: -10, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            );
            const result = factory.facesFromEdges([circle, line], plane);
            expect(result.isOk).toBe(true);
            const { faces, sources } = result.value;
            expect(faces.length).toBe(2);
            for (const face of faces) {
                expect(face.area()).toBeCloseTo((Math.PI * 25) / 2, 4);
            }
            // Both half-disks are bounded by the circle and the line.
            expect(sources).toEqual([
                [0, 1],
                [0, 1],
            ]);
        });

        test("disjoint closed rectangles produce one face each", () => {
            const edges = [...rectEdges(0, 0, 2, 2), ...rectEdges(10, 10, 12, 12)];
            const result = factory.facesFromEdges(edges, plane);
            expect(result.isOk).toBe(true);
            const { faces, sources } = result.value;
            expect(faces.length).toBe(2);
            for (const face of faces) {
                expect(face.area()).toBeCloseTo(4, 5);
            }
            expect(sources).toEqual([
                [0, 1, 2, 3],
                [4, 5, 6, 7],
            ]);
        });

        test("an open polyline encloses no region", () => {
            const edges = [
                unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))),
                unwrapOk(factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 }))),
                unwrapOk(factory.line(new XYZ({ x: 10, y: 10, z: 0 }), new XYZ({ x: 0, y: 10, z: 0 }))),
            ];
            const result = factory.facesFromEdges(edges, plane);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("No bounded regions found");
        });

        test("should return error when edges are empty", () => {
            const result = factory.facesFromEdges([], plane);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The edges are empty.");
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
            // Shell from the top and bottom faces of a cube builds successfully
            const result = factory.shell([bottom, top]);
            expect(result.isOk).toBe(true);
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
            // Push/pull on a box face succeeds
            const pushPullResult = factory.pushPull(box, faces[0], new XYZ({ x: 0, y: 0, z: 5 }));
            expect(pushPullResult.isOk).toBe(true);
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
            const fakeShape = new MockShape({ shapeType: ShapeTypes.edge }) as unknown as IShape;
            const pathEdge = factory.line(XYZ.zero, new XYZ({ x: 0, y: 0, z: 10 })).value;
            const pathWire = factory.wire([pathEdge]).value;
            // ensureOccShape throws — verify we get an error
            expect(() => factory.sweep([fakeShape], pathWire, false)).toThrow();
        });

        test.each([
            false,
            true,
        ])("should sweep a circular profile along a straight path (isRound=%s)", (isRound) => {
            const profile = unwrapOk(factory.wire([unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 2))]));
            const path = unwrapOk(
                factory.wire([unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 0, y: 0, z: 10 })))]),
            );
            const result = factory.sweep([profile], path, isRound);
            expect(result.isOk).toBe(true);
            const shape = result.value;
            expect(shape.shapeType).toBe(ShapeTypes.solid);
            expect(shape.findSubShapes(ShapeTypes.face).length).toBe(3);
            const solid = shape.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid;
            // A radius-2 circle swept 10 along its normal is a cylinder
            expect(solid.volume()).toBeCloseTo(Math.PI * 2 * 2 * 10, 6);
        });

        test.each([
            { isRound: false, faces: 4, volume: Math.PI * 20 },
            { isRound: true, faces: 5, volume: 62.5457 },
        ])("should sweep a profile along an L-shaped path (isRound=$isRound)", ({
            isRound,
            faces,
            volume,
        }) => {
            const profile = unwrapOk(factory.wire([unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 1))]));
            const path = unwrapOk(
                factory.wire([
                    unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 0, y: 0, z: 10 }))),
                    unwrapOk(factory.line(new XYZ({ x: 0, y: 0, z: 10 }), new XYZ({ x: 10, y: 0, z: 10 }))),
                ]),
            );
            const result = factory.sweep([profile], path, isRound);
            expect(result.isOk).toBe(true);
            const shape = result.value;
            expect(shape.findSubShapes(ShapeTypes.face).length).toBe(faces);
            const solid = shape.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid;
            expect(solid.volume()).toBeCloseTo(volume, 3);
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

        test("should return error when sections are empty", () => {
            const result = factory.loft([], true, false, "c0");
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Failed to loft: at least 2 sections are required");
        });

        test("should throw when a section is not an OccShape", () => {
            const fakeSection = new MockShape({ shapeType: ShapeTypes.wire }) as unknown as IWire;
            expect(() => factory.loft([fakeSection], true, false, "c0")).toThrow(
                "The OCC kernel only supports OCC geometries.",
            );
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
            const fakeShape = new MockShape({ shapeType: ShapeTypes.edge }) as unknown as IShape;
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
            const fakeShape = new MockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape;
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
            const fakeShape = new MockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape;
            const result = factory.removeFillet(fakeShape, []);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Not OccShape");
        });

        test("should remove fillet faces and restore the original box", () => {
            const box = unwrapOk(factory.box(plane, 10, 10, 10));
            const boxVolume = (box.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid).volume();
            expect(boxVolume).toBeCloseTo(1000, 6);

            const filleted = unwrapOk(factory.fillet(box, [0, 1, 2, 3], 1));
            const filletedVolume = (
                filleted.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid
            ).volume();
            expect(filletedVolume).toBeLessThan(boxVolume);

            const filletFaces = filleted
                .findSubShapes(ShapeTypes.face)
                .map((f) => f as OccFace)
                .filter((f) => surfaceOfFace(f) instanceof OccCylindricalSurface);
            expect(filletFaces.length).toBe(4);

            const { shape, newEdges } = unwrapOk(factory.removeFillet(filleted, filletFaces));
            const restoredVolume = (shape.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid).volume();
            expect(restoredVolume).toBeCloseTo(boxVolume, 6);
            expect(shape.findSubShapes(ShapeTypes.face).length).toBe(6);
            expect(newEdges.length).toBe(16);
        });
    });

    describe("removeSubShape", () => {
        test("should remove a sub-shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const edges = box.findSubShapes(ShapeTypes.edge);
            expect(edges.length).toBeGreaterThan(0);
            // Removing one edge of a box succeeds
            const removeSubResult = factory.removeSubShape(box, [edges[0]]);
            expect(removeSubResult.isOk).toBe(true);
        });

        test("should fail when the sub-shape does not belong to the shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const otherBox = factory.box(plane, 10, 10, 10).value;
            const foreignEdge = otherBox.findSubShapes(ShapeTypes.edge)[0];

            const result = factory.removeSubShape(box, [foreignEdge]);
            expect(result.isOk).toBe(false);
            if (!result.isOk) {
                expect(result.error).toContain("Not remove anything");
            }
        });

        test("should keep the wires of the adjacent faces when removing an edge", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const edge = box.findSubShapes(ShapeTypes.edge)[0];
            const result = factory.removeSubShape(box, [edge]);
            expect(result.isOk).toBe(true);

            // The two adjacent faces are removed, but their wires
            // (with the remaining edges) are preserved.
            const shape = result.value;
            expect(shape.findSubShapes(ShapeTypes.face).length).toBe(4);
            expect(shape.findSubShapes(ShapeTypes.edge).length).toBe(11);
            expect(shape.findSubShapes(ShapeTypes.wire).length).toBe(6);
        });

        test("should return the remaining wire when removing an edge of a face", () => {
            const p1 = new XYZ({ x: 0, y: 0, z: 0 });
            const p2 = new XYZ({ x: 10, y: 0, z: 0 });
            const p3 = new XYZ({ x: 10, y: 10, z: 0 });
            const p4 = new XYZ({ x: 0, y: 10, z: 0 });
            const edges = [
                unwrapOk(factory.line(p1, p2)) as IEdge,
                unwrapOk(factory.line(p2, p3)) as IEdge,
                unwrapOk(factory.line(p3, p4)) as IEdge,
                unwrapOk(factory.line(p4, p1)) as IEdge,
            ];
            const wire = unwrapOk(factory.wire(edges)) as IWire;
            const face = unwrapOk(factory.face([wire]));

            const edge = face.findSubShapes(ShapeTypes.edge)[0];
            const result = factory.removeSubShape(face, [edge]);
            expect(result.isOk).toBe(true);

            // The face is removed, its wire keeps the remaining three edges.
            const shape = result.value;
            expect(shape.findSubShapes(ShapeTypes.face).length).toBe(0);
            expect(shape.findSubShapes(ShapeTypes.wire).length).toBe(1);
            expect(shape.findSubShapes(ShapeTypes.edge).length).toBe(3);
        });
    });

    describe("replaceSubShape", () => {
        test("should replace a sub-shape", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const edges = box.findSubShapes(ShapeTypes.edge);
            // Replacing one edge of a box with another succeeds
            const replaceResult = factory.replaceSubShapes(box, [edges[0]], [edges[1]]);
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
            // Sewing two boxes succeeds
            const box1 = factory.box(plane, 10, 10, 10).value;
            const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
            const sewResult = factory.sewing([box1, box2]);
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
            // Thickening a box by joining on one face succeeds
            const thickJoinResult = factory.makeThickSolidByJoin(box, [faces[0] as IFace], 0.5, "arc");
            expect(thickJoinResult.isOk).toBe(true);
        });

        test.each([
            { mode: "skin", intersection: false },
            { mode: "pipe", intersection: false },
            { mode: "rectoVerso", intersection: true },
        ] as const)("should create a thick solid with $mode mode, intersection=$intersection", ({
            mode,
            intersection,
        }) => {
            const box = factory.box(plane, 10, 10, 10).value;
            const faces = box.findSubShapes(ShapeTypes.face);
            const thickJoinResult = factory.makeThickSolidByJoin(
                box,
                [faces[0] as IFace],
                0.5,
                "arc",
                mode,
                intersection,
            );
            expect(thickJoinResult.isOk).toBe(true);
        });
    });

    describe("curveProjection", () => {
        test("should project a curve onto a face", () => {
            const box = factory.box(plane, 10, 10, 10).value;
            const topFace = box.findSubShapes(ShapeTypes.face)[4]; // typically top face
            const curve = factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })).value;
            // Projecting a line onto a box face along Z succeeds
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

        test("should simplify a splited shape", () => {
            const face = factory.rect(Plane.XY, 10, 10).value;
            expect(face.findSubShapes(ShapeTypes.edge).length).toBe(4);

            const edge = factory.line({ x: 5, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }).value;
            const splited = face.split([edge], 1e-6);
            expect(splited.findSubShapes(ShapeTypes.edge).length).toBe(6);

            const simplify = factory.simplifyShape(splited, true, true, [], 1e-6, 1e-6);
            expect(simplify.isOk).toBe(true);
            expect(simplify.value.shapeType).toBe(ShapeTypes.face);
            expect(simplify.value.findSubShapes(ShapeTypes.wire).length).toBe(1);
            expect(simplify.value.findSubShapes(ShapeTypes.edge).length).toBe(4);
        });

        test("should remove non-kept shared edges when kept edges lie between two same-domain faces", () => {
            // An outer face with a rectangular hole plus an inner face filling the hole,
            // sewn together so the two faces share the 4 hole edges.
            const holeWirePoints: XYZLike[] = [
                { x: 5, y: 5, z: 0 },
                { x: 15, y: 5, z: 0 },
                { x: 15, y: 15, z: 0 },
                { x: 5, y: 15, z: 0 },
                { x: 5, y: 5, z: 0 },
            ];
            const outerWire = factory.polygon([
                { x: 0, y: 0, z: 0 },
                { x: 20, y: 0, z: 0 },
                { x: 20, y: 20, z: 0 },
                { x: 0, y: 20, z: 0 },
                { x: 0, y: 0, z: 0 },
            ]).value;
            const outerFace = factory.face([outerWire, factory.polygon(holeWirePoints).value]).value;
            const holeFace = factory.face([factory.polygon(holeWirePoints).value]).value;

            const sewn = factory.sewing([outerFace, holeFace]).value;
            expect(sewn.findSubShapes(ShapeTypes.face).length).toBe(2);
            expect(sewn.findSubShapes(ShapeTypes.edge).length).toBe(8);

            const holeEdges = sewn.findSubShapes(ShapeTypes.edge).filter((edge) =>
                edge.findSubShapes(ShapeTypes.vertex).every((vertex) => {
                    const p = (vertex as IVertex).point();
                    return p.x >= 5 - 1e-6 && p.x <= 15 + 1e-6 && p.y >= 5 - 1e-6 && p.y <= 15 + 1e-6;
                }),
            );
            expect(holeEdges.length).toBe(4);

            // Without keepShapes, all four shared edges are removed.
            const merged = factory.simplifyShape(sewn, true, true, [], 1e-6, 1e-6);
            expect(merged.isOk).toBe(true);
            expect(merged.value.findSubShapes(ShapeTypes.face).length).toBe(1);
            expect(merged.value.findSubShapes(ShapeTypes.edge).length).toBe(4);

            // Keeping 3 of the 4 shared edges must still remove the remaining one;
            // the kept edges stay as internal edges of the merged face.
            const kept = factory.simplifyShape(sewn, true, true, holeEdges.slice(0, 3), 1e-6, 1e-6);
            expect(kept.isOk).toBe(true);
            expect(kept.value.findSubShapes(ShapeTypes.face).length).toBe(1);
            expect(kept.value.findSubShapes(ShapeTypes.edge).length).toBe(7);
        });

        test("should remove non-kept hole edge when two holes are filled by same-size circular faces", () => {
            // A rectangular face with two circular holes, each filled by a circular face of
            // the same radius, sewn together so the hole edges are shared between faces.
            const outerWire = factory.polygon([
                { x: 0, y: 0, z: 0 },
                { x: 30, y: 0, z: 0 },
                { x: 30, y: 20, z: 0 },
                { x: 0, y: 20, z: 0 },
                { x: 0, y: 0, z: 0 },
            ]).value;
            const holeEdge1 = factory.circle(XYZ.unitZ, { x: 10, y: 10, z: 0 }, 3).value;
            const holeEdge2 = factory.circle(XYZ.unitZ, { x: 20, y: 10, z: 0 }, 3).value;
            const outerFace = factory.face([
                outerWire,
                factory.wire([holeEdge1]).value,
                factory.wire([holeEdge2]).value,
            ]).value;
            const disk1 = factory.face([
                factory.wire([factory.circle(XYZ.unitZ, { x: 10, y: 10, z: 0 }, 3).value]).value,
            ]).value;
            const disk2 = factory.face([
                factory.wire([factory.circle(XYZ.unitZ, { x: 20, y: 10, z: 0 }, 3).value]).value,
            ]).value;

            const sewn = factory.sewing([outerFace, disk1, disk2]).value;
            expect(sewn.findSubShapes(ShapeTypes.face).length).toBe(3);
            expect(sewn.findSubShapes(ShapeTypes.edge).length).toBe(6);

            const holeEdgeOf = (centerX: number) =>
                sewn.findSubShapes(ShapeTypes.edge).filter((edge) => {
                    const vertices = edge.findSubShapes(ShapeTypes.vertex);
                    if (vertices.length !== 1) return false;
                    const p = (vertices[0] as IVertex).point();
                    return Math.abs(Math.hypot(p.x - centerX, p.y - 10) - 3) < 1e-6;
                });
            const keptEdge = holeEdgeOf(10);
            const removedEdge = holeEdgeOf(20);
            expect(keptEdge.length).toBe(1);
            expect(removedEdge.length).toBe(1);

            const simplified = factory.simplifyShape(sewn, true, true, keptEdge, 1e-6, 1e-6);
            expect(simplified.isOk).toBe(true);
            expect(simplified.value.findSubShapes(ShapeTypes.face).length).toBe(2);
            expect(simplified.value.findSubShapes(ShapeTypes.edge).length).toBe(5);
            expect(holeEdgeOf(10)[0].isSame(keptEdge[0])).toBe(true);
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
        const fakeShape = new MockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape;
        expect(() => factory.removeSubShape(fakeShape, [])).toThrow(
            "OCC kernel only supports OCC geometries",
        );
    });

    test("should throw error on ensureOccShape with single non-OccShape", () => {
        const fakeShape = new MockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape;
        expect(() => factory.prism(fakeShape, new XYZ({ x: 1, y: 0, z: 0 }))).toThrow(
            "OCC kernel only supports OCC geometries",
        );
    });
});

// ============================================================================
// edge() method
// ============================================================================

describe("ShapeFactory — edge from curve", () => {
    test("should create edge from OccCurve", () => {
        const lineEdge = factory.line(XYZ.zero, XYZ.unitX).value;
        const curve = (lineEdge as OccEdge).curve;
        const edge = factory.edge(curve);
        expect(edge).toBeDefined();
        expect(edge.shapeType).toBe(ShapeTypes.edge);
    });

    test("should throw error when curve is not OccCurve", () => {
        const fakeCurve = { curveType: "line" } as any;
        expect(() => factory.edge(fakeCurve)).toThrow("Invalid curve");
    });
});

// ============================================================================
// removeFeature
// ============================================================================

describe("ShapeFactory — removeFeature", () => {
    test("should return error when shape is not OccShape", () => {
        const fakeShape = new MockShape({ shapeType: ShapeTypes.solid }) as unknown as IShape;
        const result = factory.removeFeature(fakeShape, []);
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Not OccShape");
    });

    test("should remove a fused boss and restore the base box", () => {
        const base = unwrapOk(factory.box(plane, 20, 20, 10));
        const boss = unwrapOk(
            factory.box(
                new Plane({
                    origin: new XYZ({ x: 5, y: 5, z: 10 }),
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                }),
                5,
                5,
                5,
            ),
        );
        const fused = unwrapOk(factory.booleanFuse([base], [boss], true));
        const fusedSolid = fused.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid;
        expect(fusedSolid.volume()).toBeCloseTo(4125, 6);

        // The boss contributes 5 faces of area 25 (4 sides + top)
        const bossFaces = fusedSolid
            .findSubShapes(ShapeTypes.face)
            .map((f) => f as OccFace)
            .filter((f) => Math.abs(f.area() - 25) < 1e-6);
        expect(bossFaces.length).toBe(5);

        const restored = unwrapOk(factory.removeFeature(fusedSolid, bossFaces));
        const restoredSolid = restored.findSubShapes(ShapeTypes.solid)[0] as unknown as OccSolid;
        expect(restoredSolid.volume()).toBeCloseTo(4000, 6);
        expect(restored.findSubShapes(ShapeTypes.face).length).toBe(6);
    });
});

// ============================================================================
// removeFillet — additional paths
// ============================================================================

describe("ShapeFactory — removeFillet additional", () => {
    test("should handle removeFillet on box with zero edges", () => {
        const box = factory.box(plane, 10, 10, 10).value;
        // A box has no fillets — nothing can be removed, so this returns an error
        const result = factory.removeFillet(box, []);
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Failed to remove fillet");
    });
});

// ============================================================================
// loft — edge sections (edge→wire conversion)
// ============================================================================

describe("ShapeFactory — loft with edge sections", () => {
    test("should loft with edge sections (auto wire conversion)", () => {
        const e1 = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
        const e2 = factory.circle(XYZ.unitZ, new XYZ({ x: 0, y: 0, z: 20 }), 8).value;
        // Pass edges directly — loft should convert them to wires
        const result = factory.loft([e1, e2], true, false, "c0");
        expect(result.isOk).toBe(true);
        expect(result.value.shapeType).toBe(ShapeTypes.solid);
    });

    test("should loft with mixed edge and wire sections", () => {
        const edge = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
        const c2 = factory.circle(XYZ.unitZ, new XYZ({ x: 0, y: 0, z: 20 }), 8).value;
        const wire = factory.wire([c2]).value;
        const result = factory.loft([edge, wire], true, false, "c0");
        expect(result.isOk).toBe(true);
    });
});

// ============================================================================
// 2D Fillet & Chamfer
// ============================================================================

describe("ShapeFactory — 2D fillet & chamfer", () => {
    const rectEdges = (dx = 10, dy = 10) => {
        const rect = factory.rect(plane, dx, dy).value;
        return rect.findSubShapes(ShapeTypes.edge) as IEdge[];
    };

    const edgesFromDifferentFaces = () => {
        const r1 = factory.rect(plane, 10, 10).value;
        const r2 = factory.rect(shiftedPlane, 10, 10).value;
        return {
            face: r1,
            edge1: r1.findSubShapes(ShapeTypes.edge)[0] as IEdge,
            edge2: r2.findSubShapes(ShapeTypes.edge)[0] as IEdge,
        };
    };

    describe("fillet2d", () => {
        test("should create a 2D fillet on a rect face", () => {
            const rect = factory.rect(plane, 10, 10).value as IFace;
            const edges = rect.findSubShapes(ShapeTypes.edge) as IEdge[];
            expect(edges.length).toBe(4);
            // Use two adjacent edges that share a corner vertex
            const result = factory.fillet2d(rect, edges[0], edges[1], 2);
            expect(result.isOk).toBe(true);
            const filletedFace = result.value;
            expect(filletedFace.shapeType).toBe(ShapeTypes.face);
        });

        test("should return error when radius is too small", () => {
            const rect = factory.rect(plane, 10, 10).value as IFace;
            const edges = rect.findSubShapes(ShapeTypes.edge) as IEdge[];
            const result = factory.fillet2d(rect, edges[0], edges[1], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The radius is too small.");
        });

        test("should return error when edges don't share a common vertex", () => {
            const { face, edge1, edge2 } = edgesFromDifferentFaces();
            const result = factory.fillet2d(face, edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must share a common vertex");
        });
    });

    describe("chamfer2d", () => {
        test("should create a 2D chamfer on a rect face", () => {
            const rect = factory.rect(plane, 10, 10).value as IFace;
            const edges = rect.findSubShapes(ShapeTypes.edge) as IEdge[];
            const result = factory.chamfer2d(rect, edges[0], edges[1], 2);
            expect(result.isOk).toBe(true);
            const chamferedFace = result.value as IFace;
            expect(chamferedFace.shapeType).toBe(ShapeTypes.face);
        });

        test("should return error when distance is too small", () => {
            const rect = factory.rect(plane, 10, 10).value as IFace;
            const edges = rect.findSubShapes(ShapeTypes.edge) as IEdge[];
            const result = factory.chamfer2d(rect, edges[0], edges[1], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The distance is too small.");
        });

        test("should return error when edges are from different faces", () => {
            const { face, edge1, edge2 } = edgesFromDifferentFaces();
            const result = factory.chamfer2d(face, edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Failed to create 2D chamfer");
        });
    });

    describe("filletEdge2d", () => {
        // Two coplanar segments with a gap: the support lines meet at (5, 5, 0).
        const disjointEdges = () => ({
            edge1: factory.line(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 })).value,
            edge2: factory.line(new XYZ({ x: 5, y: 0, z: 0 }), new XYZ({ x: 5, y: 3, z: 0 })).value,
        });

        test("should create 2D fillet edges from two adjacent edges", () => {
            const edges = rectEdges();
            const result = factory.filletEdge2d(edges[0], edges[1], 2);
            expect(result.isOk).toBe(true);
            const filletEdges = result.value;
            expect(filletEdges.length).toBe(3);
            for (const e of filletEdges) {
                expect(e.shapeType).toBe(ShapeTypes.edge);
            }
        });

        test("should return error when radius is too small", () => {
            const edges = rectEdges();
            const result = factory.filletEdge2d(edges[0], edges[1], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The radius is too small.");
        });

        test("should fillet two disjoint but coplanar edges", () => {
            const { edge1, edge2 } = disjointEdges();
            const result = factory.filletEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(true);
            const filletEdges = result.value;
            expect(filletEdges.length).toBe(3);
            for (const e of filletEdges) {
                expect((e as unknown as OccEdge).length()).toBeGreaterThan(0);
            }
        });

        test("should extend edges whose corner lies outside both segments", () => {
            // Support lines meet at (14, 0, 0), outside both segments.
            const edge1 = factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 14, y: 0, z: 0 }), new XYZ({ x: 14, y: 8, z: 0 })).value;
            const result = factory.filletEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(true);
            const filletEdges = result.value;
            expect(filletEdges.length).toBe(3);
            // edge1 is extended past x=10 up to the tangent point at x=12
            expect((filletEdges[0] as unknown as OccEdge).length()).toBeGreaterThan(10);
            // edge2 is trimmed from the corner side: from y=2 to y=8
            expect((filletEdges[2] as unknown as OccEdge).length()).toBeLessThan(8);
        });

        test("should keep the longer side when the corner coincides with an edge start", () => {
            const edge1 = factory.line(XYZ.zero, { x: 100, y: 0, z: 0 }).value;
            const edge2 = factory.line({ x: 3, y: -3, z: 0 }, { x: 100, y: -100, z: 0 }).value;
            const result1 = factory.filletEdge2d(edge1, edge2, 5);
            expect(result1.isOk).toBe(true);
            expect(result1.value[0].length()).toBeGreaterThan(60);
            expect(result1.value[2].length()).toBeGreaterThan(60);

            const edge3 = factory.line({ x: 3, y: -3, z: 0 }, { x: -100, y: 100, z: 0 }).value;
            const result2 = factory.filletEdge2d(edge1, edge3, 5);
            expect(result2.isOk).toBe(true);
            expect(result2.value[0].length()).toBeGreaterThan(60);
            expect(result2.value[2].length()).toBeGreaterThan(60);
        });

        test("should keep the longer side when edges cross", () => {
            // Support lines meet at the origin, cutting both segments in two.
            const edge1 = factory.line(new XYZ({ x: -2, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: -8, z: 0 }), new XYZ({ x: 0, y: 1, z: 0 })).value;
            const result = factory.filletEdge2d(edge1, edge2, 1);
            expect(result.isOk).toBe(true);
            const filletEdges = result.value;
            expect(filletEdges.length).toBe(3);
            // longer side of edge1 is [0, 10], tangent at x=1 -> length 9
            expect((filletEdges[0] as unknown as OccEdge).length()).toBeCloseTo(9, 5);
            // longer side of edge2 is [-8, 0], tangent at y=-1 -> length 7
            expect((filletEdges[2] as unknown as OccEdge).length()).toBeCloseTo(7, 5);
        });

        test("should fillet offset edges at their offset position", () => {
            // Offsetting along Z shifts in-plane: edge1 to y=-2, edge2 to x=2.
            // The support lines meet at (2, -2, 0), inside edge1, outside edge2.
            const edge1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
            const edge2 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 0, y: 10, z: 0 }))) as OccEdge;
            const offset1 = unwrapOk(edge1.offset(2, XYZ.unitZ)) as OccEdge;
            const offset2 = unwrapOk(edge2.offset(2, XYZ.unitZ)) as OccEdge;
            const result = factory.filletEdge2d(offset1, offset2, 1);
            expect(result.isOk).toBe(true);
            const filletEdges = result.value;
            expect(filletEdges.length).toBe(3);
            // tangent points at (3, -2, 0) and (2, -1, 0): kept sides lie on the offset lines
            const newE1 = filletEdges[0] as unknown as OccEdge;
            expect(newE1.length()).toBeCloseTo(7, 5);
            expect(newE1.curve.startPoint().y).toBeCloseTo(-2, 5);
            expect(newE1.curve.endPoint().y).toBeCloseTo(-2, 5);
            const newE2 = filletEdges[2] as unknown as OccEdge;
            expect(newE2.length()).toBeCloseTo(11, 5);
            expect(newE2.curve.startPoint().x).toBeCloseTo(2, 5);
            expect(newE2.curve.endPoint().x).toBeCloseTo(2, 5);
        });

        test("should return error when edges are parallel", () => {
            const edge1 = factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 })).value;
            const result = factory.filletEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must not be parallel");
        });

        test("should return error when edges are not coplanar", () => {
            const edge1 = factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 0, y: 10, z: 5 })).value;
            const result = factory.filletEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must be coplanar");
        });

        test("should return error when edges are not line", () => {
            const edge1 = factory.circle(XYZ.unitZ, XYZ.zero, 5).value;
            const edge2 = factory.circle(XYZ.unitZ, new XYZ({ x: 20, y: 0, z: 0 }), 5).value;
            const result = factory.filletEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must be Line");
        });
    });

    describe("chamferEdge2d", () => {
        test("should create 2D chamfer edges from two adjacent edges", () => {
            const edges = rectEdges();
            const result = factory.chamferEdge2d(edges[0], edges[1], 2);
            expect(result.isOk).toBe(true);
            const chamferEdges = result.value;
            expect(chamferEdges.length).toBe(3);
            for (const e of chamferEdges) {
                expect(e.shapeType).toBe(ShapeTypes.edge);
            }
        });

        test("should return error when distance is too small", () => {
            const edges = rectEdges();
            const result = factory.chamferEdge2d(edges[0], edges[1], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The distance is too small.");
        });

        test("should return non-degenerate edges after chamfer", () => {
            const edges = rectEdges();
            const result = factory.chamferEdge2d(edges[0], edges[1], 2);
            expect(result.isOk).toBe(true);
            // The result should have 3 edges with non-zero length
            const chamferEdges = result.value;
            expect(chamferEdges.length).toBe(3);
            for (const e of chamferEdges) {
                expect(e.shapeType).toBe(ShapeTypes.edge);
                // Each edge should have a non-trivial length
                const occEdge = e as unknown as OccEdge;
                expect(occEdge.length()).toBeGreaterThan(0);
            }
        });

        test("should chamfer two disjoint but coplanar edges", () => {
            const edge1 = factory.line(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 5, y: 0, z: 0 }), new XYZ({ x: 5, y: 3, z: 0 })).value;
            const result = factory.chamferEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(true);
            const chamferEdges = result.value;
            expect(chamferEdges.length).toBe(3);
            for (const e of chamferEdges) {
                expect((e as unknown as OccEdge).length()).toBeGreaterThan(0);
            }
        });

        test("should keep the longer side when edges cross", () => {
            // Support lines meet at the origin, cutting both segments in two.
            const edge1 = factory.line(new XYZ({ x: -2, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: -8, z: 0 }), new XYZ({ x: 0, y: 1, z: 0 })).value;
            const result = factory.chamferEdge2d(edge1, edge2, 1);
            expect(result.isOk).toBe(true);
            const chamferEdges = result.value;
            expect(chamferEdges.length).toBe(3);
            // longer side of edge1 is [0, 10], cut at x=1 -> length 9
            expect((chamferEdges[0] as unknown as OccEdge).length()).toBeCloseTo(9, 5);
            // longer side of edge2 is [-8, 0], cut at y=-1 -> length 7
            expect((chamferEdges[2] as unknown as OccEdge).length()).toBeCloseTo(7, 5);
        });

        test("should chamfer offset edges at their offset position", () => {
            // Offsetting along Z shifts in-plane: edge1 to y=-2, edge2 to x=2.
            // The support lines meet at (2, -2, 0), inside edge1, outside edge2.
            const edge1 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }))) as OccEdge;
            const edge2 = unwrapOk(factory.line(XYZ.zero, new XYZ({ x: 0, y: 10, z: 0 }))) as OccEdge;
            const offset1 = unwrapOk(edge1.offset(2, XYZ.unitZ)) as OccEdge;
            const offset2 = unwrapOk(edge2.offset(2, XYZ.unitZ)) as OccEdge;
            const result = factory.chamferEdge2d(offset1, offset2, 1);
            expect(result.isOk).toBe(true);
            const chamferEdges = result.value;
            expect(chamferEdges.length).toBe(3);
            // cut points at (3, -2, 0) and (2, -1, 0) on the offset lines
            const newE1 = chamferEdges[0] as unknown as OccEdge;
            expect(newE1.length()).toBeCloseTo(7, 5);
            expect(newE1.curve.startPoint().y).toBeCloseTo(-2, 5);
            expect(newE1.curve.endPoint().y).toBeCloseTo(-2, 5);
            const chamferEdge = chamferEdges[1] as unknown as OccEdge;
            expect(chamferEdge.length()).toBeCloseTo(Math.SQRT2, 5);
            const newE2 = chamferEdges[2] as unknown as OccEdge;
            expect(newE2.length()).toBeCloseTo(11, 5);
            expect(newE2.curve.startPoint().x).toBeCloseTo(2, 5);
            expect(newE2.curve.endPoint().x).toBeCloseTo(2, 5);
        });

        test("should return error when edges are parallel", () => {
            const edge1 = factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 })).value;
            const result = factory.chamferEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must not be parallel");
        });

        test("should return error when edges are not coplanar", () => {
            const edge1 = factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })).value;
            const edge2 = factory.line(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 0, y: 10, z: 5 })).value;
            const result = factory.chamferEdge2d(edge1, edge2, 2);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Edges must be coplanar");
        });
    });
});
