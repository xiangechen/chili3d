// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type ICurve,
    type IEdge,
    Matrix4,
    Plane,
    PlaneAngle,
    type PointSnapData,
    ShapeTypes,
    type SnapResult,
    type VisualNode,
    XYZ,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { ArrayCommand } from "../../../src/commands/modify/array";
import {
    makeParent,
    mockShape,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../../commands/commandTestUtils";

/** A unit bounding box used by mock clones so Component construction works. */
const UNIT_BOX = new BoundingBox(XYZ.zero, new XYZ({ x: 1, y: 1, z: 1 }));

/**
 * A fake VisualNode whose `clone()` returns an independent copy with its own
 * transform matrix (so `cloned.transform = cloned.transform.multiply(m)` in
 * ArrayCommand.cloneNodes doesn't corrupt shared state). Records its parent so
 * `model.parent?.remove(model)` is observable. Clones carry a `boundingBox()`
 * so the isGroup=true Component-merge path doesn't blow up.
 */
function makeMockModel(opts: { parent?: TrackingParent } = {}): VisualNode {
    const parent = opts.parent ?? makeParent();
    const node = {
        parent,
        previousSibling: undefined,
        nextSibling: undefined,
        transform: Matrix4.identity(),
        clone() {
            return {
                parent: undefined,
                previousSibling: undefined,
                nextSibling: undefined,
                transform: Matrix4.identity(),
                boundingBox: () => UNIT_BOX,
            };
        },
    };
    return node as unknown as VisualNode;
}

/** A PointStep-shaped SnapResult carrying just a `.point`. */
function pointStep(point: XYZ, plane: Plane = Plane.XY): SnapResult {
    return {
        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as any,
        type: "input",
        point,
        plane,
        shapes: [],
    } as SnapResult;
}

/** Install a stub global app returning ok shapes for any factory method. */
function installStubApp() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => ({
            shapeProvider: {
                factory: new Proxy({}, { get: () => () => mockShape({ shapeType: ShapeTypes.edge }) }),
                converter: {},
            },
        }),
    });
    return () => {
        if (previous) Object.defineProperty(globalThis, "app", previous);
    };
}

