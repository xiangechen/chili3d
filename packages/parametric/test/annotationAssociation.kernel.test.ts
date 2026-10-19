// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    CurveUtils,
    DimensionAnnotation,
    EditableShapeNode,
    getAnnotationAssociationResolver,
    type ICircle,
    type IEdge,
    type IFace,
    type INodeVisual,
    type IShape,
    type IVertex,
    Matrix4,
    Plane,
    Result,
    ShapeTypes,
    setAnnotationAssociationResolver,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { afterEach, beforeAll, describe, expect, test } from "@rstest/core";
import { installAnnotationAssociations } from "../src/features/annotationAssociation";
import type { EdgeRef } from "../src/features/edgeRef";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    setAnnotationAssociationResolver(undefined);
});

function cylinder(radius: number, center = XYZ.zero): IShape {
    const shape = shapeFactory.cylinder(XYZ.unitZ, center, radius, 20).unchecked();
    if (shape === undefined) throw new Error("the kernel refused the cylinder");
    return shape;
}

function circularEdge(shape: IShape): { edge: IEdge; index: number } {
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    for (const [index, edge] of edges.entries()) {
        if (CurveUtils.isCircle(edge.curve.basisCurve)) return { edge, index };
    }
    throw new Error("no circular edge");
}

function picked(edge: IEdge, index: number, node: EditableShapeNode): VisualShapeData {
    return {
        shape: edge,
        owner: { node } as unknown as INodeVisual,
        transform: Matrix4.identity(),
        indexes: [index],
    };
}

function body(shape: IShape): { document: TestDocument; node: EditableShapeNode } {
    const document = new TestDocument();
    const node = new EditableShapeNode({ document, name: "body", shape, id: "body" });
    document.modelManager.addNode(node);
    return { document, node };
}

/** Gives the node the tracked-id surface `IBodyTrackingNode` declares (ids by index). */
function track(node: EditableShapeNode): void {
    const idAt = (index: number) => `e${index}`;
    Object.assign(node, {
        hasTrackedIds: (kind: "edge" | "face") => kind === "edge",
        faceIdAt: () => undefined,
        faceIndexById: () => undefined,
        faceIndexesOfId: () => [],
        edgeIdAt: idAt,
        edgeIndexById: () => undefined,
        edgeIndexesOfId: (id: string) => {
            const edges = node.shape.isOk ? node.shape.value.findSubShapes(ShapeTypes.edge) : [];
            return edges.flatMap((_, index) => (idAt(index) === id ? [index] : []));
        },
    });
}

