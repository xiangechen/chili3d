// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import { Result } from "../src/foundation";
import { Matrix4, XYZ } from "../src/math";
import { DimensionAnnotation, RefSegmentAnnotation, TextAnnotation } from "../src/model/annotation";
import {
    type CircleEdgeAssociation,
    type EdgePairAssociation,
    type IAnnotationAssociationResolver,
    type PointPairAssociation,
    setAnnotationAssociationResolver,
} from "../src/model/annotationAssociation";
import {
    angleFromLines,
    angleTextPlacement,
    angleTextPoint,
    angularDimensionLayout,
    angularDimensionSweep,
} from "../src/model/dimensionLayout";
import { FolderNode } from "../src/model/folderNode";
import { GroupNode } from "../src/model/groupNode";
import { retargetInstanceSources } from "../src/model/instanceNodeContract";
import { Serializer } from "../src/serialize";
import { TestDocument } from "../test-utils";

const CIRCLE = { center: new XYZ({ x: 10, y: 0, z: 0 }), radius: 5, axis: XYZ.unitZ };

function association(nodeId = "source"): CircleEdgeAssociation {
    return {
        kind: "circleEdge",
        nodeId,
        edge: { kind: "circle", center: { x: 0, y: 0, z: 0 }, radius: 10, axis: { x: 0, y: 0, z: 1 } },
        axis: { x: 0, y: 0, z: 1 },
        leader: { x: 1, y: 0, z: 0 },
        distance: 20,
    };
}

function dimension(document: TestDocument): DimensionAnnotation {
    return new DimensionAnnotation({
        document,
        annotationType: "dimension",
        name: "dimension",
        dimensionType: "radial",
        startPoint: XYZ.zero,
        endPoint: new XYZ({ x: 10, y: 0, z: 0 }),
        textPoint: new XYZ({ x: 20, y: 0, z: 0 }),
        planeNormal: XYZ.unitZ,
    });
}

/** A resolver whose `resolve` answers `result` and counts calls. */
function resolver(
    result: Result<{ center: XYZ; radius: number; axis: XYZ }>,
): IAnnotationAssociationResolver & { calls: number } {
    const stub = {
        calls: 0,
        captureCircleEdge: () => undefined,
        capturePointAnchor: (_picked: unknown, point: XYZ) => ({ point }),
        captureEdgeAnchor: () => undefined,
        resolveCircleEdge: () => {
            stub.calls++;
            return result;
        },
        resolvePointAnchor: () => Result.err("unused"),
        resolveEdgeAnchor: () => Result.err("unused"),
    };
    return stub;
}

afterEach(() => {
    setAnnotationAssociationResolver(undefined);
});

describe("DimensionAnnotation association", () => {
    test("re-resolving moves the attachment points onto the current circle", () => {
        const document = new TestDocument();
        const stub = resolver(Result.ok(CIRCLE));
        setAnnotationAssociationResolver(stub);
        const anno = dimension(document);
        anno.association = association();
        const undoBefore = document.history.undoCount();

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.startPoint).toEqual(new XYZ({ x: 10, y: 0, z: 0 }));
        expect(anno.endPoint).toEqual(new XYZ({ x: 15, y: 0, z: 0 }));
        expect(anno.textPoint).toEqual(new XYZ({ x: 30, y: 0, z: 0 }));
        expect(anno.planeNormal?.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(anno.value).toBeCloseTo(5);
        expect(anno.warningCount).toBe(0);
        // Derived writes never enter the undo stack.
        expect(document.history.undoCount()).toBe(undoBefore);
    });

    test("a diameter dimension keeps its symmetric span", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(resolver(Result.ok(CIRCLE)));
        const anno = dimension(document);
        anno.dimensionType = "diameter";
        anno.association = association();

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.startPoint).toEqual(new XYZ({ x: 5, y: 0, z: 0 }));
        expect(anno.endPoint).toEqual(new XYZ({ x: 15, y: 0, z: 0 }));
        expect(anno.value).toBeCloseTo(10);
    });

    test("a failed resolve keeps the last points and turns on the warning", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(resolver(Result.err("gone")));
        const anno = dimension(document);
        anno.association = association();
        const before = anno.startPoint;

        expect(anno.updateFromAssociation(true)).toBe(false);

        expect(anno.startPoint).toBe(before);
        expect(anno.warningCount).toBe(1);
        expect(anno.warningTooltip).toBe("annotation.referenceLost{0}");
    });

    test("without a resolver the dimension stays static and unflagged", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();
        const before = anno.startPoint;

        expect(anno.updateFromAssociation()).toBe(false);

        expect(anno.startPoint).toBe(before);
        expect(anno.warningCount).toBe(0);
    });

    test("the association survives serialization as JSON", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();

        const serialized = Serializer.serializeObject(anno);
        expect(typeof serialized["associationJson"]).toBe("string");

        const restored = Serializer.deserializeObject(document, serialized) as DimensionAnnotation;
        expect(restored.association).toEqual(association());
    });

    test("the source's shape and transform changes re-resolve; detaching stops it", () => {
        const document = new TestDocument();
        const source = new FolderNode({ document, name: "source" });
        document.modelManager.addNode(source);
        const stub = resolver(Result.ok(CIRCLE));
        setAnnotationAssociationResolver(stub);

        const anno = dimension(document);
        anno.association = association(source.id);
        expect(anno.updateFromAssociation()).toBe(true);
        expect(stub.calls).toBe(1);

        (source as any).emitPropertyChanged("shape", undefined);
        expect(stub.calls).toBe(2);

        (source as any).emitPropertyChanged("transform", undefined);
        expect(stub.calls).toBe(3);

        anno.association = undefined;
        (source as any).emitPropertyChanged("shape", undefined);
        expect(stub.calls).toBe(3);
    });
});

