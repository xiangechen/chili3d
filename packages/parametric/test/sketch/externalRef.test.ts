// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    CancelableCommand,
    EditableShapeNode,
    type I18nKeys,
    type ICameraController,
    type ICommand,
    type IEdge,
    type INodeVisual,
    type IShape,
    Matrix4,
    type PickShapeOptions,
    Plane,
    Precision,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    nearestOnSegment,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import {
    applyAutoConstraints,
    applyDragAutoConstraints,
    dragSnapPosition,
    snapPosition,
} from "../../src/sketch/autoConstraints";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { captureExternalRef, resolveExternalRefs } from "../../src/sketch/externalRef";
import {
    ConstraintKind,
    type ExternalRefData,
    FIRST_EXTERNAL_ENTITY_ID,
    isExternalEntityId,
    SKETCH_ORIGIN_ID,
    type SketchData,
} from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const EXT_LINE: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
    role: "reference",
    snapshot: [0, 0, 10, 0],
    type: "line",
};

const EXT_CIRCLE: ExternalRefData = {
    entityId: -101,
    nodeId: "src",
    edge: { kind: "circle", center: { x: 5, y: 5, z: 0 }, radius: 3, axis: { x: 0, y: 0, z: 1 } },
    role: "reference",
    snapshot: [5, 5, 3],
    type: "circle",
};

function dataWith(...refs: ExternalRefData[]): SketchData {
    return { entities: [], constraints: [], externalRefs: refs.map((ref) => ({ ...ref })) };
}

/** Patches the global shapeFactory with `methods`; the returned function restores it. */
function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: methods,
        writable: true,
        configurable: true,
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

describe("external entity id helpers", () => {
    test("external ids start at -100 and never collide with datum or real ids", () => {
        expect(FIRST_EXTERNAL_ENTITY_ID).toBe(-100);
        expect(isExternalEntityId(-100)).toBe(true);
        expect(isExternalEntityId(-1042)).toBe(true);
        expect(isExternalEntityId(-99)).toBe(false);
        expect(isExternalEntityId(-1)).toBe(false);
        expect(isExternalEntityId(1)).toBe(false);
    });
});

describe("SketchSolver external entities", () => {
    test("seeding contributes zero dofs and stays out of entities()/toData() entities", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            expect(solver.dofs()).toBe(0);
            expect(solver.entities()).toEqual([]);
            expect(solver.entity(EXT_LINE.entityId)).toEqual({
                id: EXT_LINE.entityId,
                type: "line",
                params: [0, 0, 10, 0],
            });
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 1 })).toEqual([10, 0]);
            expect(solver.pointOf({ entityId: EXT_CIRCLE.entityId, pointIndex: 0 })).toEqual([5, 5]);
            const data = solver.toData();
            expect(data.entities).toEqual([]);
            expect(data.externalRefs).toEqual([EXT_LINE, EXT_CIRCLE]);
        } finally {
            solver.dispose();
        }
    });

    test("a coincident constraint on an external endpoint solves and survives a toData round-trip", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf({ entityId: line, pointIndex: 0 })).toEqual([0, 0]);

            const restored = new SketchSolver(Plane.XY, solver.toData());
            try {
                expect(restored.pointOf({ entityId: line, pointIndex: 0 })).toEqual([0, 0]);
                // the constraint auto-derives the ref's role to "profile"
                expect(restored.toData().externalRefs).toEqual([{ ...EXT_LINE, role: "profile" }]);
                expect(restored.toData().constraints[0].refs).toEqual([
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ]);
            } finally {
                restored.dispose();
            }
        } finally {
            solver.dispose();
        }
    });

    test("pointOnLine against an external line pulls the point onto it", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const circle = solver.addCircle(5, 6, 1);
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf({ entityId: circle, pointIndex: 0 })[1]).toBeCloseTo(0, 6);
        } finally {
            solver.dispose();
        }
    });

    test("constraints against an external circle solve (pointOnCircle, equalRadius)", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_CIRCLE));
        try {
            const point = solver.addCircle(9, 5, 1);
            solver.addConstraint({
                kind: ConstraintKind.PointOnCircle,
                refs: [
                    { entityId: point, pointIndex: 0 },
                    { entityId: EXT_CIRCLE.entityId, pointIndex: 0 },
                ],
            });
            const circle = solver.addCircle(20, 20, 7);
            solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: EXT_CIRCLE.entityId, pointIndex: 0 },
                ],
            });
            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            const p = solver.pointOf({ entityId: point, pointIndex: 0 });
            expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeCloseTo(3, 6);
            expect(solver.entity(circle)!.params[2]).toBeCloseTo(3, 6);
        } finally {
            solver.dispose();
        }
    });

    test("external entities cannot be removed or moved through the entity API", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            expect(() => solver.removeEntity(EXT_LINE.entityId)).toThrow(/removeExternalEntity/);
            expect(() =>
                solver.setPointPosition({ entityId: EXT_LINE.entityId, pointIndex: 0 }, 1, 1),
            ).toThrow(/external reference/);
        } finally {
            solver.dispose();
        }
    });

    test("dragging an external ref leaves it in place", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const ref = { entityId: EXT_LINE.entityId, pointIndex: 0 };
            solver.beginDrag([ref]);
            solver.dragTo(ref, 50, 50);
            solver.endDrag();
            expect(solver.pointOf(ref)).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 1 })).toEqual([10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("updateExternalEntity moves the entity and attached geometry follows a fine solve", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            solver.solve(true);

            solver.updateExternalEntity(EXT_LINE.entityId, [0, 7, 10, 7]);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 0 })).toEqual([0, 7]);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 1 })).toEqual([10, 7]);

            const outcome = solver.solve(true);
            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf({ entityId: line, pointIndex: 0 })).toEqual([0, 7]);
        } finally {
            solver.dispose();
        }
    });

    test("removeExternalEntity cascades referencing constraints and updates carried refs", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            const distance = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
                datum: 10,
            });
            solver.solve(true);

            const removed = solver.removeExternalEntity(EXT_LINE.entityId);

            expect(removed.sort()).toEqual([coincident, distance].sort());
            expect(solver.entity(EXT_LINE.entityId)).toBeUndefined();
            expect(solver.toData().externalRefs).toBeUndefined();
            expect(solver.toData().constraints).toEqual([]);
            expect(() => solver.removeExternalEntity(EXT_LINE.entityId)).toThrow(
                /Unknown external reference/,
            );
        } finally {
            solver.dispose();
        }
    });

    test("syncExternalRefs is a no-op for unchanged refs and reconciles moves, adds and drops", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            expect(solver.syncExternalRefs([{ ...EXT_LINE }])).toBe(false);

            // moved snapshot
            expect(solver.syncExternalRefs([{ ...EXT_LINE, snapshot: [0, 1, 10, 1] }])).toBe(true);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 0 })).toEqual([0, 1]);

            // added ref seeds; a constraint can target it right away
            expect(
                solver.syncExternalRefs([{ ...EXT_LINE, snapshot: [0, 1, 10, 1] }, { ...EXT_CIRCLE }]),
            ).toBe(true);
            expect(solver.entity(EXT_CIRCLE.entityId)).toEqual({
                id: EXT_CIRCLE.entityId,
                type: "circle",
                params: [5, 5, 3],
            });

            // dropping a ref cascades its constraints
            const line = solver.addLine(9, 5, 20, 5);
            const constraint = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_CIRCLE.entityId, pointIndex: 0 },
                ],
            });
            solver.solve(true);
            expect(solver.syncExternalRefs([{ ...EXT_LINE, snapshot: [0, 1, 10, 1] }])).toBe(true);
            expect(solver.entity(EXT_CIRCLE.entityId)).toBeUndefined();
            expect(solver.toData().constraints.some((c) => c.id === constraint)).toBe(false);
            expect(solver.toData().externalRefs).toEqual([{ ...EXT_LINE, snapshot: [0, 1, 10, 1] }]);
        } finally {
            solver.dispose();
        }
    });
});

function lineBasisEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    const start = new XYZ({ x: x1, y: y1, z: 0 });
    const end = new XYZ({ x: x2, y: y2, z: 0 });
    return {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: end.sub(start) },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
        },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        length: () => start.distanceTo(end),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IEdge;
}

/** `lineBasisEdge` plus a `transformedMul` that actually moves the endpoints. */
function movableLineEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
    const edge = lineBasisEdge(x1, y1, x2, y2);
    return Object.assign(edge, {
        transformedMul: (transform: Matrix4) => {
            const start = transform.ofPoint(edge.startPoint());
            const end = transform.ofPoint(edge.endPoint());
            return movableLineEdge(start.x, start.y, end.x, end.y);
        },
    });
}

/** `movableLineEdge` that records every transformed copy it creates (for disposal assertions). */
function trackingMovableLineEdge(x1: number, y1: number, x2: number, y2: number, created: IEdge[]): IEdge {
    const edge = lineBasisEdge(x1, y1, x2, y2);
    return Object.assign(edge, {
        transformedMul: (transform: Matrix4) => {
            const start = transform.ofPoint(edge.startPoint());
            const end = transform.ofPoint(edge.endPoint());
            const copy = trackingMovableLineEdge(start.x, start.y, end.x, end.y, created);
            created.push(copy);
            return copy;
        },
    });
}

/** Arc (or full circle) edge mock on a circle in the XY plane, angles in radians. */
function arcBasisEdge(cx: number, cy: number, radius: number, a0: number, a1: number): IEdge {
    const at = (angle: number) =>
        new XYZ({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), z: 0 });
    const start = at(a0);
    const end = at(a1);
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { center: new XYZ({ x: cx, y: cy, z: 0 }), radius, axis: XYZ.unitZ } },
        startPoint: () => start,
        endPoint: () => end,
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IEdge;
}

function splineEdge(): IEdge {
    const start = new XYZ({ x: 0, y: 0, z: 0 });
    const end = new XYZ({ x: 10, y: 10, z: 0 });
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: {} },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        length: () => start.distanceTo(end),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IEdge;
}