describe("annotation association resolver", () => {
    test("captures a local edge ref plus the world placement of the text", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const center = (edge.curve.basisCurve as ICircle).center;
        const textPoint = center.add(new XYZ({ x: 20, y: 0, z: 0 }));

        const association = resolver.captureCircleEdge(picked(edge, index, node), textPoint);

        expect(association).not.toBeUndefined();
        expect(association!.nodeId).toBe("body");
        expect(association!.distance).toBeCloseTo(20);
        expect(association!.leader).toEqual({ x: 1, y: 0, z: 0 });
        const ref = association!.edge as EdgeRef;
        expect(ref.kind).toBe("circle");
        if (ref.kind === "circle") expect(ref.radius).toBeCloseTo(10);

        const resolved = resolver.resolveCircleEdge(document, association!);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) {
            expect(resolved.value.radius).toBeCloseTo(10);
            expect(Math.abs(resolved.value.axis.dot(XYZ.unitZ))).toBeCloseTo(1);
        }
    });

    test("re-finds the edge after the source is rebuilt with another radius", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const center = (edge.curve.basisCurve as ICircle).center;
        const association = resolver.captureCircleEdge(
            picked(edge, index, node),
            center.add(new XYZ({ x: 20, y: 0, z: 0 })),
        )!;

        node.shape = Result.ok(cylinder(15));

        const resolved = resolver.resolveCircleEdge(document, association);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value.radius).toBeCloseTo(15);
    });

    test("a tracked id follows a moved circle the fingerprint cannot", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        track(node);
        const { edge, index } = circularEdge(shape);
        const center = (edge.curve.basisCurve as ICircle).center;
        const association = resolver.captureCircleEdge(
            picked(edge, index, node),
            center.add(new XYZ({ x: 20, y: 0, z: 0 })),
        )!;
        expect((association.edge as EdgeRef).edgeId).toBe(`e${index}`);

        node.shape = Result.ok(cylinder(10, new XYZ({ x: 100, y: 0, z: 0 })));

        const resolved = resolver.resolveCircleEdge(document, association);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value.center.x).toBeCloseTo(100);
    });

    test("a rebuilt source moves the dimension without detaching it", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const center = (edge.curve.basisCurve as ICircle).center;
        const textPoint = center.add(new XYZ({ x: 20, y: 0, z: 0 }));
        const association = resolver.captureCircleEdge(picked(edge, index, node), textPoint)!;

        const annotation = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "dimension",
            dimensionType: "radial",
            startPoint: center,
            endPoint: center.add(new XYZ({ x: 10, y: 0, z: 0 })),
            textPoint,
            planeNormal: XYZ.unitZ,
        });
        annotation.association = association;

        // The source's own "shape" event is the whole update trigger.
        node.shape = Result.ok(cylinder(15));

        expect(annotation.value).toBeCloseTo(15);
        expect(annotation.warningCount).toBe(0);
    });

    test("a missing source fails instead of guessing", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const center = (edge.curve.basisCurve as ICircle).center;
        const association = resolver.captureCircleEdge(
            picked(edge, index, node),
            center.add(new XYZ({ x: 20, y: 0, z: 0 })),
        )!;

        // A document that does not hold the source node at all.
        expect(resolver.resolveCircleEdge(new TestDocument(), association).isOk).toBe(false);
    });
});

describe("point and edge anchors", () => {
    test("an edge point remembers its parameter and resolves back onto the edge", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const point = edge.startPoint();

        const anchor = resolver.capturePointAnchor(picked(edge, index, node), point);
        expect(anchor.nodeId).toBe("body");
        expect(anchor.on?.kind).toBe("edge");
        if (anchor.on?.kind === "edge") expect(anchor.on.t).toBeCloseTo(0);

        const resolved = resolver.resolvePointAnchor(document, anchor);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value.distanceTo(point)).toBeCloseTo(0);
    });

    test("a free point resolves to its stored coordinate", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const point = new XYZ({ x: 3, y: 4, z: 5 });

        const anchor = resolver.capturePointAnchor(undefined, point);
        expect(anchor.nodeId).toBeUndefined();

        const resolved = resolver.resolvePointAnchor(new TestDocument(), anchor);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value).toEqual(point);
    });

    test("a face point remembers its surface parameters", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const faces = shape.findSubShapes(ShapeTypes.face);
        const face = faces[0] as IFace;
        const surface = face.surface();
        const bounds = surface.bounds();
        const point = surface.value((bounds.u1 + bounds.u2) / 2, (bounds.v1 + bounds.v2) / 2);

        const anchor = resolver.capturePointAnchor(
            {
                shape: face,
                owner: { node } as unknown as INodeVisual,
                transform: Matrix4.identity(),
                indexes: [0],
            },
            point,
        );
        expect(anchor.nodeId).toBe("body");
        expect(anchor.on?.kind).toBe("face");

        const resolved = resolver.resolvePointAnchor(document, anchor);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value.distanceTo(point)).toBeCloseTo(0);
    });

    test("an edge anchor resolves to the edge's current world line", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);

        const anchor = resolver.captureEdgeAnchor(picked(edge, index, node))!;
        expect(anchor.nodeId).toBe("body");

        const resolved = resolver.resolveEdgeAnchor(document, anchor);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) {
            const expected = edge.ends();
            expect(resolved.value.start.distanceTo(expected[0])).toBeCloseTo(0);
            expect(resolved.value.end.distanceTo(expected[1])).toBeCloseTo(0);
        }
    });

    test("a partially anchored point pair follows only the anchored end", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = cylinder(10);
        const { document, node } = body(shape);
        const { edge, index } = circularEdge(shape);
        const anchored = resolver.capturePointAnchor(picked(edge, index, node), edge.startPoint());
        const freePoint = new XYZ({ x: 50, y: 50, z: 50 });
        const free = resolver.capturePointAnchor(undefined, freePoint);

        node.shape = Result.ok(cylinder(15));

        const start = resolver.resolvePointAnchor(document, anchored);
        const end = resolver.resolvePointAnchor(document, free);
        expect(start.isOk && end.isOk).toBe(true);
        if (!start.isOk || !end.isOk) return;
        expect(end.value).toEqual(freePoint);
        expect(start.value.distanceTo(edge.startPoint())).toBeGreaterThan(1);
    });
});