/** A resolver whose overrides answer; everything else refuses. */
function stubResolver(
    overrides: Partial<IAnnotationAssociationResolver> = {},
): IAnnotationAssociationResolver {
    return {
        captureCircleEdge: () => undefined,
        capturePointAnchor: (_picked, point) => ({ point }),
        captureEdgeAnchor: () => undefined,
        resolveCircleEdge: () => Result.err("unused"),
        resolvePointAnchor: () => Result.err("unused"),
        resolveEdgeAnchor: () => Result.err("unused"),
        ...overrides,
    };
}

function linearAssociation(): PointPairAssociation {
    return {
        kind: "pointPair",
        start: { point: { x: 0, y: 0, z: 0 } },
        end: { point: { x: 10, y: 0, z: 0 } },
        placement: { along: 5, lateral: 10, normal: { x: 0, y: 0, z: 1 } },
    };
}

describe("the other annotation kinds follow their associations", () => {
    test("a linear dimension moves both ends and keeps the label's frame", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(
            stubResolver({
                resolvePointAnchor: (_document, anchor) =>
                    Result.ok(new XYZ(anchor.point).add(new XYZ({ x: 0, y: 5, z: 0 }))),
            }),
        );
        const anno = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "linear",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 10, y: 0, z: 0 }),
            textPoint: new XYZ({ x: 5, y: 10, z: 0 }),
        });
        anno.association = linearAssociation();

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.startPoint).toEqual(new XYZ({ x: 0, y: 5, z: 0 }));
        expect(anno.endPoint).toEqual(new XYZ({ x: 10, y: 5, z: 0 }));
        // `along` from the new start, `lateral` toward the captured plane's side.
        expect(anno.textPoint).toEqual(new XYZ({ x: 5, y: 15, z: 0 }));
        expect(anno.value).toBeCloseTo(10);
    });

    test("a free endpoint keeps its coordinate while the anchored one moves", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(
            stubResolver({
                resolvePointAnchor: (_document, anchor) =>
                    anchor.nodeId === undefined
                        ? Result.ok(new XYZ(anchor.point))
                        : Result.ok(new XYZ({ x: 20, y: 0, z: 0 })),
            }),
        );
        const anno = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "linear",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 20, y: 0, z: 0 }),
            textPoint: new XYZ({ x: 10, y: 5, z: 0 }),
        });
        anno.association = {
            ...linearAssociation(),
            start: { point: { x: 0, y: 0, z: 0 } },
            end: { nodeId: "body", ref: {}, point: { x: 10, y: 0, z: 0 } },
        };

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.startPoint).toEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(anno.endPoint).toEqual(new XYZ({ x: 20, y: 0, z: 0 }));
    });

    test("an angular dimension recomputes its vertex, directions and sweep", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(
            stubResolver({
                resolveEdgeAnchor: (_document, anchor) =>
                    Result.ok(
                        anchor.nodeId === "first"
                            ? { start: XYZ.zero, end: new XYZ({ x: 10, y: 0, z: 0 }) }
                            : { start: XYZ.zero, end: new XYZ({ x: 0, y: 10, z: 0 }) },
                    ),
            }),
        );
        const anno = new DimensionAnnotation({
            document,
            annotationType: "dimension",
            name: "angle",
            dimensionType: "angular",
            centerPoint: XYZ.zero,
            startPoint: new XYZ({ x: 1, y: 0, z: 0 }),
            endPoint: new XYZ({ x: 0, y: 1, z: 0 }),
            textPoint: new XYZ({ x: 5, y: 5, z: 0 }),
        });
        const association: EdgePairAssociation = {
            kind: "edgePair",
            first: { nodeId: "first", ref: {} },
            second: { nodeId: "second", ref: {} },
            placement: { radius: 8, reflex: false, flip: false },
        };
        anno.association = association;

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.centerPoint).toEqual(XYZ.zero);
        expect(anno.startPoint.distanceTo(XYZ.zero)).toBeCloseTo(1);
        expect(anno.endPoint.distanceTo(XYZ.zero)).toBeCloseTo(1);
        expect(anno.value).toBeCloseTo(90);
        // The label sits on the sector's bisector at the captured radius.
        expect(anno.textPoint.distanceTo(XYZ.zero)).toBeCloseTo(8);
        expect(anno.textPoint.x).toBeCloseTo(anno.textPoint.y);
    });

    test("a text leader follows its anchor and carries the text along", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(
            stubResolver({
                resolvePointAnchor: () => Result.ok(new XYZ({ x: 0, y: 5, z: 0 })),
            }),
        );
        const anno = new TextAnnotation({
            document,
            annotationType: "text",
            name: "note",
            content: "note",
            position: new XYZ({ x: 10, y: 0, z: 0 }),
            leaderPoint: XYZ.zero,
        });
        anno.association = {
            kind: "point",
            anchor: { nodeId: "body", ref: {}, point: { x: 0, y: 0, z: 0 } },
        };

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.leaderPoint).toEqual(new XYZ({ x: 0, y: 5, z: 0 }));
        expect(anno.position).toEqual(new XYZ({ x: 10, y: 5, z: 0 }));
    });

    test("a reference segment follows both ends", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(
            stubResolver({
                resolvePointAnchor: (_document, anchor) =>
                    Result.ok(new XYZ(anchor.point).add(new XYZ({ x: 1, y: 0, z: 0 }))),
            }),
        );
        const anno = new RefSegmentAnnotation({
            document,
            annotationType: "refSegment",
            name: "segment",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 10, y: 0, z: 0 }),
        });
        anno.association = {
            kind: "pointPair",
            start: { point: { x: 0, y: 0, z: 0 } },
            end: { point: { x: 10, y: 0, z: 0 } },
        };

        expect(anno.updateFromAssociation()).toBe(true);

        expect(anno.startPoint).toEqual(new XYZ({ x: 1, y: 0, z: 0 }));
        expect(anno.endPoint).toEqual(new XYZ({ x: 11, y: 0, z: 0 }));
    });
});