function solidWithEdges(...edges: IEdge[]): IShape {
    return {
        shapeType: ShapeTypes.solid,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IShape;
}

describe("resolveExternalRefs", () => {
    function setup(...edges: IEdge[]) {
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(...edges)),
        });
        doc.modelManager.addNode(source);
        return { doc, source };
    }

    test("re-resolves a moved edge, updating the snapshot and re-anchoring the fingerprint", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "reference")!;

        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 5, 10, 5)));

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);
        expect(result.mutated).toBe(true);
        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 5, 10, 5]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 0, y: 5, z: 0 },
            end: { x: 10, y: 5, z: 0 },
            edgeId: undefined,
        });
    });

    test("a missing source node marks the ref dangling and keeps the stale snapshot", () => {
        const { doc } = setup(lineBasisEdge(0, 0, 10, 0));
        const ref: ExternalRefData = { ...EXT_LINE, nodeId: "missing" };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.mutated).toBe(true);
        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBe(true);
        expect(ref.snapshot).toEqual(EXT_LINE.snapshot);
        // a second resolution keeps the flag without reporting new changes
        const [again] = resolveExternalRefs(doc, Plane.XY, [ref]);
        expect(again.mutated).toBe(false);
        expect(again.geometryChanged).toBe(false);
    });

    test("an unsupported curve kind marks the ref dangling", () => {
        const spline = splineEdge();
        const { doc } = setup(spline);
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: doc.modelManager.findNode(() => true)!.id,
            edge: { kind: "other", mid: { x: 5, y: 5, z: 0 }, length: Math.hypot(10, 10) },
            role: "reference",
            snapshot: [0, 0, 10, 10],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBe(true);
        expect(ref.snapshot).toEqual([0, 0, 10, 10]);
    });

    test("an edgeId hit on a tracking node resolves exactly", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({ document: doc });
        doc.modelManager.addNode(body);
        const shape = solidWithEdges(lineBasisEdge(3, 0, 13, 0));
        (body as any)._shape = Result.ok(shape);
        (body as any)._timeline.commit(
            [{ json: "", input: undefined, refs: new Map(), shape, edgeIds: ["e1:0"] }],
            [],
        );
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            // captured at the origin; the edge has since moved to x=3..13 — only the id
            // plus the (stale) fingerprint identifies it
            edge: {
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
                edgeId: "e1:0",
            },
            role: "profile",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([3, 0, 13, 0]);
        expect(ref.edge.edgeId).toBe("e1:0");
    });

    test("an edgeId hit survives a rigid move even when a parallel edge is closer to the stale fingerprint", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({ document: doc });
        doc.modelManager.addNode(body);
        // Extrude-length edit: the top edge moved from y=10 to y=30. The stale
        // fingerprint is now closer to the bottom edge (y=0), which would steal a
        // purely geometric match — only the tracked id still identifies the edge.
        const shape = solidWithEdges(lineBasisEdge(0, 0, 10, 0), lineBasisEdge(0, 30, 10, 30));
        (body as any)._shape = Result.ok(shape);
        (body as any)._timeline.commit(
            [{ json: "", input: undefined, refs: new Map(), shape, edgeIds: ["e1:bottom", "e1:top"] }],
            [],
        );
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            edge: {
                kind: "line",
                start: { x: 0, y: 10, z: 0 },
                end: { x: 10, y: 10, z: 0 },
                edgeId: "e1:top",
            },
            role: "reference",
            snapshot: [0, 10, 10, 10],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 30, 10, 30]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 0, y: 30, z: 0 },
            end: { x: 10, y: 30, z: 0 },
            edgeId: "e1:top",
        });
    });

    test("an edgeId whose edge changed direction falls back to the geometric match", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({ document: doc });
        doc.modelManager.addNode(body);
        // The stored id realigned onto the vertical edge; the captured horizontal
        // edge still exists and must win geometrically.
        const shape = solidWithEdges(lineBasisEdge(0, 0, 10, 0), lineBasisEdge(0, 0, 0, 10));
        (body as any)._shape = Result.ok(shape);
        (body as any)._timeline.commit(
            [{ json: "", input: undefined, refs: new Map(), shape, edgeIds: ["e1:x", "e1:y"] }],
            [],
        );
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            edge: {
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
                edgeId: "e1:y",
            },
            role: "reference",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
    });

    test("a line edge split into two collinear pieces resolves by span coverage", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, "e1:0", "profile")!;

        // The kernel split the edge at x=5 (e.g. a boolean cut); an unrelated
        // parallel line at y=5 must neither steal nor block the coverage.
        source.shape = Result.ok(
            solidWithEdges(lineBasisEdge(0, 0, 5, 0), lineBasisEdge(5, 0, 10, 0), lineBasisEdge(0, 5, 10, 5)),
        );

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.mutated).toBe(true);
        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        // snapshot and the original full-span fingerprint are kept; only the dead
        // edgeId is dropped
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 0, y: 0, z: 0 },
            end: { x: 10, y: 0, z: 0 },
            edgeId: undefined,
        });
        // a second resolution is stable — nothing left to change
        const [again] = resolveExternalRefs(doc, Plane.XY, [ref]);
        expect(again.mutated).toBe(false);
    });

    test("a re-merged edge resolves exactly again after living through a split", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "profile")!;

        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 0, 5, 0), lineBasisEdge(5, 0, 10, 0)));
        resolveExternalRefs(doc, Plane.XY, [ref]);
        expect(ref.dangling).toBeUndefined();

        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 0, 10, 0)));
        const [again] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 0, y: 0, z: 0 },
            end: { x: 10, y: 0, z: 0 },
            edgeId: undefined,
        });
        // the exact match re-anchored to the identical fingerprint — nothing mutated
        expect(again.mutated).toBe(false);
    });

    test("an arc edge split into two arcs resolves by sweep coverage", () => {
        const arc = arcBasisEdge(5, 0, 5, 0, Math.PI);
        const { doc, source } = setup(arc);
        const ref = captureExternalRef(-100, source.id, Plane.XY, arc, "e1:0", "profile")!;
        expect(ref.type).toBe("arc");
        const snapshot = [...ref.snapshot];

        source.shape = Result.ok(
            solidWithEdges(
                arcBasisEdge(5, 0, 5, 0, Math.PI / 2),
                arcBasisEdge(5, 0, 5, Math.PI / 2, Math.PI),
            ),
        );

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual(snapshot);
        expect(ref.edge).toEqual({
            kind: "circle",
            center: { x: 5, y: 0, z: 0 },
            radius: 5,
            axis: { x: 0, y: 0, z: 1 },
            edgeId: undefined,
        });
    });

    test("a full-circle edge split into arcs resolves via the same circle", () => {
        const circle = arcBasisEdge(5, 0, 5, 0, Math.PI * 2);
        const { doc, source } = setup(circle);
        const ref = captureExternalRef(-100, source.id, Plane.XY, circle, undefined, "profile")!;
        expect(ref.type).toBe("circle");
        const snapshot = [...ref.snapshot];

        source.shape = Result.ok(
            solidWithEdges(
                arcBasisEdge(5, 0, 5, 0, Math.PI / 2),
                arcBasisEdge(5, 0, 5, Math.PI / 2, Math.PI * 2),
            ),
        );

        resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(ref.dangling).toBeUndefined();
        expect(ref.type).toBe("circle");
        expect(ref.snapshot).toEqual(snapshot);
    });

    test("an edge whose middle was consumed no longer covers — the ref goes dangling", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "profile")!;

        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 0, 3, 0), lineBasisEdge(7, 0, 10, 0)));

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBe(true);
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
    });

    test("parallel but offset pieces never cover the stored span", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "profile")!;

        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 5, 5, 5), lineBasisEdge(5, 5, 10, 5)));

        resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(ref.dangling).toBe(true);
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
    });

    test("a dead kernel edgeId on a tracking node falls through to span coverage", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({ document: doc });
        doc.modelManager.addNode(body);
        const shape = solidWithEdges(lineBasisEdge(0, 0, 5, 0), lineBasisEdge(5, 0, 10, 0));
        (body as any)._shape = Result.ok(shape);
        (body as any)._timeline.commit(
            [{ json: "", input: undefined, refs: new Map(), shape, edgeIds: ["e1:a", "e1:b"] }],
            [],
        );
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            // the stored id is dead — the split pieces carry new kernel ids
            edge: {
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
                edgeId: "e1:0",
            },
            role: "profile",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
        expect(ref.edge.edgeId).toBeUndefined();
    });

    test("an asymmetric split winning the geometric match still keeps the whole span", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, "e1:0", "profile")!;

        // Split at x=2: the [2,10] piece scores 2 against the stored span while the
        // [0,2] piece scores 8 — a clear geometric winner, but a strict sub-span. The
        // whole-span policy must still win because the pieces cover the stored curve.
        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 0, 2, 0), lineBasisEdge(2, 0, 10, 0)));

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.mutated).toBe(true);
        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 0, y: 0, z: 0 },
            end: { x: 10, y: 0, z: 0 },
            edgeId: undefined,
        });
    });

    test("a sub-span winner re-anchors when the pieces no longer cover the stored span", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const ref = captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "profile")!;

        // The middle [2,5] was consumed: the [5,10] piece wins the match (score 5 vs
        // 8), but the pieces no longer cover [0,10], so the ref follows the winner.
        source.shape = Result.ok(solidWithEdges(lineBasisEdge(0, 0, 2, 0), lineBasisEdge(5, 0, 10, 0)));

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([5, 0, 10, 0]);
        expect(ref.edge).toEqual({
            kind: "line",
            start: { x: 5, y: 0, z: 0 },
            end: { x: 10, y: 0, z: 0 },
            edgeId: undefined,
        });
    });

    test("a rollback undercutting the sketch's anchor freezes the session owner's refs", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "e1", type: "extrude", sketchId: "s1", depth: 20 },
                { id: "e2", type: "extrude", sketchId: "s2", depth: -10, operation: "cut" },
                { id: "e3", type: "extrude", sketchId: "s3", depth: -3, operation: "cut" },
            ],
        });
        doc.modelManager.addNode(body);
        // the rolled-back preview's edge moved — resolving against it would drag
        // the ref onto geometry it never referenced
        (body as any)._shape = Result.ok(solidWithEdges(lineBasisEdge(0, 5, 10, 5)));
        // a propagated rollback sits at 1, below the sketch's timeline anchor (2):
        // the anchor's timeline state is unreachable (the truncated replay never
        // reaches it) and the rolled-back shape predates the capture-time one
        (body as any)._rollbackIndex = 1;
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
            role: "reference",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        const [result] = resolveExternalRefs(
            doc,
            Plane.XY,
            [ref],
            { [body.id]: 2 },
            {
                includeRolledBackSources: true,
            },
        );

        // frozen like a bystander: no resolution, no dangling flag, nothing persisted
        expect(result.mutated).toBe(false);
        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
    });

    test("a rollback freezes the session owner's anchorless refs as well", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "e1", type: "extrude", sketchId: "s1", depth: 20 },
                { id: "e2", type: "extrude", sketchId: "s2", depth: -10, operation: "cut" },
            ],
        });
        doc.modelManager.addNode(body);
        // the rolled-back preview's edge moved — resolving against it would drag
        // the ref onto geometry it never referenced
        (body as any)._shape = Result.ok(solidWithEdges(lineBasisEdge(0, 5, 10, 5)));
        (body as any)._rollbackIndex = 1;
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
            role: "reference",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        // no anchor recorded for this source: resolution would fall through to the
        // rolled-back preview — freeze instead
        const [result] = resolveExternalRefs(doc, Plane.XY, [ref], undefined, {
            includeRolledBackSources: true,
        });

        expect(result.mutated).toBe(false);
        expect(result.geometryChanged).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 0, 10, 0]);
    });

    test("a rollback at the sketch's anchor still resolves the session owner's refs", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "e1", type: "extrude", sketchId: "s1", depth: 20 },
                { id: "e2", type: "extrude", sketchId: "s2", depth: -10, operation: "cut" },
            ],
        });
        doc.modelManager.addNode(body);
        (body as any)._shape = Result.ok(solidWithEdges(lineBasisEdge(0, 5, 10, 5)));
        // rolled back TO the sketch's anchor: the rolled-back shape IS the
        // capture-time state, so the session owner keeps resolving against it
        (body as any)._rollbackIndex = 1;
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: body.id,
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
            role: "reference",
            snapshot: [0, 0, 10, 0],
            type: "line",
        };

        const [result] = resolveExternalRefs(
            doc,
            Plane.XY,
            [ref],
            { [body.id]: 1 },
            {
                includeRolledBackSources: true,
            },
        );

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBeUndefined();
        expect(ref.snapshot).toEqual([0, 5, 10, 5]);
    });

    test("refs sharing a source node resolve it once per pass", () => {
        const edge = lineBasisEdge(0, 0, 10, 0);
        const { doc, source } = setup(edge);
        const findNode = rs.spyOn(doc.modelManager, "findNode");
        try {
            const refs = [
                captureExternalRef(-100, source.id, Plane.XY, edge, undefined, "reference")!,
                captureExternalRef(-101, source.id, Plane.XY, edge, undefined, "reference")!,
            ];
            findNode.mockClear();

            const results = resolveExternalRefs(doc, Plane.XY, refs);

            expect(results.every((r) => !r.mutated)).toBe(true);
            expect(findNode).toHaveBeenCalledTimes(1);
        } finally {
            findNode.mockRestore();
        }
    });

    test("refs sharing a source node enumerate and capture its edges once per pass", () => {
        const edgeA = lineBasisEdge(0, 0, 10, 0);
        const edgeB = lineBasisEdge(0, 5, 10, 5);
        const findSubShapes = rs.fn((type: ShapeType) => (type === ShapeTypes.edge ? [edgeA, edgeB] : []));
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok({
                shapeType: ShapeTypes.solid,
                findSubShapes,
                isEqual: () => false,
                dispose: rs.fn(),
            } as unknown as IShape),
        });
        doc.modelManager.addNode(source);
        // Both refs take the geometric fallback (no edgeId, an untracked source).
        const refs = [
            captureExternalRef(-100, source.id, Plane.XY, edgeA, undefined, "reference")!,
            captureExternalRef(-101, source.id, Plane.XY, edgeB, undefined, "reference")!,
        ];
        findSubShapes.mockClear();

        const results = resolveExternalRefs(doc, Plane.XY, refs);

        expect(results.map((r) => r.mutated)).toEqual([false, false]);
        expect(findSubShapes).toHaveBeenCalledTimes(1);
    });

    test("the transformed world copy is disposed after resolution", () => {
        const created: IEdge[] = [];
        const { doc, source } = setup(trackingMovableLineEdge(0, 0, 10, 0, created));
        const transform = Matrix4.fromTranslation(0, 2, 0);
        const visual = { worldTransform: () => transform } as unknown as INodeVisual;
        doc.visual.context.getVisual = () => visual;
        // captured while the source was translated: the world span (0,2)-(10,2)
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: source.id,
            edge: { kind: "line", start: { x: 0, y: 2, z: 0 }, end: { x: 10, y: 2, z: 0 } },
            role: "reference",
            snapshot: [0, 2, 10, 2],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        // the local edge matches in the local frame — nothing changed
        expect(result.mutated).toBe(false);
        expect(ref.dangling).toBeUndefined();
        expect(created.length).toBe(1);
        expect(created[0].dispose).toHaveBeenCalledTimes(1);
    });

    test("the split-piece probe disposes every transformed edge copy", () => {
        const created: IEdge[] = [];
        const { doc, source } = setup(
            trackingMovableLineEdge(0, 0, 5, 0, created),
            trackingMovableLineEdge(5, 0, 10, 0, created),
        );
        const transform = Matrix4.fromTranslation(0, 2, 0);
        const visual = { worldTransform: () => transform } as unknown as INodeVisual;
        doc.visual.context.getVisual = () => visual;
        // world span (0,5)-(10,5): both pieces tie geometrically (ambiguous), and the
        // coverage probe finds them parallel-offset at world y=2 — no match at all
        const ref: ExternalRefData = {
            entityId: -100,
            nodeId: source.id,
            edge: { kind: "line", start: { x: 0, y: 5, z: 0 }, end: { x: 10, y: 5, z: 0 } },
            role: "reference",
            snapshot: [0, 5, 10, 5],
            type: "line",
        };

        const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

        expect(result.geometryChanged).toBe(true);
        expect(ref.dangling).toBe(true);
        expect(created.length).toBe(2);
        expect(created[0].dispose).toHaveBeenCalledTimes(1);
        expect(created[1].dispose).toHaveBeenCalledTimes(1);
    });
});