describe("vertex snaps", () => {
    test("anchors to an adjacent edge endpoint and survives a size change", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const shape = box(20);
        const document = new TestDocument();
        const node = new EditableShapeNode({ document, name: "body", shape, id: "body" });
        document.modelManager.addNode(node);

        // The top-most vertex, so the edge that anchors it moves with the box height.
        const vertices = shape.findSubShapes(ShapeTypes.vertex) as IVertex[];
        const vertex = vertices.reduce((best, item) => (item.point().z > best.point().z ? item : best));
        const anchor = resolver.capturePointAnchor(
            {
                shape: vertex,
                owner: { node } as unknown as INodeVisual,
                transform: Matrix4.identity(),
                indexes: [0],
            },
            vertex.point(),
        );

        expect(anchor.on?.kind).toBe("edge");
        expect(anchor.nodeId).toBe("body");
        expect((anchor.ref as EdgeRef).kind).toBe("line");

        const rebuilt = box(30);
        node.shape = Result.ok(rebuilt);

        const resolved = resolver.resolvePointAnchor(document, anchor);
        expect(resolved.isOk).toBe(true);
        if (!resolved.isOk) return;
        const nearest = Math.min(
            ...(rebuilt.findSubShapes(ShapeTypes.vertex) as IVertex[]).map((item) =>
                item.point().distanceTo(resolved.value),
            ),
        );
        expect(nearest).toBeCloseTo(0);
    });

    function box(dz: number): IShape {
        const shape = shapeFactory.box(Plane.XY, 40, 40, dz).unchecked();
        if (shape === undefined) throw new Error("the kernel refused the box");
        return shape;
    }
});

describe("edge parameter orientation", () => {
    test("an edge anchor survives a reversed parameterization", () => {
        installAnnotationAssociations();
        const resolver = getAnnotationAssociationResolver()!;
        const line = shapeFactory.line(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 })).unchecked()!;
        const document = new TestDocument();
        const node = new EditableShapeNode({ document, name: "edge", shape: line, id: "edge" });
        document.modelManager.addNode(node);

        const point = new XYZ({ x: 2.5, y: 0, z: 0 });
        const anchor = resolver.capturePointAnchor(picked(line, 0, node), point);
        expect(anchor.on?.kind).toBe("edge");
        if (anchor.on?.kind === "edge") expect(anchor.on.t).toBeCloseTo(0.25);

        // Same geometry, parameterized the other way round.
        node.shape = Result.ok(shapeFactory.line(new XYZ({ x: 10, y: 0, z: 0 }), XYZ.zero).unchecked()!);

        const resolved = resolver.resolvePointAnchor(document, anchor);
        expect(resolved.isOk).toBe(true);
        if (resolved.isOk) expect(resolved.value.distanceTo(point)).toBeCloseTo(0);
    });
});