describe("angular label placement", () => {
    function labelAt(degrees: number, radius = 5): XYZ {
        const radians = (degrees * Math.PI) / 180;
        return new XYZ({ x: Math.cos(radians) * radius, y: Math.sin(radians) * radius, z: 0 });
    }

    test("keeps both the drawn side and the measured sweep across a rebuild", () => {
        const vertex = XYZ.zero;
        const p1 = new XYZ({ x: 1, y: 0, z: 0 });
        const p2 = new XYZ({ x: 0, y: 1, z: 0 });

        // Short sector, reflex without the layout's half-turn, and the two ranges that
        // make it flip while still measuring the reflex (91°–135° / 315°–360°).
        for (const degrees of [45, 225, 100, 120, 133, 330, 350]) {
            const textPoint = labelAt(degrees);
            const before = angularDimensionLayout(vertex, p1, p2, textPoint, 1)!;
            const beforeSweep = angularDimensionSweep(vertex, p1, p2, textPoint)!;

            const placement = angleTextPlacement(vertex, p1, p2, textPoint)!;
            const next = angleTextPoint(vertex, p1, p2, placement)!;
            const after = angularDimensionLayout(vertex, p1, p2, next, 1)!;
            const afterSweep = angularDimensionSweep(vertex, p1, p2, next)!;

            expect(after.textPosition.distanceTo(before.textPosition)).toBeCloseTo(0);
            expect(afterSweep).toBeCloseTo(beforeSweep);
        }
    });
});