describe("SketchNode external references", () => {
    function setupWithSource(...edges: IEdge[]) {
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(...edges)),
        });
        doc.modelManager.addNode(source);
        return { doc, source };
    }

    test("generateShape includes profile-role externals — even dangling ones — and excludes reference-role ones", () => {
        const sourceEdge = lineBasisEdge(5, 5, 8, 8);
        const { doc, source } = setupWithSource(sourceEdge);
        const line = rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
                startPoint: () => start,
                endPoint: () => end,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const combine = rs.fn((edges: any[]) => Result.ok({ edges, isEqual: () => false, dispose: rs.fn() }));
        const restore = mockShapeFactory({ line, combine });
        try {
            // pinned: with no constraints referencing it, role auto-derivation would
            // otherwise revert the profile role to reference on the off-session pass
            const profileRef = {
                ...captureExternalRef(-100, source.id, Plane.XY, sourceEdge, undefined, "profile")!,
                pinned: true,
            };
            const referenceRef = captureExternalRef(
                -101,
                source.id,
                Plane.XY,
                sourceEdge,
                undefined,
                "reference",
            )!;
            // source node deleted: unresolvable, goes dangling — but a pinned
            // profile-role ref keeps contributing its stale snapshot so dependent
            // features degrade to the frozen geometry instead of failing with
            // "Sketch profile is not closed" (pinned: the off-session role derivation
            // would otherwise revert an unconstrained ref to reference)
            const goneRef: ExternalRefData = {
                entityId: -102,
                nodeId: "missing",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 1, z: 0 } },
                role: "profile",
                pinned: true,
                snapshot: [0, 0, 1, 1],
                type: "line",
            };
            // a dangling reference-role ref is still excluded: role, not resolvability,
            // decides profile participation
            const goneReferenceRef: ExternalRefData = {
                entityId: -103,
                nodeId: "missing",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 2, z: 0 } },
                role: "reference",
                snapshot: [0, 0, 2, 2],
                type: "line",
            };
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 3, 4] }],
                constraints: [],
                externalRefs: [profileRef, referenceRef, goneRef, goneReferenceRef],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });

            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            // the entity, the resolved profile-role external, and the dangling one's
            // stale snapshot; the reference roles never build geometry
            expect(line).toHaveBeenCalledTimes(3);
            expect((combine.mock.calls[0] as unknown as [any[]])[0].length).toBe(3);
            const goneCall = line.mock.calls.find((c) => (c[1] as unknown as XYZ).y === 1) as unknown as [
                XYZ,
                XYZ,
            ];
            expect(goneCall).toBeDefined();
            expect([goneCall[0].x, goneCall[0].y, goneCall[1].x]).toEqual([0, 0, 1]);
            const refs = node.data.externalRefs!;
            expect(refs.find((r) => r.entityId === -102)!.dangling).toBe(true);
            expect(refs.find((r) => r.entityId === -103)!.dangling).toBe(true);
            expect(refs.find((r) => r.entityId === -100)!.dangling).toBeUndefined();
        } finally {
            restore();
        }
    });

    test("a source shape change re-resolves refs and rebuilds a profile-role external", () => {
        const { doc, source } = setupWithSource(lineBasisEdge(5, 5, 8, 8));
        const line = rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
                startPoint: () => start,
                endPoint: () => end,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const combine = rs.fn((edges: any[]) => Result.ok({ edges, isEqual: () => false, dispose: rs.fn() }));
        const restore = mockShapeFactory({ line, combine });
        try {
            // pinned: keeps the profile role although no constraint references the ref
            const profileRef = {
                ...captureExternalRef(
                    -100,
                    source.id,
                    Plane.XY,
                    lineBasisEdge(5, 5, 8, 8),
                    undefined,
                    "profile",
                )!,
                pinned: true,
            };
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: {
                    entities: [{ id: 1, type: "line", params: [0, 0, 3, 4] }],
                    constraints: [],
                    externalRefs: [profileRef],
                },
            });
            // lazy first generation installs the watch
            expect(node.shape.isOk).toBe(true);
            line.mockClear();
            combine.mockClear();

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(5, 7, 8, 9)));

            // the entity edge plus the re-resolved external edge rebuild the sketch
            expect(line).toHaveBeenCalledTimes(2);
            expect(combine).toHaveBeenCalledTimes(1);
            const externalCall = line.mock.calls.find((c) => (c[0] as unknown as XYZ).y === 7) as unknown as [
                XYZ,
                XYZ,
            ];
            expect(externalCall).toBeDefined();
            expect([externalCall[0].x, externalCall[1].x, externalCall[1].y]).toEqual([5, 8, 9]);
            expect(node.data.externalRefs![0].snapshot).toEqual([5, 7, 8, 9]);
            expect(node.data.externalRefs![0].dangling).toBeUndefined();
        } finally {
            restore();
        }
    });

    test("a source move re-resolves refs and rebuilds a profile-role external", () => {
        const { doc, source } = setupWithSource(movableLineEdge(5, 5, 8, 8));
        const line = rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
                startPoint: () => start,
                endPoint: () => end,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const combine = rs.fn((edges: any[]) => Result.ok({ edges, isEqual: () => false, dispose: rs.fn() }));
        const restore = mockShapeFactory({ line, combine });
        try {
            // pinned: keeps the profile role although no constraint references the ref
            const profileRef = {
                ...captureExternalRef(
                    -100,
                    source.id,
                    Plane.XY,
                    lineBasisEdge(5, 5, 8, 8),
                    undefined,
                    "profile",
                )!,
                pinned: true,
            };
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: {
                    entities: [{ id: 1, type: "line", params: [0, 0, 3, 4] }],
                    constraints: [],
                    externalRefs: [profileRef],
                },
            });
            // lazy first generation installs the watch
            expect(node.shape.isOk).toBe(true);
            line.mockClear();
            combine.mockClear();

            // the source shape is unchanged — the node's placement moves the edge
            const moved = Matrix4.fromTranslation(0, 2, 0);
            const visual = { worldTransform: () => moved } as unknown as INodeVisual;
            doc.visual.context.getVisual = () => visual;
            source.transform = moved;

            // the entity edge plus the re-resolved external edge rebuild the sketch
            expect(line).toHaveBeenCalledTimes(2);
            expect(combine).toHaveBeenCalledTimes(1);
            const externalCall = line.mock.calls.find((c) => (c[0] as unknown as XYZ).y === 7) as unknown as [
                XYZ,
                XYZ,
            ];
            expect(externalCall).toBeDefined();
            expect([externalCall[0].x, externalCall[1].x, externalCall[1].y]).toEqual([5, 8, 10]);
            expect(node.data.externalRefs![0].snapshot).toEqual([5, 7, 8, 10]);
            expect(node.data.externalRefs![0].dangling).toBeUndefined();
        } finally {
            restore();
        }
    });
});

