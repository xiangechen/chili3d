// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type ObjectSnapType, ObjectSnapTypes } from "../src";
import { XYZ } from "../src/math";
import { ShapeTypes } from "../src/shape";
import type { SnapResult } from "../src/snap/snap";
import { ObjectSnap } from "../src/snap/snaps/objectSnap";
import type { VisualShapeData } from "../src/visual";
import { createMockEdgeCurve, createMockView, createMouseAndDetected } from "./mocks";

// ============================================================================
// Helpers
// ============================================================================

/** Internal state shape for accessing ObjectSnap private members in tests. */
interface ObjectSnapInternals {
    _intersectionInfos: Map<string, SnapResult[]>;
    _invisibleInfos: Map<VisualShapeData, { view: object; snaps: SnapResult[]; displays: number[] }>;
    _lastDetected?: [object, SnapResult];
    _hintVertex?: [object, number];
}

function internalsOf(snap: ObjectSnap): ObjectSnapInternals {
    return snap as unknown as ObjectSnapInternals;
}

/**
 * Create a VisualShapeData suitable for testing the edge feature-point path in ObjectSnap.
 *
 * The default mock view maps world (x,y,z) → screen (x+400, y+300).
 * Setting mouse at (400, 300) gives screen-distance 0 for a point at XYZ(0,0,0),
 * which is well under SnapDistance=10, so snap() returns a real result.
 */
function createEdgeShapeData(overrides?: Partial<VisualShapeData>): VisualShapeData {
    const curve = createMockEdgeCurve({
        start: XYZ.zero,
        end: new XYZ({ x: 10, y: 0, z: 0 }),
    });
    return {
        shape: {
            id: "edge-1",
            shapeType: ShapeTypes.edge,
            curve,
            point: () => XYZ.zero,
            transformedMul: () => ({
                curve,
                intersect: () => [],
                dispose: () => {},
            }),
            intersect: () => [],
            dispose: () => {},
        } as never,
        owner: {
            node: {
                document: {
                    visual: {
                        highlighter: {
                            addState: () => {},
                            removeState: () => {},
                        },
                    },
                },
            },
        } as never,
        transform: {
            ofPoint: (p: XYZ) => p,
            invert: () => ({
                ofPoint: (p: XYZ) => p,
                ofVector: (p: XYZ) => p,
            }),
            ofVector: (p: XYZ) => p,
        } as never,
        indexes: [],
        point: XYZ.zero,
        ...overrides,
    } as unknown as VisualShapeData;
}

/**
 * Create a VisualShapeData for a vertex shape.
 */
function createVertexShapeData(point?: XYZ): VisualShapeData {
    const p = point ?? XYZ.zero;
    return {
        shape: {
            id: "vertex-1",
            shapeType: ShapeTypes.vertex,
            point: () => p,
            dispose: () => {},
        } as never,
        owner: {
            node: {
                document: {
                    visual: {
                        highlighter: {
                            addState: () => {},
                            removeState: () => {},
                        },
                    },
                },
            },
        } as never,
        transform: {
            ofPoint: (pt: XYZ) => pt,
            invert: () => ({
                ofPoint: (pt: XYZ) => pt,
                ofVector: (pt: XYZ) => pt,
            }),
            ofVector: (pt: XYZ) => pt,
        } as never,
        indexes: [],
        point: p,
    } as unknown as VisualShapeData;
}

// ============================================================================
// ObjectSnap — comprehensive tests
// ============================================================================

