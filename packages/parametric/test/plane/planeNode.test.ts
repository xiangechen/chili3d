// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GroupNode, type IDocument, Matrix4, Plane, Result, Serializer, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { definitionNodeIds, PlaneNode } from "../../src/plane/planeNode";

function fakeShape(name: string) {
    return { name, isEqual: () => false } as any;
}

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

function setup(): IDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

describe("PlaneNode", () => {
    let restoreFactory: (() => void) | undefined;

    afterEach(() => {
        restoreFactory?.();
        restoreFactory = undefined;
    });

    test("an offset definition resolves to the offset plane and builds a display face", () => {
        const doc = setup();
        const calls: { plane: Plane; width: number; height: number }[] = [];
        restoreFactory = mockShapeFactory({
            rect: (plane: Plane, width: number, height: number) => {
                calls.push({ plane, width, height });
                return Result.ok(fakeShape("rect"));
            },
        });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });
        doc.modelManager.addNode(node);

        expect(node.worldPlane()?.origin.z).toBeCloseTo(10, 6);
        expect(node.worldPlane()?.normal.z).toBeCloseTo(1, 6);
        expect(calls.length).toBeGreaterThan(0);
        // The rect is built centred on the plane: the corner is half a side away.
        expect(calls[0].width).toBeCloseTo(500, 6);
        expect(calls[0].plane.origin.x).toBeCloseTo(-250, 6);
        expect(calls[0].plane.origin.y).toBeCloseTo(-250, 6);
        expect(calls[0].plane.origin.z).toBeCloseTo(10, 6);
        expect(node.warningCount).toBe(0);
    });

    test("a programmatically created plane gets the overlay material", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });

        const material = doc.modelManager.materials.find((candidate) => candidate.name === "Datum Plane");
        expect(material).toBeDefined();
        expect(node.materialId).toBe(material!.id);
        expect(material!.depthWrite).toBe(false);
        expect(material!.polygonOffset).toBe(true);
    });

    test("editing the distance rebuilds the plane", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });
        doc.modelManager.addNode(node);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(10, 6);

        node.distance = 25;
        expect(node.definition.kind).toBe("offset");
        expect(node.definition.kind === "offset" && node.definition.distance).toBe(25);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(25, 6);
    });

    test("a node transform does not redefine the world plane references see", async () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });
        doc.modelManager.addNode(node);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(10, 6);

        // Construction geometry is world-authoritative; transform commands filter it out,
        // and a transform that arrives another way must not desynchronise its references.
        node.transform = Matrix4.fromTranslation(0, 0, 5);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(10, 6);

        // The display rectangle is re-mapped onto the world plane on the queued fit, so
        // the drawing and its pickable quad stay on the same plane as the reference.
        await Promise.resolve();
        expect(node.displayQuad()?.center.z).toBeCloseTo(10, 6);
    });

    test("moving an ancestor re-maps the display square onto the plane", async () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });
        const group = new GroupNode({ document: doc, name: "group" });
        doc.modelManager.addNode(group);
        group.add(node);
        // The mock visual has no scene graph: compose the group's transform as the real
        // visual would, so `worldTransform()` follows an ancestor move.
        (doc.visual.context as any).getVisual = (candidate: any) => ({
            worldTransform: () =>
                candidate === group ? group.transform : group.transform.multiply(node.transform),
        });

        expect(node.worldPlane()?.origin.z).toBeCloseTo(10, 6);
        await Promise.resolve();
        expect(node.displayQuad()?.center.z).toBeCloseTo(10, 6);

        group.transform = Matrix4.fromTranslation(0, 0, 5);
        await Promise.resolve();
        expect(node.displayQuad()?.center.z).toBeCloseTo(10, 6);
    });

    test("only the parameters of the definition's type are exposed", () => {
        const doc = setup();
        const point = (x: number, y: number) => ({
            nodeId: "b",
            vertex: { point: { x, y, z: 0 } },
        });
        const node = new PlaneNode({
            document: doc,
            definition: {
                kind: "threePoint",
                points: [point(0, 0), point(10, 0), point(0, 10)],
            },
        });

        // A three-point plane has no distance/angle/reverse: the property rows are hidden
        // rather than silently accepting edits that do nothing.
        expect(node.distance).toBeUndefined();
        expect(node.angle).toBeUndefined();
        expect(node.reverse).toBeUndefined();
        expect(node.flip).toBe(false);
    });

    test("a non-finite distance is rejected instead of building a NaN plane", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: {
                kind: "offset",
                source: { kind: "datum", name: "XY" },
                distance: Number.NaN,
            },
        });
        doc.modelManager.addNode(node);

        expect(node.shape.isOk).toBe(false);
        expect(node.worldPlane()).toBeUndefined();
        expect(node.warningCount).toBe(1);
    });

    test("flip reverses the normal without moving the plane", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 4 },
        });
        doc.modelManager.addNode(node);
        node.flip = true;
        expect(node.worldPlane()?.normal.z).toBeCloseTo(-1, 6);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(4, 6);
    });

    test("a lost source keeps the last plane instead of failing the node", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const fallback = new Plane({ origin: new XYZ(0, 0, 7), normal: XYZ.unitZ, xvec: XYZ.unitX });
        const node = new PlaneNode({
            document: doc,
            definition: {
                kind: "offset",
                source: {
                    kind: "face",
                    ref: { nodeId: "missing", normal: { x: 0, y: 0, z: 1 }, offset: 0 },
                },
                distance: 0,
            },
            plane: fallback,
        });
        doc.modelManager.addNode(node);

        expect(node.shape.isOk).toBe(true);
        expect(node.worldPlane()?.origin.z).toBeCloseTo(7, 6);
        expect(node.warningCount).toBe(1);
    });

    test("serialization round-trips the definition and the fallback plane", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const node = new PlaneNode({
            document: doc,
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 12 },
        });
        doc.modelManager.addNode(node);
        void node.worldPlane();

        const restored = Serializer.deserializeObject(doc, Serializer.serializeObject(node)) as PlaneNode;
        expect(restored.definitionJson).toBe(node.definitionJson);
        expect(restored.plane?.origin.z).toBeCloseTo(12, 6);
    });

    test("a plane can be built from another plane node", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const base = new PlaneNode({
            document: doc,
            id: "base",
            definition: { kind: "offset", source: { kind: "datum", name: "XY" }, distance: 10 },
        });
        const derived = new PlaneNode({
            document: doc,
            id: "derived",
            definition: {
                kind: "offset",
                source: { kind: "planeNode", nodeId: "base" },
                distance: 5,
            },
        });
        doc.modelManager.addNode(base, derived);

        expect(base.worldPlane()?.origin.z).toBeCloseTo(10, 6);
        expect(derived.worldPlane()?.origin.z).toBeCloseTo(15, 6);
    });

    test("the display square is drawn around the definition's anchor", () => {
        const doc = setup();
        const calls: { plane: Plane; width: number; height: number }[] = [];
        restoreFactory = mockShapeFactory({
            rect: (plane: Plane, width: number, height: number) => {
                calls.push({ plane, width, height });
                return Result.ok(fakeShape("rect"));
            },
        });
        const node = new PlaneNode({
            document: doc,
            definition: {
                kind: "offset",
                source: { kind: "datum", name: "XY" },
                distance: 10,
                anchor: { x: 200, y: 100, z: 10 },
            },
        });
        doc.modelManager.addNode(node);
        expect(node.shape.isOk).toBe(true);

        // Centred on (200, 100, 10), so the corner is half a 500 mm square away.
        expect(calls[0].plane.origin.x).toBeCloseTo(-50, 6);
        expect(calls[0].plane.origin.y).toBeCloseTo(-150, 6);
        expect(calls[0].plane.origin.z).toBeCloseTo(10, 6);
    });

    test("a plane reference cycle terminates with no plane", () => {
        const doc = setup();
        restoreFactory = mockShapeFactory({ rect: () => Result.ok(fakeShape("rect")) });
        const a = new PlaneNode({ document: doc, id: "a", definition: cycleDefinition("b") });
        const b = new PlaneNode({ document: doc, id: "b", definition: cycleDefinition("a") });
        doc.modelManager.addNode(a, b);

        expect(a.worldPlane()).toBeUndefined();
    });

    test("definitionNodeIds lists every source node", () => {
        expect([
            ...definitionNodeIds({
                kind: "offset",
                source: { kind: "planeNode", nodeId: "p" },
                distance: 1,
            }),
        ]).toEqual(["p"]);
        expect([
            ...definitionNodeIds({
                kind: "lineAngle",
                line: {
                    nodeId: "e",
                    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                },
                reference: { kind: "datum", name: "XY" },
                angle: 30,
            }),
        ]).toEqual(["e"]);
    });
});

function cycleDefinition(otherNodeId: string) {
    return {
        kind: "offset" as const,
        source: { kind: "planeNode" as const, nodeId: otherNodeId },
        distance: 1,
    };
}