describe("SketchNode dangling-ref warning", () => {
    function setupWithSource(...edges: IEdge[]) {
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(...edges)),
        });
        doc.modelManager.addNode(source);
        return { doc, source };
    }

    function mockSketchFactory() {
        const line = rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
                startPoint: () => start,
                endPoint: () => end,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const combine = rs.fn((edges: any[]) => Result.ok({ edges, isEqual: () => false, dispose: rs.fn() }));
        return mockShapeFactory({ line, combine });
    }

    function pinnedProfileRef(entityId: number, source: EditableShapeNode, edge: IEdge): ExternalRefData {
        // pinned: with no constraints referencing the ref, role derivation would
        // otherwise revert the profile role on an off-session pass
        return {
            ...captureExternalRef(entityId, source.id, Plane.XY, edge, undefined, "profile")!,
            pinned: true,
        };
    }

    function sketchWith(doc: TestDocument, refs: ExternalRefData[]) {
        return new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [], externalRefs: refs },
        });
    }

    test("the first loss toasts once, repeats stay silent, and a full recovery re-arms", () => {
        const { doc, source } = setupWithSource(lineBasisEdge(5, 5, 8, 8));
        const restore = mockSketchFactory();
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            const node = sketchWith(doc, [pinnedProfileRef(-100, source, lineBasisEdge(5, 5, 8, 8))]);
            const properties: string[] = [];
            node.onPropertyChanged((property: string) => properties.push(property));
            const toasts = () => pub.mock.calls.filter((call) => call[0] === "showToast");

            // lazy first evaluation resolves the ref — no badge, no toast
            expect(node.shape.isOk).toBe(true);
            expect(node.warningCount).toBe(0);
            expect(toasts()).toEqual([]);

            // the referenced edge disappears from the source: badge + one toast
            source.shape = Result.ok(solidWithEdges());
            expect(node.data.externalRefs![0].dangling).toBe(true);
            expect(node.warningCount).toBe(1);
            expect(properties).toContain("warningCount");
            expect(toasts()).toEqual([["showToast", "sketch.externalRefsLost{0}", 1]]);

            // re-resolving the same dangling set stays silent
            node.followExternalRefs();
            expect(toasts().length).toBe(1);

            // a full recovery is silent and clears the badge
            source.shape = Result.ok(solidWithEdges(lineBasisEdge(5, 5, 8, 8)));
            expect(node.data.externalRefs![0].dangling).toBeUndefined();
            expect(node.warningCount).toBe(0);
            expect(toasts().length).toBe(1);

            // a later loss notifies again
            source.shape = Result.ok(solidWithEdges());
            expect(node.warningCount).toBe(1);
            expect(toasts().length).toBe(2);
        } finally {
            pub.mockRestore();
            restore();
        }
    });

    test("a grown dangling set re-notifies with the new total", () => {
        const { doc, source } = setupWithSource(lineBasisEdge(5, 5, 8, 8));
        const source2 = new EditableShapeNode({
            document: doc,
            name: "src2",
            shape: Result.ok(solidWithEdges(lineBasisEdge(15, 15, 18, 18))),
        });
        doc.modelManager.addNode(source2);
        const restore = mockSketchFactory();
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            const node = sketchWith(doc, [
                pinnedProfileRef(-100, source, lineBasisEdge(5, 5, 8, 8)),
                pinnedProfileRef(-101, source2, lineBasisEdge(15, 15, 18, 18)),
            ]);
            const toasts = () => pub.mock.calls.filter((call) => call[0] === "showToast");
            expect(node.shape.isOk).toBe(true);
            expect(node.warningCount).toBe(0);

            source.shape = Result.ok(solidWithEdges());
            expect(node.warningCount).toBe(1);
            expect(toasts()).toEqual([["showToast", "sketch.externalRefsLost{0}", 1]]);

            source2.shape = Result.ok(solidWithEdges());
            expect(node.warningCount).toBe(2);
            expect(toasts()).toEqual([
                ["showToast", "sketch.externalRefsLost{0}", 1],
                ["showToast", "sketch.externalRefsLost{0}", 2],
            ]);
        } finally {
            pub.mockRestore();
            restore();
        }
    });

    test("a dangling reference-role ref neither badges nor toasts", () => {
        const { doc, source } = setupWithSource(lineBasisEdge(5, 5, 8, 8));
        const restore = mockSketchFactory();
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            const node = sketchWith(doc, [
                captureExternalRef(
                    -100,
                    source.id,
                    Plane.XY,
                    lineBasisEdge(5, 5, 8, 8),
                    undefined,
                    "reference",
                )!,
            ]);
            const toasts = () => pub.mock.calls.filter((call) => call[0] === "showToast");
            expect(node.shape.isOk).toBe(true);

            source.shape = Result.ok(solidWithEdges());
            expect(node.data.externalRefs![0].dangling).toBe(true);
            expect(node.warningCount).toBe(0);
            expect(toasts()).toEqual([]);
        } finally {
            pub.mockRestore();
            restore();
        }
    });

    test("a sketch restored with already-dangling refs badges immediately but does not re-toast", () => {
        const { doc } = setupWithSource(lineBasisEdge(5, 5, 8, 8));
        const restore = mockSketchFactory();
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            const restored: ExternalRefData = {
                entityId: -100,
                nodeId: "missing",
                edge: { kind: "line", start: { x: 5, y: 5, z: 0 }, end: { x: 8, y: 8, z: 0 } },
                role: "profile",
                pinned: true,
                snapshot: [5, 5, 8, 8],
                type: "line",
                dangling: true,
            };
            const node = sketchWith(doc, [restored]);
            const toasts = () => pub.mock.calls.filter((call) => call[0] === "showToast");

            // the badge state is seeded from the restored data — before any evaluation
            expect(node.warningCount).toBe(1);
            expect(node.shape.isOk).toBe(true);
            expect(node.data.externalRefs![0].dangling).toBe(true);
            expect(toasts()).toEqual([]);
        } finally {
            pub.mockRestore();
            restore();
        }
    });
});

describe("sketchProfiles external entity ids", () => {
    test("the crossing path maps source edge indexes through the combined entity id list", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const regions = [
            { findSubShapes: () => [], area: () => 0, boundingBox: () => BoundingBox.zero },
            { findSubShapes: () => [], area: () => 0, boundingBox: () => BoundingBox.zero },
        ];
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            Result.ok({
                faces: regions,
                sources: [
                    [4, 0],
                    [1, 7],
                ],
            }),
        );
        const restoreFactory = mockShapeFactory({ facesFromEdges });
        try {
            // two overlapping squares: the first from sketch entities, the second from
            // profile-role external refs (the mock edges intersect, forcing the kernel path)
            const square = (x1: number, y1: number, x2: number, y2: number) => [
                lineBasisEdge(x1, y1, x2, y1),
                lineBasisEdge(x2, y1, x2, y2),
                lineBasisEdge(x2, y2, x1, y2),
                lineBasisEdge(x1, y2, x1, y1),
            ];
            const edges = [...square(0, 0, 2, 2), ...square(1, 1, 3, 3)];
            // give the mock edges intersection behavior: any pair in different squares crosses
            for (const edge of edges) {
                (edge as any).intersect = (other: IEdge) =>
                    edges.indexOf(edge) < 4 !== edges.indexOf(other) < 4
                        ? [{ parameter: 0.5, point: new XYZ({ x: 1.5, y: 1.5, z: 0 }) }]
                        : [];
                (edge as any).boundingBox = () =>
                    new BoundingBox(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 3, y: 3, z: 0 }));
            }
            const compound = {
                shapeType: ShapeTypes.compound,
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            };
            const sketch = {
                shape: Result.ok(compound),
                plane: Plane.XY,
                data: {
                    entities: edges
                        .slice(0, 4)
                        .map((_, index) => ({ id: index + 1, type: "line", params: [] })),
                    constraints: [],
                    externalRefs: edges.slice(4).map((_, index) => ({
                        entityId: -100 - index,
                        nodeId: "src",
                        edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 1, z: 0 } },
                        role: "profile",
                        snapshot: [],
                        type: "line",
                    })),
                },
            } as unknown as SketchNode;

            const result = sketchProfiles(sketch);

            expect(result.isOk).toBe(true);
            // edge index 4 is external entity -100, index 7 is -103; sets come back sorted
            expect(result.unchecked()!.outerEntities).toEqual([
                [-100, 1],
                [-103, 2],
            ]);
        } finally {
            restoreFactory();
        }
    });
});