describe("ArrayCommand", () => {
    test("should have command metadata", () => {
        const data = (ArrayCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.array");
        expect(data.icon).toBe("icon-array");
    });

    test("patternType should default to 'option.command.patternType.linear'", () => {
        const cmd = new ArrayCommand();
        expect(cmd.patternType).toBe("option.command.patternType.linear");
    });

    test("patternType setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.patternType = "option.command.patternType.circular";
        expect(cmd.patternType).toBe("option.command.patternType.circular");

        cmd.patternType = "option.command.patternType.curve";
        expect(cmd.patternType).toBe("option.command.patternType.curve");

        cmd.patternType = "option.command.patternType.rectangular";
        expect(cmd.patternType).toBe("option.command.patternType.rectangular");
    });

    test("count should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.count).toBe(3);
    });

    test("count setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.count = 5;
        expect(cmd.count).toBe(5);

        cmd.count = 10;
        expect(cmd.count).toBe(10);
    });

    test("isGroup should default to true", () => {
        const cmd = new ArrayCommand();
        expect(cmd.isGroup).toBe(true);
    });

    test("isGroup setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.isGroup = false;
        expect(cmd.isGroup).toBe(false);
    });

    test("numberX should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberX).toBe(3);
    });

    test("numberX setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberX = 4;
        expect(cmd.numberX).toBe(4);
    });

    test("numberY should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberY).toBe(3);
    });

    test("numberY setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberY = 5;
        expect(cmd.numberY).toBe(5);
    });

    test("numberZ should default to 3", () => {
        const cmd = new ArrayCommand();
        expect(cmd.numberZ).toBe(3);
    });

    test("numberZ setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.numberZ = 6;
        expect(cmd.numberZ).toBe(6);
    });

    test("showCount should reflect patternType (true for non-rectangular)", () => {
        const cmd = new ArrayCommand();
        cmd.patternType = "option.command.patternType.linear";
        expect(cmd.showCount).toBe(true);

        cmd.patternType = "option.command.patternType.rectangular";
        expect(cmd.showCount).toBe(false);
    });

    test("showCount setter should update property", () => {
        const cmd = new ArrayCommand();
        cmd.showCount = false;
        expect(cmd.showCount).toBe(false);

        cmd.showCount = true;
        expect(cmd.showCount).toBe(true);
    });

    test("getSteps should return appropriate steps for each pattern type", () => {
        const cmd = new ArrayCommand();

        cmd.patternType = "option.command.patternType.linear";
        expect((cmd as any).getSteps().length).toBe(2);

        cmd.patternType = "option.command.patternType.circular";
        expect((cmd as any).getSteps().length).toBe(3);

        cmd.patternType = "option.command.patternType.curve";
        expect((cmd as any).getSteps().length).toBe(1);

        cmd.patternType = "option.command.patternType.rectangular";
        expect((cmd as any).getSteps().length).toBe(4);
    });

    test("getArrayTransforms should throw for an invalid pattern type", () => {
        const cmd = new ArrayCommand();
        (cmd as any)._patternType = "option.command.patternType.unknown";
        expect(() => (cmd as any).getArrayTransforms()).toThrow("Invalid pattern type");
    });

    test("getLinearTransforms should return count identity-shaped translations", () => {
        const cmd = new ArrayCommand();
        cmd.count = 1;
        wireCommand(cmd);
        const id = (cmd as any).getLinearTransforms(XYZ.unitX);
        expect(id).toHaveLength(1);

        cmd.count = 4;
        const mats = (cmd as any).getLinearTransforms(new XYZ({ x: 2, y: 0, z: 0 })) as Matrix4[];
        expect(mats).toHaveLength(4);
    });

    test("getBoxTransforms should return numberX*numberY*numberZ matrices", () => {
        const cmd = new ArrayCommand();
        cmd.numberX = 2;
        cmd.numberY = 2;
        cmd.numberZ = 2;
        wireCommand(cmd);
        const mats = (cmd as any).getBoxTransforms(XYZ.unitX, XYZ.unitY, XYZ.unitZ) as Matrix4[];
        expect(mats).toHaveLength(8);
    });

    test("getArcMatrixs should return count matrices", () => {
        const cmd = new ArrayCommand();
        cmd.count = 5;
        wireCommand(cmd);
        const mats = (cmd as any).getArcMatrixs(XYZ.zero, XYZ.unitZ, Math.PI / 4) as Matrix4[];
        expect(mats).toHaveLength(5);
    });

    describe("executeMainTask", () => {
        test("linear: clones each model count times and adds nodes (isGroup=false)", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { addedNodes } = wireCommand(cmd);
                cmd.isGroup = false;
                cmd.count = 3;

                const parent = makeParent({ id: "root" });
                const model = makeMockModel({ parent });
                (cmd as any).models = [model];

                seedStepDatas(cmd, [
                    pointStep(new XYZ({ x: 0, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 5, y: 0, z: 0 })),
                ]);

                (cmd as any).executeMainTask();

                // count(3) * models(1) clones added; original model removed from parent.
                expect(addedNodes).toHaveLength(3);
                expect(parent.removed).toContain(model);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("linear: multiplies clones per model when multiple models selected", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { addedNodes } = wireCommand(cmd);
                cmd.isGroup = false;
                cmd.count = 2;

                (cmd as any).models = [makeMockModel(), makeMockModel()];
                seedStepDatas(cmd, [pointStep(XYZ.zero), pointStep(new XYZ({ x: 1, y: 0, z: 0 }))]);

                (cmd as any).executeMainTask();

                expect(addedNodes).toHaveLength(4);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("rectangular: clones numberX*numberY*numberZ times per model (isGroup=false)", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { addedNodes } = wireCommand(cmd);
                cmd.patternType = "option.command.patternType.rectangular";
                cmd.isGroup = false;
                cmd.numberX = 2;
                cmd.numberY = 1;
                cmd.numberZ = 1;

                (cmd as any).models = [makeMockModel()];
                // step0: origin, step1: defines xvec, step2/3: y and z axes.
                seedStepDatas(cmd, [
                    pointStep(new XYZ({ x: 0, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 3, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 3, y: 2, z: 0 })),
                    pointStep(new XYZ({ x: 3, y: 2, z: 4 })),
                ]);

                (cmd as any).executeMainTask();

                expect(addedNodes).toHaveLength(2);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("circular: clones count times using arc transforms (isGroup=false)", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { addedNodes } = wireCommand(cmd);
                cmd.patternType = "option.command.patternType.circular";
                cmd.isGroup = false;
                cmd.count = 4;

                (cmd as any).models = [makeMockModel()];

                const plane = new Plane({
                    origin: XYZ.zero,
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                });
                // _planeAngle is normally populated by the AngleStep; seed directly.
                (cmd as any)._planeAngle = new PlaneAngle(plane);

                seedStepDatas(cmd, [
                    pointStep(XYZ.zero),
                    pointStep(new XYZ({ x: 1, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 0, y: 1, z: 0 })), // 90 degrees around Z
                ]);

                (cmd as any).executeMainTask();

                expect(addedNodes).toHaveLength(4);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("curve: clones along a selected edge curve (isGroup=false)", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { addedNodes } = wireCommand(cmd);
                cmd.patternType = "option.command.patternType.curve";
                cmd.isGroup = false;
                cmd.count = 3;

                (cmd as any).models = [makeMockModel()];

                // A fake edge whose curve returns 3 evenly-spaced points.
                const curve: ICurve = {
                    uniformAbscissaByCount: rs.fn(() => [
                        new XYZ({ x: 0, y: 0, z: 0 }),
                        new XYZ({ x: 1, y: 0, z: 0 }),
                        new XYZ({ x: 2, y: 0, z: 0 }),
                    ]),
                } as unknown as ICurve;
                const edge = mockShape({ shapeType: ShapeTypes.edge }) as unknown as IEdge;
                (edge as any).curve = curve;

                const ownerTransform = Matrix4.identity();
                const edgeShape = mockShape({
                    shapeType: ShapeTypes.edge,
                    transformedMul: rs.fn(() => edge),
                });

                seedStepDatas(cmd, [
                    {
                        view: { workplane: Plane.XY, direction: () => XYZ.unitNZ } as any,
                        type: "shape",
                        point: undefined,
                        plane: undefined,
                        shapes: [
                            {
                                shape: edgeShape,
                                transform: ownerTransform,
                                point: undefined,
                                indexes: [],
                                owner: { node: {}, getNode: () => ({}) },
                            },
                        ],
                    } as any,
                ]);

                (cmd as any).executeMainTask();

                expect(addedNodes).toHaveLength(3);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("isGroup=true: pushes a Component and a ComponentNode and removes originals", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc, addedNodes } = wireCommand(cmd);
                // wireCommand's modelManager lacks `components`; add it.
                const components: unknown[] = [];
                (doc.modelManager as any).components = components;

                cmd.isGroup = true;
                cmd.count = 2;

                const parent = makeParent({ id: "root" });
                const model = makeMockModel({ parent });
                (cmd as any).models = [model];

                seedStepDatas(cmd, [pointStep(XYZ.zero), pointStep(new XYZ({ x: 2, y: 0, z: 0 }))]);

                (cmd as any).executeMainTask();

                // A component was registered and (at least) one node was added.
                expect(components).toHaveLength(1);
                expect(addedNodes.length).toBeGreaterThanOrEqual(1);
                expect(parent.removed).toContain(model);
            } finally {
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("linearArrayStepData preview", () => {
        test("returns just a meshPoint when no point provided", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                cmd.count = 2;
                seedStepDatas(cmd, [pointStep(XYZ.zero)]);

                const data = (cmd as any).linearArrayStepData() as PointSnapData;
                const preview = data.preview!(undefined as any);
                expect(Array.isArray(preview)).toBe(true);
                expect(data.dimension).toBe(1);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("returns mesh points/line and updates positions when a point is provided", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                cmd.count = 2;
                // positions are read by updatePosition; seed them so setPosition fires.
                (cmd as any).positions = [0, 0, 0];
                (cmd as any)._meshId = 7;
                seedStepDatas(cmd, [pointStep(XYZ.zero)]);

                const data = (cmd as any).linearArrayStepData() as PointSnapData;
                const preview = data.preview!(new XYZ({ x: 4, y: 0, z: 0 }));
                expect(Array.isArray(preview)).toBe(true);
                expect(doc.visual.context.setPosition as any).toHaveBeenCalledWith(
                    7,
                    expect.any(Float32Array),
                );
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("validator rejects points at or below the precision distance from origin", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                seedStepDatas(cmd, [pointStep(XYZ.zero)]);

                const data = (cmd as any).linearArrayStepData() as PointSnapData;
                expect(data.validator!(undefined as unknown as XYZ)).toBe(false);
                expect(data.validator!(XYZ.zero)).toBe(false);
                expect(data.validator!(new XYZ({ x: 1, y: 0, z: 0 }))).toBe(true);
            } finally {
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("vectorArrayStepData / pointOnAxisArray / boxArrayMatrixs", () => {
        test("vectorArrayStepData preview returns mesh list and updates positions", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                cmd.numberX = 2;
                cmd.numberY = 1;
                cmd.numberZ = 1;
                (cmd as any).positions = [0, 0, 0];
                (cmd as any)._meshId = 1;
                seedStepDatas(cmd, [pointStep(XYZ.zero)]);

                const data = (cmd as any).vectorArrayStepData() as PointSnapData;
                const preview = data.preview!(new XYZ({ x: 2, y: 0, z: 0 }));
                expect(Array.isArray(preview)).toBe(true);
                expect(doc.visual.context.setPosition as any).toHaveBeenCalledWith(
                    1,
                    expect.any(Float32Array),
                );
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("boxArrayMatrixs with index=2 builds transforms along x and y", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                cmd.numberX = 2;
                cmd.numberY = 2;
                cmd.numberZ = 1;

                seedStepDatas(cmd, [
                    pointStep(XYZ.zero),
                    pointStep(new XYZ({ x: 1, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 1, y: 1, z: 0 })),
                ]);

                const mats = (cmd as any).boxArrayMatrixs(
                    2,
                    XYZ.unitX,
                    XYZ.unitY,
                    XYZ.unitZ,
                    new XYZ({ x: 1, y: 1, z: 0 }),
                ) as Matrix4[];
                expect(mats).toHaveLength(4);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("boxArrayMatrixs with index=3 builds transforms along x, y, and normal", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                cmd.numberX = 2;
                cmd.numberY = 1;
                cmd.numberZ = 2;

                seedStepDatas(cmd, [
                    pointStep(XYZ.zero),
                    pointStep(new XYZ({ x: 1, y: 0, z: 0 })),
                    pointStep(new XYZ({ x: 1, y: 1, z: 0 })),
                    pointStep(new XYZ({ x: 1, y: 1, z: 1 })),
                ]);

                const mats = (cmd as any).boxArrayMatrixs(
                    3,
                    XYZ.unitX,
                    XYZ.unitY,
                    XYZ.unitZ,
                    new XYZ({ x: 1, y: 1, z: 1 }),
                ) as Matrix4[];
                expect(mats).toHaveLength(4);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("boxPlaneInfo derives yvec from plane.normal and xvec", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                seedStepDatas(cmd, [pointStep(XYZ.zero), pointStep(new XYZ({ x: 1, y: 0, z: 0 }))]);

                const info = (cmd as any).boxPlaneInfo(2);
                expect(info.xvec).toBeDefined();
                expect(info.yvec).toBeDefined();
                expect(info.normal).toBeDefined();
                expect(info.ray).toBeDefined();
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("boxPlaneInfo falls back to unitZ when normal equals xvec", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                // Plane normal parallel to the xvec direction (X axis).
                const xPlane = new Plane({
                    origin: XYZ.zero,
                    normal: XYZ.unitX,
                    xvec: XYZ.unitY,
                });
                seedStepDatas(cmd, [pointStep(XYZ.zero), pointStep(new XYZ({ x: 1, y: 0, z: 0 }), xPlane)]);

                const info = (cmd as any).boxPlaneInfo(2);
                expect(info.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("boxPlaneInfo falls back to -unitZ when normal equals reversed xvec", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                const xPlane = new Plane({
                    origin: XYZ.zero,
                    normal: new XYZ({ x: -1, y: 0, z: 0 }),
                    xvec: XYZ.unitY,
                });
                seedStepDatas(cmd, [pointStep(XYZ.zero), pointStep(new XYZ({ x: 1, y: 0, z: 0 }), xPlane)]);

                const info = (cmd as any).boxPlaneInfo(2);
                expect(info.normal.isEqualTo(XYZ.unitZ.reverse())).toBe(true);
            } finally {
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("resetMesh / removeMesh / afterExecute", () => {
        test("resetMesh is a no-op when positions are undefined", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                wireCommand(cmd);
                expect(() => (cmd as any).resetMesh()).not.toThrow();
                expect((cmd as any)._meshId).toBeUndefined();
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("resetMesh displays a line-segments mesh scaled by count", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                cmd.count = 3;
                (cmd as any).positions = [0, 0, 0, 1, 1, 1];

                (cmd as any).resetMesh();

                const displayLineSegments = doc.visual.context.displayLineSegments as any;
                expect(displayLineSegments).toHaveBeenCalledTimes(1);
                const arg = displayLineSegments.mock.calls[0][0];
                expect(arg.position.length).toBe(6 * 3); // 2 points * count(3)
                expect((cmd as any)._meshId).toBe("visual-id");
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("resetMesh uses numberX*numberY*numberZ count for rectangular pattern", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                cmd.patternType = "option.command.patternType.rectangular";
                cmd.numberX = 2;
                cmd.numberY = 2;
                cmd.numberZ = 2;
                (cmd as any).positions = [0, 0, 0];

                (cmd as any).resetMesh();

                const arg = (doc.visual.context.displayLineSegments as any).mock.calls[0][0];
                expect(arg.position.length).toBe(3 * 8); // 1 point * 2*2*2
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("removeMesh clears the displayed mesh id", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                (cmd as any)._meshId = 42;
                (cmd as any).removeMesh();
                expect(doc.visual.context.removeMesh as any).toHaveBeenCalledWith(42);
                expect((cmd as any)._meshId).toBeUndefined();
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("afterExecute removes any displayed preview mesh", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                (cmd as any)._meshId = 99;
                (cmd as any).afterExecute();
                expect(doc.visual.context.removeMesh as any).toHaveBeenCalledWith(99);
                expect((cmd as any)._meshId).toBeUndefined();
            } finally {
                restoreTx();
                restoreApp();
            }
        });
    });

    describe("count setter side effect", () => {
        test("setting count invokes resetMesh", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                (cmd as any).positions = [0, 0, 0];

                cmd.count = 4;

                // resetMesh ran (displayLineSegments called once) with the new count.
                const arg = (doc.visual.context.displayLineSegments as any).mock.calls[0][0];
                expect(arg.position.length).toBe(3 * 4);
            } finally {
                restoreTx();
                restoreApp();
            }
        });

        test("setting numberX invokes resetMesh with rectangular count", () => {
            const restoreApp = installStubApp();
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new ArrayCommand();
                const { doc } = wireCommand(cmd);
                cmd.patternType = "option.command.patternType.rectangular";
                (cmd as any).positions = [0, 0, 0];

                cmd.numberX = 4;

                const arg = (doc.visual.context.displayLineSegments as any).mock.calls[0][0];
                // rectangular count = numberX(4) * numberY(3) * numberZ(3)
                expect(arg.position.length).toBe(3 * 36);
            } finally {
                restoreTx();
                restoreApp();
            }
        });
    });
});
