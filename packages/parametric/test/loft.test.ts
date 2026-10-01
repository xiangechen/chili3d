// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, Plane, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type SketchData, SketchNode } from "../src/sketch";
import "../src/features"; // registers all feature handlers
import type { EdgeRef } from "../src/features/edgeRef";
import { featureHandler, type LoftFeatureData, type LoftSectionData } from "../src/features/feature";
import { validateLoftSections } from "../src/features/loft";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
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

const OFFSET_SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [5, 5, 7, 5] },
        { id: 2, type: "line", params: [7, 5, 7, 7] },
        { id: 3, type: "line", params: [7, 7, 5, 7] },
        { id: 4, type: "line", params: [5, 7, 5, 5] },
    ],
    constraints: [],
};

function edge(start: XYZ, end: XYZ) {
    const self: any = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
        },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: () => [],
        boundingBox: () =>
            new BoundingBox(
                { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) },
            ),
        isEqual: () => false,
        isSame: (other: any) => other === self,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [self] : []),
    };
    return self;
}

function setupMocks() {
    const loftedShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
    const combine = rs.fn((edges: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    /** The wire keeps its loop edges; the face exposes the boundary edges of all its wires. */
    const wire = rs.fn((edges: any[]) =>
        Result.ok({
            isClosed: () => edges.length > 1,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        }),
    );
    const loft = rs.fn((_sections: any[], _isSolid: boolean, _isRuled: boolean, _continuity: string) =>
        Result.ok(loftedShape),
    );
    const loftTracked = rs.fn((_sections: any[], _isSolid: boolean, _isRuled: boolean, _continuity: string) =>
        Result.ok({
            shape: loftedShape,
            faceAncestors: [],
            edgeAncestors: [],
            faceEdgeMap: [],
            capFaces: [],
        }),
    );
    const restore = mockShapeFactory({ line, combine, wire, face, loft, loftTracked });
    return { line, combine, wire, face, loft, loftTracked, loftedShape, restore };
}

describe("loft feature", () => {
    let doc: TestDocument;
    let sketch1: SketchNode;
    let sketch2: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
        sketch1 = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        sketch2 = new SketchNode({ document: doc, plane: Plane.XY, data: OFFSET_SQUARE });
        doc.modelManager.addNode(sketch1, sketch2);
    });

    afterEach(() => mocks.restore());

    function bodyWith(features: LoftFeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    /** The profile section of a one-loop sketch, captured exactly as the command does. */
    function profileSection(sketch: SketchNode): LoftSectionData {
        const profileSet = sketchProfiles(sketch);
        expect(profileSet.isOk).toBe(true);
        const profiles = allProfiles(profileSet.value);
        expect(profiles).toHaveLength(1);
        return { kind: "profile", nodeId: sketch.id, profile: captureProfileRef(profiles[0]) };
    }

    function loftFeature(sections: LoftSectionData[], overrides?: Partial<LoftFeatureData>): LoftFeatureData {
        return {
            id: "l1",
            type: "loft",
            sections,
            isSolid: true,
            isRuled: false,
            continuity: "c2",
            ...overrides,
        };
    }

    /** Smallest x of every edge start point of a resolved section — tells the two squares apart. */
    function sectionMinX(section: any): number {
        return Math.min(
            ...(section.findSubShapes(ShapeTypes.edge) as any[]).map((e) => e.startPoint().x as number),
        );
    }

    test("is registered with its ribbon identity and no reselect", () => {
        const handler = featureHandler("loft");
        expect(handler).toBeDefined();
        expect(handler!.display).toBe("command.feature.loft");
        expect(handler!.icon).toBe("icon-loft");
        expect(handler!.reselectable).not.toBe(true);
    });

    test("lofts two sketch profiles in section order through the tracked kernel", () => {
        const body = bodyWith([loftFeature([profileSection(sketch1), profileSection(sketch2)])]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.loftedShape);
        expect(mocks.loftTracked).toHaveBeenCalledTimes(1);
        expect(mocks.loft).not.toHaveBeenCalled();
        const [sections, isSolid, isRuled, continuity] = mocks.loftTracked.mock.calls[0] as unknown as [
            any[],
            boolean,
            boolean,
            string,
        ];
        expect(sections).toHaveLength(2);
        expect(sectionMinX(sections[0])).toBe(0);
        expect(sectionMinX(sections[1])).toBe(5);
        expect([isSolid, isRuled, continuity]).toEqual([true, false, "c2"]);
    });

    test("falls back to the untracked loft when the kernel has no loftTracked", () => {
        (globalThis.shapeFactory as any).loftTracked = undefined;
        const body = bodyWith([loftFeature([profileSection(sketch1), profileSection(sketch2)])]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.loftedShape);
        expect(mocks.loft).toHaveBeenCalledTimes(1);
    });

    test("re-anchors the stored profile refs to what the evaluation matched", () => {
        const sections = [profileSection(sketch1), profileSection(sketch2)];
        const body = bodyWith([loftFeature(sections)]);

        expect(body.shape.isOk).toBe(true);
        const stored = (body.features[0] as LoftFeatureData).sections;
        expect(stored[0]).toEqual(sections[0]);
        expect(stored[1]).toEqual(sections[1]);
    });

    test("a missing section node surfaces as a feature error", () => {
        const missing: LoftSectionData = {
            kind: "profile",
            nodeId: "deleted",
            profile: (profileSection(sketch2) as { profile: ProfileRef }).profile,
        };
        const body = bodyWith([loftFeature([profileSection(sketch1), missing])]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Extrude source body not found");
        expect(mocks.loftTracked).not.toHaveBeenCalled();
    });

    test("a lost sketch profile surfaces as a feature error", () => {
        const triangle: LoftSectionData = {
            kind: "profile",
            nodeId: sketch1.id,
            profile: {
                edges: [
                    { kind: "line", start: { x: 5, y: 5, z: 0 }, end: { x: 7, y: 5, z: 0 } },
                    { kind: "line", start: { x: 7, y: 5, z: 0 }, end: { x: 6, y: 7, z: 0 } },
                    { kind: "line", start: { x: 6, y: 7, z: 0 }, end: { x: 5, y: 5, z: 0 } },
                ],
            },
        };
        const body = bodyWith([loftFeature([profileSection(sketch2), triangle])]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Sketch profile not found after rebuild");
    });

    test("an invalid continuity surfaces as a feature error", () => {
        const sections = [profileSection(sketch1), profileSection(sketch2)];
        const body = bodyWith([loftFeature(sections, { continuity: "g3" as any })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Invalid continuity: g3");
        expect(mocks.loftTracked).not.toHaveBeenCalled();
    });

    test("too few sections surface as a feature error", () => {
        const body = bodyWith([loftFeature([profileSection(sketch1)])]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Loft requires at least 2 sections");
    });

    describe("vertex sections", () => {
        const VERTEX_POINT = { x: 0.5, y: 0.5, z: 0 };

        /** A sketch node whose shape is stubbed to expose a single vertex at VERTEX_POINT. */
        function vertexHost() {
            const host = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
            doc.modelManager.addNode(host);
            const vertex = {
                shapeType: ShapeTypes.vertex,
                point: () => new XYZ(VERTEX_POINT),
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: () => [],
            };
            const shape = {
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.vertex ? [vertex] : []),
            };
            Object.defineProperty(host, "shape", { value: Result.ok(shape), configurable: true });
            return host;
        }

        test("a vertex end section lofts through the tracked kernel", () => {
            const host = vertexHost();
            const vertex: LoftSectionData = {
                kind: "vertex",
                nodeId: host.id,
                vertex: { point: VERTEX_POINT },
            };
            const body = bodyWith([loftFeature([vertex, profileSection(sketch1)])]);

            expect(body.shape.isOk).toBe(true);
            const [sections] = mocks.loftTracked.mock.calls[0] as unknown as [any[]];
            expect(sections[0].shapeType).toBe(ShapeTypes.vertex);
            expect(sections[0].point().z).toBe(0);
            expect(sectionMinX(sections[1])).toBe(0);
        });

        test("a vertex that no longer matches surfaces as a feature error", () => {
            const host = vertexHost();
            const vertex: LoftSectionData = {
                kind: "vertex",
                nodeId: host.id,
                vertex: { point: { x: 99, y: 99, z: 99 } },
            };
            const body = bodyWith([loftFeature([vertex, profileSection(sketch1)])]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Loft section vertex not found after rebuild");
        });
    });

    describe("section validation", () => {
        const vertex: LoftSectionData = {
            kind: "vertex",
            nodeId: "n",
            vertex: { point: { x: 0, y: 0, z: 0 } },
        };
        const profile: LoftSectionData = { kind: "profile", nodeId: "n", profile: { edges: [] } };

        test.each([
            { sections: [] as LoftSectionData[], error: "Loft requires at least 2 sections" },
            { sections: [profile] as LoftSectionData[], error: "Loft requires at least 2 sections" },
            {
                sections: [vertex, vertex] as LoftSectionData[],
                error: "Loft requires at least 1 wire section",
            },
            {
                sections: [profile, vertex, profile] as LoftSectionData[],
                error: "Loft vertex sections must be first or last",
            },
        ])("$error", ({ sections, error }) => {
            const result = validateLoftSections(sections);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe(error);
        });

        test.each([
            { sections: [vertex, profile] as LoftSectionData[] },
            { sections: [profile, vertex] as LoftSectionData[] },
            { sections: [profile, profile, profile] as LoftSectionData[] },
        ])("accepts %#", ({ sections }) => {
            expect(validateLoftSections(sections).isOk).toBe(true);
        });
    });

    describe("handler plumbing", () => {
        const edge: LoftSectionData = {
            kind: "edge",
            nodeId: "b1",
            edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        };
        const profileA: LoftSectionData = { kind: "profile", nodeId: "s1", profile: { edges: [] } };
        const profileB: LoftSectionData = { kind: "profile", nodeId: "s1", profile: { edges: [] } };
        const feature = loftFeature([profileA, edge, profileB]);

        test("nodeIds dedupe the section nodes", () => {
            expect(featureHandler("loft")!.nodeIds(feature)).toEqual(["s1", "b1"]);
        });

        test("references list one row per section, in order", () => {
            expect(featureHandler("loft")!.references!(feature)).toEqual([
                { key: "section0", display: "feature.loft.section", nodeId: "s1" },
                { key: "section1", display: "feature.loft.section", nodeId: "b1" },
                { key: "section2", display: "feature.loft.section", nodeId: "s1" },
            ]);
        });

        test("applyResolvedRefs consumes profiles and edges in section order, vertices untouched", () => {
            const p1 = { edges: [] } as ProfileRef;
            const p2 = {
                edges: [{ kind: "line", start: { x: 9, y: 9, z: 0 }, end: { x: 8, y: 9, z: 0 } }],
            } as ProfileRef;
            const e1 = {
                kind: "circle",
                center: { x: 0, y: 0, z: 0 },
                radius: 1,
                axis: { x: 0, y: 0, z: 1 },
            } as EdgeRef;
            const next = featureHandler("loft")!.applyResolvedRefs!(feature, {
                resolvedProfiles: [p1, p2],
                resolvedEdges: [e1],
            }) as LoftFeatureData;

            expect(next.sections[0]).toEqual({ ...profileA, profile: p1 });
            expect(next.sections[1]).toEqual({ ...edge, edge: e1 });
            expect(next.sections[2]).toEqual({ ...profileB, profile: p2 });
        });

        test("applyResolvedRefs with nothing resolved returns the feature unchanged", () => {
            expect(featureHandler("loft")!.applyResolvedRefs!(feature, {})).toBe(feature);
        });

        test("setParameter normalizes booleans and passes strings through", () => {
            const handler = featureHandler("loft")!;
            expect((handler.setParameter(feature, "isRuled", "true") as LoftFeatureData).isRuled).toBe(true);
            expect((handler.setParameter(feature, "isSolid", false) as LoftFeatureData).isSolid).toBe(false);
            expect((handler.setParameter(feature, "continuity", "c1") as LoftFeatureData).continuity).toBe(
                "c1",
            );
        });

        test("parameters expose isSolid, isRuled and continuity", () => {
            expect(featureHandler("loft")!.parameters!(feature)).toEqual([
                { key: "isSolid", display: "option.command.isSolid", value: true },
                { key: "isRuled", display: "option.command.isRuled", value: false },
                { key: "continuity", display: "option.command.continuity", value: "c2" },
            ]);
        });
    });
});