describe("SketchEditor external reference deletion", () => {
    function setupEditor() {
        const camera = {
            cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
            cameraTarget: XYZ.zero,
            cameraUp: XYZ.unitY,
            cameraType: "perspective" as "perspective" | "orthographic",
            lookAt: rs.fn(),
            fitContent: rs.fn(),
        };
        const app = createMockApplication();
        const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const view = createMockView({
            document: doc,
            cameraController: camera as unknown as ICameraController,
        });
        (app as any).activeView = view;

        const restoreFactory = mockShapeFactory({
            line: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
            circle: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
            wire: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
            combine: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
        });
        return { doc, view, restoreFactory };
    }

    test("Delete removes the external ref and cascades its constraints and anchors", () => {
        const { doc, view, restoreFactory } = setupEditor();
        try {
            const source = new EditableShapeNode({
                document: doc,
                name: "src",
                shape: Result.ok(solidWithEdges(lineBasisEdge(5, 0, 15, 0))),
            });
            doc.modelManager.addNode(source);
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [
                    {
                        id: 1,
                        kind: ConstraintKind.P2PDistance,
                        refs: [
                            { entityId: 1, pointIndex: 0 },
                            { entityId: -100, pointIndex: 0 },
                        ],
                        datum: 5,
                    },
                ],
                externalRefs: [
                    captureExternalRef(
                        -100,
                        source.id,
                        Plane.XY,
                        lineBasisEdge(5, 0, 15, 0),
                        undefined,
                        "reference",
                    )!,
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            const editor = SketchEditor.enter(node);
            editor.dimensionAnchors.set(1, { kind: "offset", offset: 20 });

            const handler = doc.visual.eventHandler as SketchEventHandler;
            // hover the external line: screen (414, 300) is 1px from its end point
            // (15,0)→(415,300) and 4px from the sketch line's end point (10,0)→(410,300),
            // so the nearest-point hit test resolves to the external entity
            handler.pointerMove(view, { offsetX: 414, offsetY: 300, button: 0 } as PointerEvent);
            handler.keyDown(view, new KeyboardEvent("keydown", { key: "Delete" }));

            expect(node.data.externalRefs).toBeUndefined();
            expect(node.data.constraints).toEqual([]);
            expect(editor.dimensionAnchors.size).toBe(0);
            expect(editor.solver.entity(-100)).toBeUndefined();
            // the sketch's own line is untouched
            expect(editor.solver.entities().map((e) => e.id)).toEqual([1]);
        } finally {
            SketchEditor.getActive()?.exit();
            restoreFactory();
        }
    });
});

describe("off-session re-solve of external followers", () => {
    function mockLineFactory() {
        const line = rs.fn((start: XYZ, end: XYZ) =>
            Result.ok({
                startPoint: () => start,
                endPoint: () => end,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const combine = rs.fn((edges: any[]) => Result.ok({ edges, isEqual: () => false, dispose: rs.fn() }));
        const restore = mockShapeFactory({ line, combine });
        return { line, restore };
    }

    function setupFollower() {
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(lineBasisEdge(5, 0, 15, 0))),
        });
        doc.modelManager.addNode(source);
        return { doc, source };
    }

    /** Line (0,0)-(5,0): p0 coincident to the origin, p1 coincident to the external start point. */
    function followerData(sourceId: string): SketchData {
        return {
            entities: [{ id: 1, type: "line", params: [0, 0, 5, 0] }],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 0 },
                        { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 },
                    ],
                },
                {
                    id: 2,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 1 },
                        { entityId: -100, pointIndex: 0 },
                    ],
                },
            ],
            anchors: [{ id: 2, anchor: { kind: "offset", offset: 12 } }],
            externalRefs: [
                captureExternalRef(
                    -100,
                    sourceId,
                    Plane.XY,
                    lineBasisEdge(5, 0, 15, 0),
                    undefined,
                    "reference",
                )!,
            ],
        };
    }

    test("a source edge move re-solves constrained entities and regenerates the shape without a session", () => {
        const { doc, source } = setupFollower();
        const { line, restore } = mockLineFactory();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: followerData(source.id) });
            // lazy first generation installs the source-node watch
            expect(node.shape.isOk).toBe(true);
            line.mockClear();

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(7, 0, 17, 0)));

            // the coincident end point followed the external edge — no editor session involved
            const params = node.data.entities[0].params;
            expect(params[0]).toBeCloseTo(0, 6);
            expect(params[1]).toBeCloseTo(0, 6);
            expect(params[2]).toBeCloseTo(7, 6);
            expect(params[3]).toBeCloseTo(0, 6);
            // the shape regenerated with the followed endpoint; the coincident constraint
            // auto-derived the ref's role to "profile", so the external edge (7,0)-(17,0)
            // joins the shape alongside the entity edge
            expect(line).toHaveBeenCalledTimes(2);
            const entityCall = line.mock.calls.find((c) => (c[0] as unknown as XYZ).x === 0) as unknown as [
                XYZ,
                XYZ,
            ];
            expect(entityCall).toBeDefined();
            expect(entityCall[1].x).toBeCloseTo(7, 6);
            expect(node.data.externalRefs![0].role).toBe("profile");
            // editor-owned label anchors survive the solver round-trip
            expect(node.data.anchors).toEqual([{ id: 2, anchor: { kind: "offset", offset: 12 } }]);
            expect(node.data.externalRefs![0].snapshot).toEqual([7, 0, 17, 0]);
        } finally {
            restore();
        }
    });

    test("an unchanged source rebuild writes nothing, and a second pass after a move is a no-op", () => {
        const { doc, source } = setupFollower();
        const { restore } = mockLineFactory();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: followerData(source.id) });
            expect(node.shape.isOk).toBe(true);
            const initial = node.dataJson;

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(5, 0, 15, 0)));
            expect(node.dataJson).toBe(initial);

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(7, 0, 17, 0)));
            const moved = node.dataJson;
            expect(moved).not.toBe(initial);

            // no re-entrancy: re-notification with the same geometry and any later
            // evaluation find nothing mutated and leave the persisted data alone
            source.shape = Result.ok(solidWithEdges(lineBasisEdge(7, 0, 17, 0)));
            expect(node.dataJson).toBe(moved);
            expect(node.generateShape().isOk).toBe(true);
            expect(node.dataJson).toBe(moved);
        } finally {
            restore();
        }
    });

    test("a moved ref no constraint references re-resolves without a follower solve", () => {
        const { doc, source } = setupFollower();
        const { restore } = mockLineFactory();
        const solve = rs.spyOn(SketchSolver.prototype, "solve");
        try {
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 5, 0] }],
                constraints: [],
                externalRefs: [
                    captureExternalRef(
                        -100,
                        source.id,
                        Plane.XY,
                        lineBasisEdge(5, 0, 15, 0),
                        undefined,
                        "reference",
                    )!,
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            // lazy first generation installs the source-node watch
            expect(node.shape.isOk).toBe(true);
            solve.mockClear();

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(7, 0, 17, 0)));

            // the ref re-resolved and persisted, but nothing can follow an
            // unconstrained external — no solver was built for the move
            expect(node.data.externalRefs![0].snapshot).toEqual([7, 0, 17, 0]);
            expect(node.data.entities[0].params).toEqual([0, 0, 5, 0]);
            expect(solve).not.toHaveBeenCalled();
        } finally {
            solve.mockRestore();
            restore();
        }
    });

    test("a conflicting move still persists the resolved refs and keeps the sketch loadable", () => {
        const { doc, source } = setupFollower();
        const { restore } = mockLineFactory();
        try {
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 5, 0] }],
                constraints: [
                    {
                        id: 1,
                        kind: ConstraintKind.P2PCoincident,
                        refs: [
                            { entityId: 1, pointIndex: 1 },
                            { entityId: -100, pointIndex: 0 },
                        ],
                    },
                    // pinned at the old position: after the move the two constraints conflict
                    {
                        id: 2,
                        kind: ConstraintKind.Fix,
                        refs: [{ entityId: 1, pointIndex: 1 }],
                        datums: [5, 0],
                    },
                ],
                externalRefs: [
                    captureExternalRef(
                        -100,
                        source.id,
                        Plane.XY,
                        lineBasisEdge(5, 0, 15, 0),
                        undefined,
                        "reference",
                    )!,
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            expect(node.shape.isOk).toBe(true);

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(9, 0, 19, 0)));

            // the refs re-resolved and both constraints survive; the shape still
            // generates from whatever best-effort positions the conflicting solve left
            expect(node.data.externalRefs![0].snapshot).toEqual([9, 0, 19, 0]);
            expect(node.data.constraints.map((c) => c.id)).toEqual([1, 2]);
            expect(node.data.entities).toHaveLength(1);
            expect(node.generateShape().isOk).toBe(true);
        } finally {
            restore();
        }
    });
});

describe("off-session re-solve with an active editor session", () => {
    function setupEditor() {
        const camera = {
            cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
            cameraTarget: XYZ.zero,
            cameraUp: XYZ.unitY,
            cameraType: "perspective" as "perspective" | "orthographic",
            lookAt: rs.fn(),
            fitContent: rs.fn(),
        };
        const app = createMockApplication();
        const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const view = createMockView({
            document: doc,
            cameraController: camera as unknown as ICameraController,
        });
        (app as any).activeView = view;

        const restoreFactory = mockShapeFactory({
            line: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
            combine: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
        });
        return { doc, view, restoreFactory };
    }

    test("the live session owns the re-solve; the node data commits on exit", () => {
        const { doc, restoreFactory } = setupEditor();
        try {
            const source = new EditableShapeNode({
                document: doc,
                name: "src",
                shape: Result.ok(solidWithEdges(lineBasisEdge(5, 0, 15, 0))),
            });
            doc.modelManager.addNode(source);
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 5, 0] }],
                constraints: [
                    {
                        id: 1,
                        kind: ConstraintKind.P2PCoincident,
                        refs: [
                            { entityId: 1, pointIndex: 0 },
                            { entityId: SKETCH_ORIGIN_ID, pointIndex: 0 },
                        ],
                    },
                    {
                        id: 2,
                        kind: ConstraintKind.P2PCoincident,
                        refs: [
                            { entityId: 1, pointIndex: 1 },
                            { entityId: -100, pointIndex: 0 },
                        ],
                    },
                ],
                externalRefs: [
                    captureExternalRef(
                        -100,
                        source.id,
                        Plane.XY,
                        lineBasisEdge(5, 0, 15, 0),
                        undefined,
                        "reference",
                    )!,
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            // lazy first generation installs the source-node watch
            expect(node.shape.isOk).toBe(true);
            const editor = SketchEditor.enter(node);
            expect(node.editingSession).toBe(true);

            source.shape = Result.ok(solidWithEdges(lineBasisEdge(7, 0, 17, 0)));

            // the session's solver followed the external through the reconcile path…
            expect(editor.solver.entity(1)!.params[2]).toBeCloseTo(7, 6);
            // …while the node data still holds the pre-session entity params — the
            // off-session write-back must not run behind the live solver's back
            expect(node.data.entities[0].params).toEqual([0, 0, 5, 0]);
            expect(node.data.externalRefs![0].snapshot).toEqual([7, 0, 17, 0]);

            editor.exit();

            expect(node.editingSession).toBe(false);
            // exiting commits the session's solved state
            const committed = node.data.entities[0].params;
            expect(committed[0]).toBeCloseTo(0, 6);
            expect(committed[2]).toBeCloseTo(7, 6);
        } finally {
            SketchEditor.getActive()?.exit();
            restoreFactory();
        }
    });
});