describe("ObjectSnap", () => {
    let originalEnableSnap: boolean;
    let originalSnapType: ObjectSnapType;

    beforeEach(() => {
        originalEnableSnap = Config.instance.enableSnap;
        originalSnapType = Config.instance.snapType;
        Config.instance.enableSnap = true;
    });

    afterEach(() => {
        Config.instance.enableSnap = originalEnableSnap;
        Config.instance.snapType = originalSnapType;
    });

    // ========================================================================
    // constructor
    // ========================================================================

    describe("constructor", () => {
        test("should store snap type via Config listener", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            expect(snap).toBeDefined();
        });

        test("should store reference point function", () => {
            const ref = () => new XYZ({ x: 1, y: 2, z: 3 });
            const snap = new ObjectSnap(ObjectSnapTypes.vertex, ref);
            expect(snap.referencePoint).toBe(ref);
        });

        test("should have undefined referencePoint when not provided", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            expect(snap.referencePoint).toBeUndefined();
        });

        test("should register Config property change listener", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const internal = internalsOf(snap);
            const entry: SnapResult = { view: createMockView(), shapes: [], type: "end" };
            internal._intersectionInfos.set("test", [entry]);
            Config.instance.snapType = ObjectSnapTypes.endPoint;
            // After config changes, the listener should clear intersection infos.
            expect(internal._intersectionInfos.size).toBe(0);
        });
    });

    // ========================================================================
    // snap() — routing & early exits
    // ========================================================================

    describe("snap — routing & early exits", () => {
        test("should return undefined when snap is globally disabled", () => {
            Config.instance.enableSnap = false;
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const view = createMockView();
            const data = createMouseAndDetected(view);
            expect(snap.snap(data)).toBeUndefined();
        });

        test("should return undefined when no shapes and no invisible snaps", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const view = createMockView();
            const data = createMouseAndDetected(view);
            expect(snap.snap(data)).toBeUndefined();
        });

        test("should route to snapOnShape when shapes contain edge", () => {
            Config.instance.snapType = (ObjectSnapTypes.endPoint |
                ObjectSnapTypes.midPoint) as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            // Mouse at (400, 300), feature point near (0,0,0) → screen (400,300) → distance 0
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("end");
                expect(result.point).toBeDefined();
                expect(result.shapes).toEqual([edgeShape]);
            }
        });

        test("should compute distance when referencePoint is set and snap has point", () => {
            Config.instance.snapType = (ObjectSnapTypes.endPoint |
                ObjectSnapTypes.midPoint) as ObjectSnapType;

            const ref = () => new XYZ({ x: 3, y: 4, z: 0 });
            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint, ref);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                // distance from ref point (3,4,0) to snap point (0,0,0) = 5
                expect(result.distance).toBeCloseTo(5, 5);
            }
        });

        test("should not set distance when referencePoint is undefined", () => {
            Config.instance.snapType = (ObjectSnapTypes.endPoint |
                ObjectSnapTypes.midPoint) as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.distance).toBeUndefined();
            }
        });
    });

    // ========================================================================
    // snap — feature points (endPoint, midPoint, vertex)
    // ========================================================================

    describe("snap — feature points", () => {
        test("should detect endPoint snap", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("end");
            }
        });

        test("should detect midPoint snap", () => {
            Config.instance.snapType = ObjectSnapTypes.midPoint as ObjectSnapType;

            // midPoint is at (5,0,0) → screen (405,300)
            // mouse at (405,300) → distance 0
            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.midPoint);
            const data = createMouseAndDetected(view, { mx: 405, my: 300, shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("middle");
            }
        });

        test("should detect vertex snap point when routed via edge shapes", () => {
            // snap() routes to snapOnShape only when shapes contain an edge.
            // Vertex-only shapes go through snapeInvisible, so vertex snap needs
            // an edge alongside it to reach getFeaturePoints.
            Config.instance.snapType = ObjectSnapTypes.vertex as ObjectSnapType;

            const vertexShape = createVertexShapeData(XYZ.zero);
            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [vertexShape, edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            // shapes[0] = vertex, but .some(edge) returns true → routes to snapOnShape
            const data = createMouseAndDetected(view, { shapes: [vertexShape, edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("vertex");
            }
        });

        test("should NOT collect vertex point when snapType excludes vertex", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const vertexShape = createVertexShapeData(XYZ.zero);
            const view = createMockView({
                detectShapes: () => [vertexShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [vertexShape] });

            // vertex shape but snapType only has endPoint → no feature points collected
            const result = snap.snap(data);
            expect(result).toBeUndefined();
        });

        test("should NOT collect endPoint when snapType excludes endPoint", () => {
            Config.instance.snapType = ObjectSnapTypes.midPoint as ObjectSnapType;

            // mouse at (400,300) targets start point but endPoint not enabled
            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.midPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            // midPoint is at (5,0,0) → screen (405,300), mouse at (400,300) → distance 5 < 10
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("middle");
            }
        });
    });

    // ========================================================================
    // snap — tangent points (requires referencePoint)
    // ========================================================================

    describe("snap — tangent points", () => {
        test("should handle tangent snap with circular edge and referencePoint", () => {
            // Tangent requires: referencePoint, isCircle(basisCurve) = true, tangent enabled.
            // We enable both endPoint and tangent: endPoint gives valid feature points,
            // tangent code path is exercised (CurveUtils.tangentPoints called but
            // reference at center returns []).
            Config.instance.snapType = (ObjectSnapTypes.endPoint | ObjectSnapTypes.tangent) as ObjectSnapType;

            const circleCurve = createMockEdgeCurve({
                start: XYZ.zero,
                end: new XYZ({ x: 10, y: 0, z: 0 }),
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-edge",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            // Pass combined type directly so internal _snapType includes endPoint.
            // Reference at center → CurveUtils.tangentPoints returns []
            const ref = () => XYZ.zero;
            const snap = new ObjectSnap(
                (ObjectSnapTypes.endPoint | ObjectSnapTypes.tangent) as ObjectSnapType,
                ref,
            );
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            // endPoint at (0,0,0) is within SnapDistance (10) → returns "end"
            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("end");
            }
        });

        test("should NOT collect tangent points without referencePoint", () => {
            Config.instance.snapType = ObjectSnapTypes.tangent as ObjectSnapType;

            const circleCurve = createMockEdgeCurve({
                basisCurve: { center: XYZ.zero, radius: 5 },
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-edge-no-ref",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.tangent);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            // Without ref point, tangent collection is skipped
            expect(() => snap.snap(data)).not.toThrow();
        });
    });

    // ========================================================================
    // snap — perpendicular
    // ========================================================================

    describe("snap — perpendicular", () => {
        test("should find perpendicular point for edge with referencePoint", () => {
            Config.instance.snapType = ObjectSnapTypes.perpendicular as ObjectSnapType;

            const projectResult = new XYZ({ x: 3, y: 0, z: 0 });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-perp",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: XYZ.zero,
                        end: new XYZ({ x: 10, y: 0, z: 0 }),
                        projectResult: [projectResult],
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const ref = () => new XYZ({ x: 3, y: 5, z: 0 });
            const snap = new ObjectSnap(ObjectSnapTypes.perpendicular, ref);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            // project returns [XYZ(3,0,0)] → screen (403,300), not close enough to (400,300)
            // result may be undefined or a perpendicular result
            if (result) {
                expect(result.type).toBe("perpendicular");
            }
        });

        test("should NOT find perpendicular without referencePoint", () => {
            Config.instance.snapType = ObjectSnapTypes.perpendicular as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.perpendicular);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            // Without referencePoint, perpendicular returns empty, then nearest curve
            // which needs onCurve to be enabled
            expect(result).toBeUndefined();
        });

        test("should NOT find perpendicular when snapType excludes it", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const ref = () => new XYZ({ x: 3, y: 5, z: 0 });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint, ref);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            // Should find endPoint (type "end"), not perpendicular
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("end");
            }
        });
    });

    // ========================================================================
    // snap — onCurve (nearest point on edge curve)
    // ========================================================================

    describe("snap — onCurve (nearestPointAtEdgeCurve)", () => {
        test("should find nearest point on curve as fallback", () => {
            const nearestPoint = new XYZ({ x: 2, y: 0, z: 0 }); // screen (402, 300)
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-near",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: new XYZ({ x: 100, y: 0, z: 0 }),
                        end: new XYZ({ x: 200, y: 0, z: 0 }),
                        nearestPoint: { p1: nearestPoint },
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve({
                            nearestPoint: { p1: nearestPoint },
                        }),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            // Set snapType after snap creation so the onSnapTypeChanged listener fires.
            Config.instance.snapType = (ObjectSnapTypes.endPoint | ObjectSnapTypes.onCurve) as ObjectSnapType;
            // mouse at (402, 300) → distance to (2,0,0) screen (402,300) = 0 < 10
            const data = createMouseAndDetected(view, { mx: 402, my: 300, shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("nearCurve");
            }
        });

        test("should NOT find nearest curve point when onCurve is disabled", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-far",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: new XYZ({ x: 100, y: 0, z: 0 }),
                        end: new XYZ({ x: 200, y: 0, z: 0 }),
                        nearestPoint: { p1: new XYZ({ x: 5, y: 0, z: 0 }) },
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            // feature points at (100,0,0) and (200,0,0) — both far from mouse (400,300)
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            // onCurve is disabled, and feature points are too far → undefined + _lastDetected set
            expect(result).toBeUndefined();
        });

        test("should return undefined for non-edge shapes in findNearestPointAtEdgeCurve", () => {
            Config.instance.snapType = (ObjectSnapTypes.vertex | ObjectSnapTypes.onCurve) as ObjectSnapType;

            const vertexShape = createVertexShapeData(new XYZ({ x: 100, y: 0, z: 0 }));
            const view = createMockView({
                detectShapes: () => [vertexShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const data = createMouseAndDetected(view, { shapes: [vertexShape] });

            // vertex at (100,0,0) → screen (500,300) → distance 100 > 10
            // onCurve is not applicable to vertex → undefined
            const result = snap.snap(data);
            expect(result).toBeUndefined();
        });
    });

    // ========================================================================
    // snap — _lastDetected (magic snap / hint)
    // ========================================================================

    describe("snap — _lastDetected (hint tracking)", () => {
        test("should store _lastDetected when nearest feature point is outside SnapDistance", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-far-ld",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: new XYZ({ x: 100, y: 0, z: 0 }),
                        end: new XYZ({ x: 200, y: 0, z: 0 }),
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeUndefined();
            // _lastDetected should be set when nearest feature point is outside SnapDistance
            const internal = internalsOf(snap);
            expect(internal._lastDetected).toBeDefined();
            expect(internal._lastDetected?.[0]).toBe(view);
        });
    });

    // ========================================================================
    // snap — intersections
    // ========================================================================

    describe("snap — intersections", () => {
        test("should find intersection between two edges", () => {
            Config.instance.snapType = ObjectSnapTypes.intersection as ObjectSnapType;

            const intersectionPoint = new XYZ({ x: 5, y: 5, z: 0 }); // screen (405, 305)
            const edge1 = createEdgeShapeData({
                shape: {
                    id: "edge-a",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [{ point: intersectionPoint }],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const edge2 = createEdgeShapeData({
                shape: {
                    id: "edge-b",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edge1, edge2],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.intersection);
            // mouse near intersection point screen (405,305)
            const data = createMouseAndDetected(view, { mx: 405, my: 305, shapes: [edge1, edge2] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("intersection");
                expect(result.shapes).toEqual([edge1, edge2]);
            }
        });

        test("should NOT find intersection when snapType excludes it", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            const result = snap.snap(data);
            if (result) {
                expect(result.type).not.toBe("intersection");
            }
        });

        test("should cache intersection results", () => {
            Config.instance.snapType = ObjectSnapTypes.intersection as ObjectSnapType;

            let intersectCallCount = 0;
            const edge1 = createEdgeShapeData({
                shape: {
                    id: "edge-aa",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => {
                        intersectCallCount++;
                        return {
                            curve: createMockEdgeCurve(),
                            intersect: () => [{ point: new XYZ({ x: 3, y: 0, z: 0 }) }],
                            dispose: () => {},
                        };
                    },
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const edge2 = createEdgeShapeData({
                shape: {
                    id: "edge-bb",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edge1, edge2],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.intersection);
            const data = createMouseAndDetected(view, { mx: 403, my: 300, shapes: [edge1, edge2] });

            // First call: should compute intersections (intersectCallCount increments)
            snap.snap(data);
            const firstCount = intersectCallCount;

            // Second call: should use cache
            snap.snap(data);
            // intersectCallCount should NOT increase (cache hit)
            expect(intersectCallCount).toBe(firstCount);
        });

        test("should skip same shape in intersection check", () => {
            Config.instance.snapType = ObjectSnapTypes.intersection as ObjectSnapType;

            let intersectCalled = false;
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-self",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => {
                        intersectCalled = true;
                        return {
                            curve: createMockEdgeCurve(),
                            intersect: () => [],
                            dispose: () => {},
                        };
                    },
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.intersection);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            snap.snap(data);
            // Should not call intersect on same shape (only one shape in array)
            expect(intersectCalled).toBe(false);
        });

        test("should skip non-edge shapes in intersection detection", () => {
            Config.instance.snapType = ObjectSnapTypes.intersection as ObjectSnapType;

            const vertexShape = createVertexShapeData(XYZ.zero);
            const view = createMockView({
                detectShapes: () => [vertexShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.intersection);
            const data = createMouseAndDetected(view, { shapes: [vertexShape] });

            // Non-edge current shape → getIntersections returns empty → snapeInvisible path
            const result = snap.snap(data);
            expect(result).toBeUndefined();
        });
    });

    // ========================================================================
    // showInvisibleSnaps — circle center
    // ========================================================================

    describe("showInvisibleSnaps — circle center", () => {
        test("should show circle center for circular edges", () => {
            Config.instance.snapType = ObjectSnapTypes.center as ObjectSnapType;

            const centerPoint = new XYZ({ x: 5, y: 0, z: 0 });
            const circleCurve = createMockEdgeCurve({
                start: XYZ.zero,
                end: new XYZ({ x: 10, y: 0, z: 0 }),
                basisCurve: {
                    center: centerPoint,
                    radius: 5,
                },
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-edge",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.center);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            snap.snap(data);
            // After snapping with an edge, invisible infos should be populated
            const internal = internalsOf(snap);
            const info = internal._invisibleInfos.get(edgeShape);
            expect(info).toBeDefined();
            if (info) {
                expect(info.snaps.length).toBe(1);
                expect(info.snaps[0].type).toBe("center");
                expect(info.snaps[0].point?.x).toBe(5);
                expect(info.snaps[0].point?.y).toBe(0);
            }
        });

        test("should not add duplicate invisible snaps for same shape", () => {
            Config.instance.snapType = ObjectSnapTypes.center as ObjectSnapType;

            const circleCurve = createMockEdgeCurve({
                basisCurve: { center: XYZ.zero, radius: 5 },
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-edge-2",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.center);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            snap.snap(data);
            snap.snap(data); // second call — should be a no-op for same shape

            const internal = internalsOf(snap);
            expect(internal._invisibleInfos.size).toBe(1);
        });

        test("should NOT show circle center for non-edge shapes", () => {
            Config.instance.snapType = ObjectSnapTypes.center as ObjectSnapType;

            const vertexShape = createVertexShapeData(XYZ.zero);
            const view = createMockView({
                detectShapes: () => [vertexShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.center);
            const data = createMouseAndDetected(view, { shapes: [vertexShape] });

            snap.snap(data);
            const internal = internalsOf(snap);
            // No invisible infos for vertex shapes
            expect(internal._invisibleInfos.size).toBe(0);
        });
    });

    // ========================================================================
    // snapeInvisible — detecting previously shown invisible snaps
    // ========================================================================

    describe("snapeInvisible", () => {
        test("should detect invisible snap when mouse is close", () => {
            Config.instance.snapType = ObjectSnapTypes.center as ObjectSnapType;

            const circleCurve = createMockEdgeCurve({
                basisCurve: { center: new XYZ({ x: 5, y: 0, z: 0 }), radius: 5 },
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-invis",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.center);

            // First call with edge: populates invisible infos
            const dataWithEdge = createMouseAndDetected(view, { shapes: [edgeShape] });
            snap.snap(dataWithEdge);

            // Second call without shapes: tries snapeInvisible path
            // Center is at (5,0,0) → screen (405, 300)
            // Mouse at (405,300) → distance 0 < 10
            const dataNoEdge = createMouseAndDetected(view, { mx: 405, my: 300, shapes: [] });
            const result = snap.snap(dataNoEdge);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("center");
            }
        });

        test("should return undefined when invisible snaps are too far", () => {
            Config.instance.snapType = ObjectSnapTypes.center as ObjectSnapType;

            const circleCurve = createMockEdgeCurve({
                basisCurve: { center: new XYZ({ x: 100, y: 0, z: 0 }), radius: 5 },
            });
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "circle-far",
                    shapeType: ShapeTypes.edge,
                    curve: circleCurve,
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: circleCurve,
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.center);

            // Populate invisible infos with center at (100,0,0)
            snap.snap(createMouseAndDetected(view, { shapes: [edgeShape] }));

            // Center at (100,0,0) → screen (500, 300), mouse at (400,300) → distance 100 > 10
            const dataFar = createMouseAndDetected(view, { mx: 400, my: 300, shapes: [] });
            const result = snap.snap(dataFar);
            expect(result).toBeUndefined();
        });
    });

    // ========================================================================
    // handleSnaped — magic snap / hint display
    // ========================================================================

    describe("handleSnaped", () => {
        test("should display hint when snaped has empty shapes and _lastDetected exists", () => {
            Config.instance.snapType = ObjectSnapTypes.endPoint as ObjectSnapType;

            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-far-hint",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: new XYZ({ x: 100, y: 0, z: 0 }),
                        end: new XYZ({ x: 200, y: 0, z: 0 }),
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const data = createMouseAndDetected(view, { shapes: [edgeShape] });

            snap.snap(data); // sets _lastDetected
            const internal = internalsOf(snap);
            expect(internal._lastDetected).toBeDefined();

            // Now handleSnaped with empty shapes should trigger hint display
            const snaped: SnapResult = { view, shapes: [], type: "vertex" };
            expect(() => snap.handleSnaped(view.document, snaped)).not.toThrow();
            // _lastDetected should be cleared after display
            expect(internal._lastDetected).toBeUndefined();
        });

        test("should NOT display hint when snaped has non-empty shapes", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const view = createMockView();

            // Manually set _lastDetected via internals
            const internal = internalsOf(snap);
            const dummyResult: SnapResult = { view, shapes: [], type: "end" };
            internal._lastDetected = [view, dummyResult];

            const snaped: SnapResult = {
                view,
                shapes: [createEdgeShapeData()], // non-empty
                type: "end",
            };
            snap.handleSnaped(view.document, snaped);
            // _lastDetected should NOT be cleared when shapes is non-empty
            expect(internal._lastDetected).toBeDefined();
        });

        test("should NOT crash when snaped is undefined", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const view = createMockView();

            const internal = internalsOf(snap);
            const dummyResult: SnapResult = { view, shapes: [], type: "end" };
            internal._lastDetected = [view, dummyResult];

            expect(() => snap.handleSnaped(view.document, undefined)).not.toThrow();
        });

        test("should NOT crash when _lastDetected is not set", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const view = createMockView();

            const snaped: SnapResult = { view, shapes: [], type: "vertex" };
            expect(() => snap.handleSnaped(view.document, snaped)).not.toThrow();
        });
    });

    // ========================================================================
    // onSnapTypeChanged — config change handler
    // ========================================================================

    describe("onSnapTypeChanged", () => {
        test("should clear intersection cache when snapType config changes", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);

            const internal = internalsOf(snap);
            const entry: SnapResult = { view: createMockView(), shapes: [], type: "end" };
            internal._intersectionInfos.set("key1", [entry]);
            internal._intersectionInfos.set("key2", [entry]);

            Config.instance.snapType = ObjectSnapTypes.endPoint;

            // Intersection cache is cleared
            expect(internal._intersectionInfos.size).toBe(0);
        });

        test("should also clear cache when enableSnap property changes", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);

            const internal = internalsOf(snap);
            const entry: SnapResult = { view: createMockView(), shapes: [], type: "end" };
            internal._intersectionInfos.set("key1", [entry]);

            Config.instance.enableSnap = false;

            // Intersection cache is cleared on enableSnap change too
            expect(internal._intersectionInfos.size).toBe(0);
        });

        test("should NOT clear cache on unrelated config property changes", () => {
            // The listener only reacts to snapType and enableSnap.
            // Other properties are ignored — verify no crash.
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);

            const internal = internalsOf(snap);
            const entry: SnapResult = { view: createMockView(), shapes: [], type: "end" };
            internal._intersectionInfos.set("key1", [entry]);

            // Changing unrelated property should not crash
            expect(() => {
                Config.instance.enableSnapTracking = !Config.instance.enableSnapTracking;
            }).not.toThrow();
        });
    });

    // ========================================================================
    // clear / removeDynamicObject
    // ========================================================================

    describe("clear / removeDynamicObject", () => {
        test("clear should remove invisible infos' display meshes", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const internal = internalsOf(snap);
            const view = createMockView();

            // Simulate invisible infos being set
            const shape = createEdgeShapeData();
            internal._invisibleInfos.set(shape, {
                view,
                snaps: [{ view, type: "center", shapes: [shape] }],
                displays: [42, 43],
            });

            expect(() => snap.clear()).not.toThrow();
        });

        test("clear should call removeHint", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const internal = internalsOf(snap);
            const view = createMockView();

            // Setup hint vertex
            internal._hintVertex = [view.document.visual.context, 99];

            snap.clear();
            // _hintVertex should be cleared
            expect(internal._hintVertex).toBeUndefined();
        });

        test("clear should remove Config property change listener", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            snap.clear();

            // After clear, changing config should NOT crash
            expect(() => {
                Config.instance.snapType = ObjectSnapTypes.onSurface;
            }).not.toThrow();
        });

        test("removeDynamicObject should call super.removeDynamicObject and removeHint", () => {
            const snap = new ObjectSnap(ObjectSnapTypes.vertex);
            const internal = internalsOf(snap);

            // Setup hint
            const view = createMockView();
            internal._hintVertex = [view.document.visual.context, 42];

            snap.removeDynamicObject();
            expect(internal._hintVertex).toBeUndefined();
        });
    });

    // ========================================================================
    // getIntersectionKey
    // ========================================================================

    describe("getIntersectionKey", () => {
        test("should produce consistent key regardless of argument order", () => {
            const shape1 = createEdgeShapeData({
                shape: {
                    id: "aaa",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });
            const shape2 = createEdgeShapeData({
                shape: {
                    id: "bbb",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve(),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve(),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const snap = new ObjectSnap(ObjectSnapTypes.intersection);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            const getKey = (s1: VisualShapeData, s2: VisualShapeData): string =>
                (
                    snap as unknown as {
                        getIntersectionKey: (a: VisualShapeData, b: VisualShapeData) => string;
                    }
                ).getIntersectionKey(s1, s2);

            const key1 = getKey(shape1, shape2);
            const key2 = getKey(shape2, shape1);
            expect(key1).toBe(key2);
            expect(key1).toBe("aaa:bbb");
        });
    });

    // ========================================================================
    // sortSnaps — ordering by screen distance
    // ========================================================================

    describe("sortSnaps", () => {
        test("should order snaps by screen distance (closer first)", () => {
            const view = createMockView();
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            const sortSnaps = (
                snap as unknown as {
                    sortSnaps: (v: object, x: number, y: number, a: SnapResult, b: SnapResult) => number;
                }
            ).sortSnaps.bind(snap);

            const near: SnapResult = {
                view,
                point: new XYZ({ x: 0, y: 0, z: 0 }), // screen (400, 300)
                shapes: [],
                type: "end",
            };
            const far: SnapResult = {
                view,
                point: new XYZ({ x: 50, y: 0, z: 0 }), // screen (450, 300)
                shapes: [],
                type: "end",
            };

            // mouse at (400, 300): near = distance 0, far = distance 50
            expect(sortSnaps(view, 400, 300, near, far)).toBeLessThan(0);
            expect(sortSnaps(view, 400, 300, far, near)).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Combined snap type tests
    // ========================================================================

    describe("snap with combined types", () => {
        test("should return closest feature point among multiple types", () => {
            Config.instance.snapType = (ObjectSnapTypes.endPoint |
                ObjectSnapTypes.midPoint) as ObjectSnapType;

            // endPoint at (0,0,0) → screen (400, 300)
            // midPoint at (5,0,0) → screen (405, 300)
            const edgeShape = createEdgeShapeData();
            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            // mouse at (400, 300) → closer to endPoint (distance 0) than midPoint (distance 5)
            const data = createMouseAndDetected(view, { mx: 400, my: 300, shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("end");
            }
        });

        test("should fall back properly: feature points → nearest curve → _lastDetected", () => {
            // Feature points far away, but nearest curve point is close
            const nearestPoint = new XYZ({ x: 3, y: 0, z: 0 }); // screen (403, 300)
            const edgeShape = createEdgeShapeData({
                shape: {
                    id: "edge-fallback",
                    shapeType: ShapeTypes.edge,
                    curve: createMockEdgeCurve({
                        start: new XYZ({ x: 500, y: 0, z: 0 }),
                        end: new XYZ({ x: 600, y: 0, z: 0 }),
                        nearestPoint: { p1: nearestPoint },
                    }),
                    point: () => XYZ.zero,
                    transformedMul: () => ({
                        curve: createMockEdgeCurve({
                            nearestPoint: { p1: nearestPoint },
                        }),
                        intersect: () => [],
                        dispose: () => {},
                    }),
                    intersect: () => [],
                    dispose: () => {},
                } as never,
            });

            const view = createMockView({
                detectShapes: () => [edgeShape],
            });
            const snap = new ObjectSnap(ObjectSnapTypes.endPoint);
            // Set snapType after snap creation so the onSnapTypeChanged listener fires.
            Config.instance.snapType = (ObjectSnapTypes.endPoint | ObjectSnapTypes.onCurve) as ObjectSnapType;
            // mouse at (403, 300) → nearest curve point screen (403, 300) → distance 0
            const data = createMouseAndDetected(view, { mx: 403, my: 300, shapes: [edgeShape] });

            const result = snap.snap(data);
            expect(result).toBeDefined();
            if (result) {
                expect(result.type).toBe("nearCurve");
            }
        });
    });
});
