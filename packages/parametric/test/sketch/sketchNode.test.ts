// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Plane, Result, Serializer, Transaction, XYZ } from "@chili3d/core";
import { createMockApplication, createMockDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";

function fakeShape(name: string) {
    return { name, isEqual: () => false } as any;
}

/**
 * Mock shapeFactory methods on globalThis, restoring the previous state after each test.
 */
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

const DATA: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 3, 4] },
        { id: 2, type: "circle", params: [1, 2, 7] },
    ],
    constraints: [],
};

describe("SketchNode", () => {
    let doc: IDocument;
    let plane: Plane;
    let restoreFactory: (() => void) | undefined;

    beforeEach(() => {
        doc = createMockDocument();
        plane = Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z: 5 }));
    });

    afterEach(() => {
        restoreFactory?.();
        restoreFactory = undefined;
    });

    function setupFactory() {
        const lineShape = fakeShape("line");
        const line = rs.fn((_start: XYZ, _end: XYZ) => Result.ok(lineShape));
        const circle = rs.fn((_normal: XYZ, _center: XYZ, _radius: number) => Result.ok(fakeShape("circle")));
        const compoundShape = fakeShape("compound");
        const combine = rs.fn((_edges: any[]) => Result.ok(compoundShape));
        restoreFactory = mockShapeFactory({ line, circle, combine });
        return { line, circle, combine, lineShape, compoundShape };
    }

    test("display returns body.sketch", () => {
        const node = new SketchNode({ document: doc, plane, data: DATA });
        expect(node.display()).toBe("body.sketch");
    });

    test("generateShape builds edges with plane-transformed coordinates and combines them", () => {
        const { line, circle, combine, compoundShape } = setupFactory();
        const node = new SketchNode({ document: doc, plane, data: DATA });

        const result = node.generateShape();

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(compoundShape);

        expect(line).toHaveBeenCalledTimes(1);
        const [start, end] = line.mock.calls[0] as unknown as XYZ[];
        expect([start.x, start.y, start.z]).toEqual([0, 0, 5]);
        expect([end.x, end.y, end.z]).toEqual([3, 4, 5]);

        expect(circle).toHaveBeenCalledTimes(1);
        const [normal, center, radius] = circle.mock.calls[0] as unknown as [XYZ, XYZ, number];
        expect([normal.x, normal.y, normal.z]).toEqual([0, 0, 1]);
        expect([center.x, center.y, center.z]).toEqual([1, 2, 5]);
        expect(radius).toBe(7);

        expect(combine).toHaveBeenCalledTimes(1);
        const edges = (combine.mock.calls[0] as unknown as [any[]])[0];
        expect(edges.length).toBe(2);
    });

    test("generateShape returns the edge directly for a single entity", () => {
        const { line, combine, lineShape } = setupFactory();
        const node = new SketchNode({
            document: doc,
            plane,
            data: { entities: [{ id: 1, type: "line", params: [0, 0, 1, 1] }], constraints: [] },
        });

        const result = node.generateShape();

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(lineShape);
        expect(line).toHaveBeenCalledTimes(1);
        expect(combine).not.toHaveBeenCalled();
    });

    test("generateShape builds an arc edge with the counter-clockwise sweep angle", () => {
        const arcShape = fakeShape("arc");
        const arc = rs.fn((_normal: XYZ, _center: XYZ, _start: XYZ, _angle: number) => Result.ok(arcShape));
        restoreFactory = mockShapeFactory({ arc, combine: () => Result.ok(fakeShape("compound")) });
        const node = new SketchNode({
            document: doc,
            plane,
            data: { entities: [{ id: 1, type: "arc", params: [0, 0, 10, 0, 0, 10] }], constraints: [] },
        });

        const result = node.generateShape();

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(arcShape);
        expect(arc).toHaveBeenCalledTimes(1);
        const [normal, center, start, angle] = arc.mock.calls[0] as unknown as [XYZ, XYZ, XYZ, number];
        expect([normal.x, normal.y, normal.z]).toEqual([0, 0, 1]);
        expect([center.x, center.y, center.z]).toEqual([0, 0, 5]);
        expect([start.x, start.y, start.z]).toEqual([10, 0, 5]);
        expect(angle).toBeCloseTo(90, 6);
    });

    test("generateShape sweeps the long way when the end is clockwise of the start", () => {
        const arc = rs.fn((_normal: XYZ, _center: XYZ, _start: XYZ, _angle: number) =>
            Result.ok(fakeShape("arc")),
        );
        restoreFactory = mockShapeFactory({ arc, combine: () => Result.ok(fakeShape("compound")) });
        const node = new SketchNode({
            document: doc,
            plane,
            data: { entities: [{ id: 1, type: "arc", params: [0, 0, 10, 0, 0, -10] }], constraints: [] },
        });

        const result = node.generateShape();

        expect(result.isOk).toBe(true);
        expect((arc.mock.calls[0] as unknown as [XYZ, XYZ, XYZ, number])[3]).toBeCloseTo(270, 6);
    });

    test("generateShape rejects an arc with a degenerate radius or sweep", () => {
        const arc = rs.fn(() => Result.ok(fakeShape("arc")));
        restoreFactory = mockShapeFactory({ arc, combine: () => Result.ok(fakeShape("compound")) });
        const tinyRadius = new SketchNode({
            document: doc,
            plane,
            data: { entities: [{ id: 1, type: "arc", params: [0, 0, 0, 0, 1, 1] }], constraints: [] },
        });
        const zeroSweep = new SketchNode({
            document: doc,
            plane,
            data: { entities: [{ id: 1, type: "arc", params: [0, 0, 10, 0, 20, 0] }], constraints: [] },
        });

        expect(tinyRadius.generateShape().error).toBe("Arc radius is too small");
        expect(zeroSweep.generateShape().error).toBe("Arc sweep angle is too small");
        expect(arc).not.toHaveBeenCalled();
    });

    test("generateShape returns an empty compound when the sketch has no entities", () => {
        const { combine, compoundShape } = setupFactory();
        const node = new SketchNode({ document: doc, plane });
        const result = node.generateShape();
        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(compoundShape);
        expect(combine).toHaveBeenCalledTimes(1);
        expect((combine.mock.calls[0] as unknown as [any[]])[0]).toEqual([]);
    });

    test("generateShape propagates factory errors", () => {
        restoreFactory = mockShapeFactory({
            line: () => Result.err("line failed"),
            circle: () => Result.ok(fakeShape("circle")),
            combine: () => Result.ok(fakeShape("compound")),
        });
        const node = new SketchNode({ document: doc, plane, data: DATA });
        const result = node.generateShape();
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("line failed");
    });

    test("setDataEmitShapeChanged updates data and regenerates the shape", () => {
        const { combine } = setupFactory();
        const node = new SketchNode({ document: doc, plane, data: DATA });
        // Force the lazy first shape generation so we only count the regeneration below.
        expect(node.shape.isOk).toBe(true);
        combine.mockClear();
        const handler = rs.fn((_property: string) => {});
        node.onPropertyChanged(handler);

        const newData: SketchData = {
            entities: [
                { id: 1, type: "line", params: [0, 0, 1, 1] },
                { id: 2, type: "line", params: [1, 1, 2, 2] },
            ],
            constraints: [],
        };
        node.setDataEmitShapeChanged(newData);

        expect(node.data).toEqual(newData);
        expect(handler.mock.calls.map((c) => c[0])).toContain("dataJson");
        expect(combine).toHaveBeenCalledTimes(1);
    });

    test("dataJson changes are undoable and redoable through the property setter", () => {
        setupFactory();
        const testDoc = new TestDocument({ application: createMockApplication() });
        const node = new SketchNode({ document: testDoc, plane, data: DATA });
        const newData: SketchData = {
            entities: [{ id: 1, type: "line", params: [0, 0, 1, 1] }],
            constraints: [],
        };

        Transaction.execute(testDoc, "edit sketch", () => node.setDataEmitShapeChanged(newData));
        expect(node.data).toEqual(newData);

        testDoc.history.undo();
        expect(node.data).toEqual(DATA);

        testDoc.history.redo();
        expect(node.data).toEqual(newData);
    });

    test("Serializer round-trips plane and data", () => {
        setupFactory();
        const node = new SketchNode({ document: doc, plane, data: DATA });

        const serialized = Serializer.serializeObject(node);
        expect(serialized["dataJson"]).toBe(JSON.stringify(DATA));

        const restored = Serializer.deserializeObject(doc, serialized) as SketchNode;
        expect(restored).toBeInstanceOf(SketchNode);
        expect(restored.plane.origin.x).toBe(node.plane.origin.x);
        expect(restored.plane.origin.z).toBe(5);
        expect(restored.plane.normal.z).toBe(1);
        expect(restored.plane.xvec.x).toBe(1);
        expect(restored.data).toEqual(DATA);
    });
});