describe("profile closure with external refs", () => {
    /** Full-featured line edge mock: chainable, intersectable, boxed. */
    function chainEdge(x1: number, y1: number, x2: number, y2: number): IEdge {
        const start = new XYZ({ x: x1, y: y1, z: 0 });
        const end = new XYZ({ x: x2, y: y2, z: 0 });
        return {
            shapeType: ShapeTypes.edge,
            curve: {
                basisCurve: { direction: end.sub(start) },
                nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
            },
            startPoint: () => start,
            endPoint: () => end,
            firstParameter: () => 0,
            lastParameter: () => 1,
            pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
            length: () => start.distanceTo(end),
            isEqual: () => false,
            dispose: rs.fn(),
            intersect: (other: IEdge) => segmentIntersect(start, end, other.startPoint(), other.endPoint()),
            boundingBox: () =>
                new BoundingBox(
                    new XYZ({ x: Math.min(x1, x2), y: Math.min(y1, y2), z: 0 }),
                    new XYZ({ x: Math.max(x1, x2), y: Math.max(y1, y2), z: 0 }),
                ),
        } as unknown as IEdge;
    }

    function segmentIntersect(p1: XYZ, p2: XYZ, p3: XYZ, p4: XYZ): { parameter: number; point: XYZ }[] {
        const d = { x: p2.x - p1.x, y: p2.y - p1.y };
        const e = { x: p4.x - p3.x, y: p4.y - p3.y };
        const denom = d.x * e.y - d.y * e.x;
        if (Math.abs(denom) < 1e-12) return [];
        const t = ((p3.x - p1.x) * e.y - (p3.y - p1.y) * e.x) / denom;
        const u = ((p3.x - p1.x) * d.y - (p3.y - p1.y) * d.x) / denom;
        if (t < 0 || t > 1 || u < 0 || u > 1) return [];
        return [{ parameter: t, point: new XYZ({ x: p1.x + t * d.x, y: p1.y + t * d.y, z: 0 }) }];
    }

    /** wire() genuinely chains its edges and reports closure like the kernel does. */
    function mockProfileFactories(facesFromEdges?: (edges: IEdge[], plane: Plane) => any) {
        const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(chainEdge(start.x, start.y, end.x, end.y)));
        const combine = rs.fn((edges: IEdge[]) =>
            Result.ok({
                shapeType: ShapeTypes.compound,
                findSubShapes: (t: ShapeType) => (t === ShapeTypes.edge ? edges : []),
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const wire = rs.fn((edges: IEdge[]) => {
            const remaining = [...edges];
            const first = remaining.shift()!;
            const tail = first.startPoint();
            let head = first.endPoint();
            while (remaining.length > 0) {
                const index = remaining.findIndex(
                    (candidate) =>
                        candidate.startPoint().distanceTo(head) < Precision.Distance ||
                        candidate.endPoint().distanceTo(head) < Precision.Distance,
                );
                if (index === -1) break;
                const next = remaining.splice(index, 1)[0];
                head =
                    next.startPoint().distanceTo(head) < Precision.Distance
                        ? next.endPoint()
                        : next.startPoint();
            }
            const closed = remaining.length === 0 && head.distanceTo(tail) < Precision.Distance;
            return Result.ok({
                isClosed: () => closed,
                findSubShapes: (t: ShapeType) => (t === ShapeTypes.edge ? edges : []),
            });
        });
        const face = rs.fn((wires: any[]) =>
            Result.ok({
                shapeType: ShapeTypes.face,
                wires,
                area: () => 1,
                boundingBox: () => BoundingBox.zero,
                isEqual: () => false,
                dispose: rs.fn(),
            }),
        );
        const restore = mockShapeFactory({
            line,
            combine,
            wire,
            face,
            ...(facesFromEdges ? { facesFromEdges } : {}),
        });
        return { line, combine, wire, face, restore };
    }

    /** Solves the 3-line rectangle against the external bottom edge and returns the node data. */
    function solvedRectangleData(sourceId: string, role: "reference" | "profile"): SketchData {
        const ref = captureExternalRef(-100, sourceId, Plane.XY, chainEdge(0, 0, 10, 0), undefined, role)!;
        const solver = new SketchSolver(Plane.XY, {
            // slightly off — the coincident constraints pull the corners onto the external
            entities: [
                { id: 1, type: "line", params: [0.2, 0.3, -0.1, 10.2] },
                { id: 2, type: "line", params: [-0.1, 10.2, 10.3, 9.8] },
                { id: 3, type: "line", params: [10.3, 9.8, 9.7, -0.2] },
            ],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 0 },
                        { entityId: -100, pointIndex: 0 },
                    ],
                },
                {
                    id: 2,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 3, pointIndex: 1 },
                        { entityId: -100, pointIndex: 1 },
                    ],
                },
                {
                    id: 3,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 1 },
                        { entityId: 2, pointIndex: 0 },
                    ],
                },
                {
                    id: 4,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 2, pointIndex: 1 },
                        { entityId: 3, pointIndex: 0 },
                    ],
                },
            ],
            externalRefs: [ref],
        });
        try {
            expect(solver.solve(true).result.startsWith("Ok")).toBe(true);
            return solver.toData();
        } finally {
            solver.dispose();
        }
    }

    test("three solved lines plus a profile-role external close into a profile face", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(chainEdge(0, 0, 10, 0))),
        });
        doc.modelManager.addNode(source);
        const { wire, face, restore } = mockProfileFactories();
        try {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: solvedRectangleData(source.id, "profile"),
            });

            const result = sketchProfiles(node);

            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            // the closed wire chains all four edges: 3 entities + the external
            expect(wire).toHaveBeenCalledTimes(1);
            expect((wire.mock.calls[0] as unknown as [IEdge[]])[0].length).toBe(4);
            expect(face).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });

    test("a dangling profile-role ref keeps closing the profile from its stale snapshot", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(chainEdge(0, 0, 10, 0))),
        });
        doc.modelManager.addNode(source);
        const { wire, face, restore } = mockProfileFactories();
        try {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: solvedRectangleData(source.id, "profile"),
            });
            // lazy first generation installs the source-node watch
            expect(node.shape.isOk).toBe(true);

            // the source edge disappears (e.g. consumed by a boolean, or the source
            // node deleted): the ref goes dangling but keeps contributing its stale
            // snapshot, so the profile degrades to the frozen geometry instead of
            // failing with "Sketch profile is not closed"
            source.shape = Result.ok(solidWithEdges());

            const ref = node.data.externalRefs![0];
            expect(ref.dangling).toBe(true);
            expect(ref.snapshot).toEqual([0, 0, 10, 0]);

            const result = sketchProfiles(node);
            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            // the stale external edge still closes the wire with the 3 sketch entities
            const lastWire = wire.mock.calls.at(-1) as unknown as [IEdge[]];
            expect(lastWire[0].length).toBe(4);
            expect(face).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });

    test("a recovered ref clears dangling and the profile follows the freshened geometry", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(chainEdge(0, 0, 10, 0))),
        });
        doc.modelManager.addNode(source);
        const { wire, restore } = mockProfileFactories();
        try {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: solvedRectangleData(source.id, "profile"),
            });
            expect(node.shape.isOk).toBe(true);

            source.shape = Result.ok(solidWithEdges());
            expect(node.data.externalRefs![0].dangling).toBe(true);

            // the edge comes back one unit up: the sole candidate re-matches as a
            // clear winner, the snapshot freshens and the off-session re-solve pulls
            // the coincident-constrained rectangle onto the recovered geometry
            source.shape = Result.ok(solidWithEdges(chainEdge(0, 1, 10, 1)));

            const ref = node.data.externalRefs![0];
            expect(ref.dangling).toBeUndefined();
            expect(ref.snapshot).toEqual([0, 1, 10, 1]);
            // the coincident-constrained bottom corner followed the recovered edge
            // (the rectangle's top is unconstrained and stays where it was)
            expect(node.data.entities[0].params[1]).toBeCloseTo(1, 6);

            // the profile closes on the fresh geometry, not the stale snapshot
            const result = sketchProfiles(node);
            expect(result.isOk).toBe(true);
            expect(result.unchecked()!.outer.length).toBe(1);
            const lastWire = wire.mock.calls.at(-1) as unknown as [IEdge[]];
            expect(lastWire[0].length).toBe(4);
            expect(lastWire[0].every((edge) => edge.startPoint().y >= 1 - Precision.Distance)).toBe(true);
        } finally {
            restore();
        }
    });

    test("a reference-role external never builds profiles (by design)", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(chainEdge(0, 0, 10, 0))),
        });
        doc.modelManager.addNode(source);
        const { restore } = mockProfileFactories();
        try {
            const data = solvedRectangleData(source.id, "reference");
            // the coincident constraints auto-derive "profile" — emulate the user
            // explicitly pinning the reference role (sketch.toggleExternal)
            data.externalRefs![0].role = "reference";
            data.externalRefs![0].pinned = true;
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });

            // the 3 sketch lines alone are an open chain — no profile forms until the
            // ref's role is flipped to profile (sketch.toggleExternal)
            const result = sketchProfiles(node);
            expect(result.isOk).toBe(false);
        } finally {
            restore();
        }
    });

    test("lines landing mid-span on a profile-role external close via the crossing path", async () => {
        const { sketchProfiles } = await import("../../src/features/profileBuilder");
        const doc = new TestDocument({ application: createMockApplication() });
        const source = new EditableShapeNode({
            document: doc,
            name: "src",
            shape: Result.ok(solidWithEdges(chainEdge(0, 0, 10, 0))),
        });
        doc.modelManager.addNode(source);
        const ref = captureExternalRef(
            -100,
            source.id,
            Plane.XY,
            chainEdge(0, 0, 10, 0),
            undefined,
            "profile",
        )!;
        const solver = new SketchSolver(Plane.XY, {
            entities: [
                { id: 1, type: "line", params: [2, 0.4, 2.1, 5] },
                { id: 2, type: "line", params: [2.1, 5, 7.2, 4.9] },
                { id: 3, type: "line", params: [7.2, 4.9, 7, 0.3] },
            ],
            constraints: [
                // T-junctions: the verticals land mid-span on the external edge
                {
                    id: 1,
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: 1, pointIndex: 0 },
                        { entityId: -100, pointIndex: 0 },
                        { entityId: -100, pointIndex: 1 },
                    ],
                },
                {
                    id: 2,
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: 3, pointIndex: 1 },
                        { entityId: -100, pointIndex: 0 },
                        { entityId: -100, pointIndex: 1 },
                    ],
                },
                {
                    id: 3,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 1 },
                        { entityId: 2, pointIndex: 0 },
                    ],
                },
                {
                    id: 4,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 2, pointIndex: 1 },
                        { entityId: 3, pointIndex: 0 },
                    ],
                },
            ],
            externalRefs: [ref],
        });
        let data: SketchData;
        try {
            expect(solver.solve(true).result.startsWith("Ok")).toBe(true);
            data = solver.toData();
        } finally {
            solver.dispose();
        }
        const regionFace = {
            shapeType: ShapeTypes.face,
            area: () => 10,
            boundingBox: () => BoundingBox.zero,
        };
        const facesFromEdges = rs.fn((_edges: IEdge[], _plane: Plane) =>
            Result.ok({ faces: [regionFace], sources: [[0, 1, 2, 3]] }),
        );
        const { restore } = mockProfileFactories(facesFromEdges);
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });

            const result = sketchProfiles(node);

            expect(result.isOk).toBe(true);
            expect(facesFromEdges).toHaveBeenCalledTimes(1);
            expect(result.unchecked()!.outer.length).toBe(1);
            // the region's identity maps the kernel's source indexes through the combined
            // entity id list — the external edge (-100) is part of the boundary
            expect(result.unchecked()!.outerEntities).toEqual([[-100, 1, 2, 3]]);
        } finally {
            restore();
        }
    });
});