describe("association lifecycle", () => {
    afterEach(() => {
        setAnnotationAssociationResolver(undefined);
    });

    test("a resolve emits one point change instead of one per property", () => {
        const document = new TestDocument();
        setAnnotationAssociationResolver(stubResolver({ resolveCircleEdge: () => Result.ok(CIRCLE) }));
        const anno = dimension(document);
        anno.association = association();

        let changes = 0;
        anno.onPropertyChanged(() => changes++);
        expect(anno.updateFromAssociation()).toBe(true);
        expect(changes).toBe(1);
    });

    test("cloning an annotation drops the association on the copy only", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();

        const clone = anno.clone();
        expect(clone.association).toBeUndefined();
        expect(anno.association).not.toBeUndefined();
    });

    test("a plain transform write keeps the association (group normalization)", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();

        // GroupCommand normalizes a member's transform to world space this way.
        anno.transform = Matrix4.fromTranslation(1, 2, 3);

        expect(anno.association).not.toBeUndefined();
    });

    test("an explicit placement detaches the association", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();

        anno.detachAssociation();

        expect(anno.association).toBeUndefined();
    });

    test("a removed annotation stops following its source", () => {
        const document = new TestDocument();
        const source = new FolderNode({ document, name: "source" });
        document.modelManager.addNode(source);
        const stub = { calls: 0 } as { calls: number };
        setAnnotationAssociationResolver(
            stubResolver({
                resolveCircleEdge: () => {
                    stub.calls++;
                    return Result.ok(CIRCLE);
                },
            }),
        );
        const anno = dimension(document);
        document.modelManager.addNode(anno);
        anno.association = association(source.id);
        anno.updateFromAssociation(true);
        expect(stub.calls).toBe(1);

        anno.parent?.remove(anno);
        (source as any).emitPropertyChanged("shape", undefined);

        expect(stub.calls).toBe(1);
    });

    test("an ancestor's transform re-resolves the annotation", () => {
        const document = new TestDocument();
        const group = new GroupNode({ document, name: "group" });
        const source = new FolderNode({ document, name: "source" });
        group.add(source);
        document.modelManager.addNode(group);
        const stub = { calls: 0 } as { calls: number };
        setAnnotationAssociationResolver(
            stubResolver({
                resolveCircleEdge: () => {
                    stub.calls++;
                    return Result.ok(CIRCLE);
                },
            }),
        );
        const anno = dimension(document);
        anno.association = association(source.id);
        anno.updateFromAssociation(true);
        expect(stub.calls).toBe(1);

        group.transform = Matrix4.fromTranslation(5, 0, 0);

        expect(stub.calls).toBe(2);
    });

    test("retargeting an instance source rewrites the annotation's node id", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        document.modelManager.addNode(anno);
        anno.association = association("old-body");

        expect(retargetInstanceSources(document, "old-body", "new-body")).toBe(1);
        expect(anno.association?.kind === "circleEdge" && anno.association.nodeId).toBe("new-body");
    });

    test("nearly parallel lines have no angle geometry", () => {
        const first = { start: XYZ.zero, end: new XYZ({ x: 10, y: 0, z: 0 }) };
        const second = { start: XYZ.zero, end: new XYZ({ x: 10, y: 0.001, z: 0 }) };

        expect(angleFromLines(first, second)).toBeUndefined();
    });
});

describe("clone history", () => {
    test("clearing the copy's association adds no undo step", () => {
        const document = new TestDocument();
        const anno = dimension(document);
        anno.association = association();
        const before = document.history.undoCount();

        anno.clone();

        expect(document.history.undoCount()).toBe(before);
    });
});