describe("ToggleSketchExternalRole command", () => {
    function fakeToggleEditor() {
        const solver = new SketchSolver(Plane.XY, dataWith({ ...EXT_LINE, role: "reference" as const }));
        const entityQueue: (number | undefined)[] = [];
        return {
            node: { plane: Plane.XY },
            solver,
            solve: rs.fn((_fine: boolean) => {}),
            commit: rs.fn(() => {}),
            refreshExternalDisplay: rs.fn(),
            pickEntity: rs.fn((_prompt: I18nKeys) => Promise.resolve(entityQueue.shift())),
            entityQueue,
        };
    }

    type FakeToggleEditor = ReturnType<typeof fakeToggleEditor>;

    async function runToggle(editor: FakeToggleEditor): Promise<void> {
        const { ToggleSketchExternalRole } = await import("../../src/sketch/commands/sketchProjectEdges");
        const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
        try {
            await (new ToggleSketchExternalRole() as ICommand).execute({
                activeView: { document: {} },
            } as any);
        } finally {
            getActive.mockRestore();
        }
    }

    test("flips picked external refs between reference and profile, committing once", async () => {
        const editor = fakeToggleEditor();
        try {
            // a constraint on the external survives the flip (no reseed, geometry unchanged)
            const line = editor.solver.addLine(0, 5, 10, 5);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            // the coincident constraint auto-derives the ref's role to "profile"
            expect(editor.solver.toData().externalRefs![0].role).toBe("profile");
            // pick the external twice (profile → reference → profile, both pinned), then ESC
            editor.entityQueue.push(EXT_LINE.entityId, EXT_LINE.entityId, undefined);

            await runToggle(editor);

            const data = editor.solver.toData();
            expect(data.externalRefs![0]).toMatchObject({ role: "profile", pinned: true });
            expect(data.constraints.length).toBe(1);
            expect(editor.solver.entity(EXT_LINE.entityId)!.params).toEqual(EXT_LINE.snapshot);
            expect(editor.refreshExternalDisplay).toHaveBeenCalledTimes(2);
            expect(editor.commit).toHaveBeenCalledTimes(1);

            // one more pick flips it to reference
            editor.entityQueue.push(EXT_LINE.entityId, undefined);
            await runToggle(editor);
            expect(editor.solver.toData().externalRefs![0]).toMatchObject({
                role: "reference",
                pinned: true,
            });
        } finally {
            editor.solver.dispose();
        }
    });

    test("a non-external pick shows the pick prompt and keeps picking", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 5, 10, 5);
            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                editor.entityQueue.push(line, EXT_LINE.entityId, undefined);
                await runToggle(editor);
                // mockRestore clears the recorded calls — assert before restoring
                expect(pub).toHaveBeenCalledWith("statusBarTip", "prompt.pickExternalRef");
            } finally {
                pub.mockRestore();
            }

            expect(editor.solver.toData().externalRefs![0].role).toBe("profile");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("ESC without a flip commits nothing", async () => {
        const editor = fakeToggleEditor();
        try {
            editor.entityQueue.push(undefined);
            await runToggle(editor);

            expect(editor.solver.toData().externalRefs![0].role).toBe("reference");
            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.refreshExternalDisplay).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("ProjectSketchEdges command", () => {
    /** A picked shape: `shape` is the local edge, transformed by `transform` into world space. */
    function pickedOf(shape: IEdge, options?: { ownerNode?: object; transform?: Matrix4 }) {
        return {
            shape,
            owner: { node: options?.ownerNode ?? { id: "src" } },
            transform: options?.transform ?? Matrix4.identity(),
            indexes: [0],
        } as unknown as VisualShapeData;
    }

    /** A local edge whose transformedMul returns the held world edge (disposal tracked). */
    function edgeProjectingTo(worldEdge: IEdge): IEdge {
        return { transformedMul: () => worldEdge } as unknown as IEdge;
    }

    /** A full line edge mock parallel to the sketch plane but 5 units above it. */
    function offPlaneLineEdge(): IEdge {
        const start = new XYZ({ x: 0, y: 0, z: 5 });
        const end = new XYZ({ x: 10, y: 0, z: 5 });
        return {
            shapeType: ShapeTypes.edge,
            curve: {
                basisCurve: { direction: end.sub(start) },
                nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
            },
            startPoint: () => start,
            endPoint: () => end,
            firstParameter: () => 0,
            lastParameter: () => 1,
            pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
            length: () => start.distanceTo(end),
            isEqual: () => false,
            dispose: rs.fn(),
        } as unknown as IEdge;
    }

    function fakeProjectEditor(picked: VisualShapeData[], data?: SketchData) {
        const solver = new SketchSolver(
            Plane.XY,
            data ?? dataWith({ ...EXT_LINE, role: "reference" as const }),
        );
        const pickShape = rs.fn(
            (_prompt: I18nKeys, _controller: AsyncController, _options?: PickShapeOptions) =>
                Promise.resolve(picked),
        );
        const document = {
            picker: { pickShape },
            selection: { clearSelection: rs.fn() },
        };
        return {
            document,
            node: { plane: Plane.XY },
            solver,
            pickShape,
            solve: rs.fn((_fine: boolean) => {}),
            commit: rs.fn(() => {}),
            refreshExternalDisplay: rs.fn(),
        };
    }

    type FakeProjectEditor = ReturnType<typeof fakeProjectEditor>;

    async function runProject(editor: FakeProjectEditor, role?: I18nKeys): Promise<void> {
        const { ProjectSketchEdges } = await import("../../src/sketch/commands/sketchProjectEdges");
        // the app supplies command options through the static property cache
        // (readProperties in beforeExecute) — prime it, then restore isolation
        const cache: Map<string, any> = (CancelableCommand as any)._propertiesCache;
        const hadRole = cache.has("role");
        const previousRole = cache.get("role");
        const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
        try {
            if (role === undefined) cache.delete("role");
            else cache.set("role", role);
            await (new ProjectSketchEdges() as ICommand).execute({ activeView: { document: {} } } as any);
        } finally {
            getActive.mockRestore();
            if (hadRole) cache.set("role", previousRole);
            else cache.delete("role");
        }
    }

    test("projects a coplanar picked edge as a reference-role external ref, disposing the world copy", async () => {
        const worldEdge = movableLineEdge(0, 5, 10, 5);
        const editor = fakeProjectEditor([pickedOf(edgeProjectingTo(worldEdge))]);
        try {
            await runProject(editor);

            const refs = editor.solver.toData().externalRefs!;
            expect(refs.length).toBe(2);
            // the id continues below the smallest existing external id
            expect(refs[1]).toMatchObject({
                entityId: -101,
                nodeId: "src",
                role: "reference",
                type: "line",
                snapshot: [0, 5, 10, 5],
            });
            expect(refs[1].pinned).toBeUndefined();
            expect(worldEdge.dispose).toHaveBeenCalled();
            expect(editor.document.selection.clearSelection).toHaveBeenCalled();
            expect(editor.refreshExternalDisplay).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("applies the pick transform before projecting", async () => {
        const editor = fakeProjectEditor([
            pickedOf(movableLineEdge(0, 5, 10, 5), { transform: Matrix4.fromTranslation(0, 10, 0) }),
        ]);
        try {
            await runProject(editor);

            expect(editor.solver.toData().externalRefs![1].snapshot).toEqual([0, 15, 10, 15]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("allocates the entity id below the smallest id in use", async () => {
        const worldEdge = movableLineEdge(0, 5, 10, 5);
        const editor = fakeProjectEditor(
            [pickedOf(edgeProjectingTo(worldEdge))],
            dataWith(EXT_LINE, EXT_CIRCLE),
        );
        try {
            await runProject(editor);

            const refs = editor.solver.toData().externalRefs!;
            expect(refs.map((ref) => ref.entityId)).toEqual([-100, -101, -102]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("skips duplicates within the same pick and of existing refs", async () => {
        // a fresh edge picked twice in one go, plus a copy of the seeded EXT_LINE
        const fresh = () => edgeProjectingTo(movableLineEdge(0, 5, 10, 5));
        const existingCopy = edgeProjectingTo(movableLineEdge(0, 0, 10, 0));
        const editor = fakeProjectEditor([pickedOf(fresh()), pickedOf(fresh()), pickedOf(existingCopy)]);
        try {
            await runProject(editor);

            const refs = editor.solver.toData().externalRefs!;
            expect(refs.length).toBe(2);
            expect(refs[1]).toMatchObject({ entityId: -101, snapshot: [0, 5, 10, 5] });
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports when nothing picked is projectable, committing nothing", async () => {
        const editor = fakeProjectEditor([pickedOf(edgeProjectingTo(offPlaneLineEdge()))]);
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            await runProject(editor);
            // mockRestore clears the recorded calls — assert before restoring
            expect(pub).toHaveBeenCalledWith("displayError", "sketch.noProjectableEdges");
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }

        expect(editor.solver.toData().externalRefs!.length).toBe(1);
        expect(editor.commit).not.toHaveBeenCalled();
        expect(editor.refreshExternalDisplay).not.toHaveBeenCalled();
    });

    test("an empty pick returns without touching the sketch", async () => {
        const editor = fakeProjectEditor([]);
        try {
            await runProject(editor);

            expect(editor.solver.toData().externalRefs!.length).toBe(1);
            expect(editor.solve).not.toHaveBeenCalled();
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("the profile role option pins the projected ref", async () => {
        const worldEdge = movableLineEdge(0, 5, 10, 5);
        const editor = fakeProjectEditor([pickedOf(edgeProjectingTo(worldEdge))]);
        try {
            await runProject(editor, "option.command.externalRole.profile");

            expect(editor.solver.toData().externalRefs![1]).toMatchObject({ role: "profile", pinned: true });
        } finally {
            editor.solver.dispose();
        }
    });

    test("a tracking body owner supplies the kernel edgeId", async () => {
        const bodyOwner = {
            id: "body",
            faceIdAt: () => undefined,
            edgeIdAt: (index: number) => (index === 0 ? "edge-7" : undefined),
            edgeIndexById: () => undefined,
        };
        const worldEdge = movableLineEdge(0, 5, 10, 5);
        const editor = fakeProjectEditor([pickedOf(edgeProjectingTo(worldEdge), { ownerNode: bodyOwner })]);
        try {
            await runProject(editor);

            const refs = editor.solver.toData().externalRefs!;
            expect(refs[1].nodeId).toBe("body");
            expect(refs[1].edge.edgeId).toBe("edge-7");
        } finally {
            editor.solver.dispose();
        }
    });

    test("the pick is a multi edge pick that excludes the sketch's own node", async () => {
        const editor = fakeProjectEditor([]);
        try {
            await runProject(editor);

            const options = editor.pickShape.mock.calls[0][2];
            expect(options?.shapeType).toBe(ShapeTypes.edge);
            expect(options?.multi).toBe(true);
            expect(options?.nodeFilter?.allow(editor.node as any)).toBe(false);
            expect(options?.nodeFilter?.allow({} as any)).toBe(true);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("external references as snap targets", () => {
    test("a drawn endpoint near an external endpoint snaps onto it with a coincident constraint", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const id = solver.addLine(10.2, 0.1, 20, 5);

            const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
            solver.solve(true);

            expect(added).toEqual([
                {
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: id, pointIndex: 0 },
                        { entityId: EXT_LINE.entityId, pointIndex: 1 },
                    ],
                },
            ]);
            // the point landed exactly on the pinned external endpoint
            expect(solver.pointOf({ entityId: id, pointIndex: 0 })).toEqual([10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("a drawn endpoint near an external line mid-span snaps onto it with point-on-line", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const id = solver.addLine(5, 0.2, 15, 5);

            const added = applyAutoConstraints(solver, id, { pointTolerance: 0.5 });
            solver.solve(true);

            expect(added).toEqual([
                {
                    kind: ConstraintKind.PointOnLine,
                    refs: [
                        { entityId: id, pointIndex: 0 },
                        { entityId: EXT_LINE.entityId, pointIndex: 0 },
                        { entityId: EXT_LINE.entityId, pointIndex: 1 },
                    ],
                },
            ]);
            const [u, v] = solver.pointOf({ entityId: id, pointIndex: 0 });
            expect(u).toBeCloseTo(5, 6);
            expect(v).toBeCloseTo(0, 6);
        } finally {
            solver.dispose();
        }
    });

    test("snapPosition targets external endpoints, mid-spans and circle centers", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            const endpoint = snapPosition(solver, [10.1, 0.1], { pointTolerance: 0.5 });
            expect(endpoint.snap).toEqual({
                kind: "point",
                point: { entityId: EXT_LINE.entityId, pointIndex: 1 },
                position: [10, 0],
            });
            expect(endpoint.position).toEqual([10, 0]);

            const midSpan = snapPosition(solver, [5, 0.3], { pointTolerance: 0.2, lineTolerance: 0.5 });
            expect(midSpan.snap).toEqual({
                kind: "line",
                lineRefs: [
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
                position: [5, 0],
            });
            expect(midSpan.position).toEqual([5, 0]);

            const center = snapPosition(solver, [5.1, 4.9], { pointTolerance: 0.5 });
            expect(center.snap).toEqual({
                kind: "point",
                point: { entityId: EXT_CIRCLE.entityId, pointIndex: 0 },
                position: [5, 5],
            });
        } finally {
            solver.dispose();
        }
    });

    test("a dragged point snaps onto an external endpoint", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const id = solver.addLine(20, 20, 30, 20);
            const result = dragSnapPosition(solver, { entityId: id, pointIndex: 0 }, [0.1, -0.1], {
                pointTolerance: 0.5,
            });

            expect(result.snap).toEqual({
                kind: "point",
                point: { entityId: EXT_LINE.entityId, pointIndex: 0 },
                position: [0, 0],
            });
            expect(result.position).toEqual([0, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("dragging a point coincident to an external re-snaps without duplicating the constraint", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const id = solver.addLine(0, 0, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: id, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            solver.solve(true);

            // datum precedent: a coincident point re-snaps onto its pinned partner…
            const result = dragSnapPosition(solver, { entityId: id, pointIndex: 0 }, [0.1, 0.1], {
                pointTolerance: 0.5,
            });
            expect(result.snap).toEqual({
                kind: "point",
                point: { entityId: EXT_LINE.entityId, pointIndex: 0 },
                position: [0, 0],
            });

            // …but settling the drag adds no duplicate coincident constraint
            const added = applyDragAutoConstraints(
                solver,
                { entityId: id, pointIndex: 0 },
                { pointTolerance: 0.5 },
            );
            expect(added).toEqual([]);
            expect(
                solver.toData().constraints.filter((c) => c.kind === ConstraintKind.P2PCoincident).length,
            ).toBe(1);
        } finally {
            solver.dispose();
        }
    });
});

describe("automatic external role derivation", () => {
    test("a constraint referencing a ref derives profile; removing it reverts to reference", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            expect(solver.toData().externalRefs).toEqual([EXT_LINE]);

            const line = solver.addLine(5, 5, 20, 5);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            expect(solver.toData().externalRefs).toEqual([{ ...EXT_LINE, role: "profile" }]);

            solver.removeConstraint(coincident);
            expect(solver.toData().externalRefs).toEqual([EXT_LINE]);
        } finally {
            solver.dispose();
        }
    });

    test("a dimension constraint referencing a ref derives profile as well", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
                datum: 10,
            });
            expect(solver.toData().externalRefs).toEqual([{ ...EXT_LINE, role: "profile" }]);
        } finally {
            solver.dispose();
        }
    });

    test("a pinned ref keeps its stored role regardless of constraints", () => {
        // pinned reference stays reference even with a constraint referencing it
        const pinned = new SketchSolver(Plane.XY, dataWith({ ...EXT_LINE, role: "reference", pinned: true }));
        try {
            const line = pinned.addLine(5, 5, 20, 5);
            pinned.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            expect(pinned.toData().externalRefs).toEqual([{ ...EXT_LINE, pinned: true }]);
        } finally {
            pinned.dispose();
        }
        // pinned profile survives having no constraints
        const pinnedProfile = new SketchSolver(
            Plane.XY,
            dataWith({ ...EXT_LINE, role: "profile", pinned: true }),
        );
        try {
            expect(pinnedProfile.toData().externalRefs).toEqual([
                { ...EXT_LINE, role: "profile", pinned: true },
            ]);
        } finally {
            pinnedProfile.dispose();
        }
    });

    test("loading normalizes stale stored roles in both directions", () => {
        // stored "reference" but a constraint references the ref
        const constrained = new SketchSolver(Plane.XY, {
            entities: [{ id: 1, type: "line", params: [5, 5, 20, 5] }],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.P2PCoincident,
                    refs: [
                        { entityId: 1, pointIndex: 0 },
                        { entityId: EXT_LINE.entityId, pointIndex: 0 },
                    ],
                },
            ],
            externalRefs: [{ ...EXT_LINE }],
        });
        try {
            expect(constrained.toData().externalRefs).toEqual([{ ...EXT_LINE, role: "profile" }]);
        } finally {
            constrained.dispose();
        }
        // stored "profile" unpinned with no referencing constraint
        const unconstrained = new SketchSolver(Plane.XY, dataWith({ ...EXT_LINE, role: "profile" }));
        try {
            expect(unconstrained.toData().externalRefs).toEqual([EXT_LINE]);
        } finally {
            unconstrained.dispose();
        }
    });

    test("removing one ref keeps the other's role derived from its own constraint", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            const circle = solver.addCircle(20, 20, 7);
            const equalRadius = solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [
                    { entityId: circle, pointIndex: 0 },
                    { entityId: EXT_CIRCLE.entityId, pointIndex: 0 },
                ],
            });

            solver.removeExternalEntity(EXT_LINE.entityId);
            expect(solver.toData().externalRefs).toEqual([{ ...EXT_CIRCLE, role: "profile" }]);

            solver.removeConstraint(equalRadius);
            expect(solver.toData().externalRefs).toEqual([EXT_CIRCLE]);
        } finally {
            solver.dispose();
        }
    });

    test("an editor commit persists the derived role, and undo reverts it", () => {
        const camera = {
            cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
            cameraTarget: XYZ.zero,
            cameraUp: XYZ.unitY,
            cameraType: "perspective" as "perspective" | "orthographic",
            lookAt: rs.fn(),
            fitContent: rs.fn(),
        };
        const app = createMockApplication();
        const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const view = createMockView({
            document: doc,
            cameraController: camera as unknown as ICameraController,
        });
        (app as any).activeView = view;

        const restoreFactory = mockShapeFactory({
            line: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
            combine: () => Result.ok({ isEqual: () => false, dispose: rs.fn() }),
        });
        try {
            const source = new EditableShapeNode({
                document: doc,
                name: "src",
                shape: Result.ok(solidWithEdges(lineBasisEdge(0, 0, 10, 0))),
            });
            doc.modelManager.addNode(source);
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [5, 5, 20, 5] }],
                constraints: [],
                externalRefs: [
                    captureExternalRef(
                        -100,
                        source.id,
                        Plane.XY,
                        lineBasisEdge(0, 0, 10, 0),
                        undefined,
                        "reference",
                    )!,
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            const editor = SketchEditor.enter(node);

            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: -100, pointIndex: 0 },
                ],
            });
            editor.solve(true);
            editor.commit();
            // the added constraint derived the ref's role to profile, persisted on commit
            expect(node.data.externalRefs![0].role).toBe("profile");

            // undo restores the pre-commit data (constraint gone, role back to reference)
            doc.history.undo();
            expect(node.data.externalRefs![0].role).toBe("reference");
            expect(node.data.constraints).toEqual([]);
        } finally {
            SketchEditor.getActive()?.exit();
            restoreFactory();
        }
    });
});
