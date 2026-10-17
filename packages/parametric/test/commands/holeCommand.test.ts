// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IFace,
    type IShape,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockHighlighter,
    createMockSelection,
    createMockView,
    createMockVisual,
    createPointerEvent,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { HoleCenterPickHandler } from "../../src/commands/holeCenterPickHandler";
import { HoleFeatureCommand } from "../../src/commands/holeCommand";
import type { FeatureData, HoleFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

/** The command wired to a document the way a running one is (see `Command.document`). */
function setup() {
    const doc = new TestDocument({ application: createMockApplication() });
    const command = new HoleFeatureCommand();
    (command as any)._application = { activeView: { document: doc } };
    return { doc, command };
}

/** A face pick's carry-over, as `capturePickedHoleFace` produces it for a face on the XY plane. */
function fakePicked(body: unknown) {
    return {
        body,
        ref: { nodeId: "b1", normal: { x: 0, y: 0, z: 1 }, offset: 0 },
        frame: Plane.XY,
        worldFrame: Plane.XY,
    };
}

/**
 * A pick at (x, y). The mock view is orthographic with one world unit per pixel, so the
 * command's snap tolerance is `Config.SnapDistance` = 10 world units.
 */
const pickAt = (x: number, y: number): SnapResult => ({
    view: createMockView(),
    type: "onSurface",
    point: new XYZ(x, y, 0),
    shapes: [],
});

const pointSketch = (doc: TestDocument, points: [number, number][], plane: Plane = Plane.XY) => {
    const node = new SketchNode({
        document: doc,
        plane,
        data: {
            entities: points.map(([x, y], i) => ({ id: i + 1, type: "point" as const, params: [x, y] })),
            constraints: [],
        },
    });
    doc.modelManager.addNode(node);
    return node;
};

describe("HoleFeatureCommand sketch-point binding", () => {
    test("a pick near a sketch point binds to it instead of adding a raw center", () => {
        const { doc, command } = setup();
        const sketch = pointSketch(doc, [[8, 8]]);
        (command as any).picked = fakePicked(undefined);

        const bound = (command as any).bindSketchPoint(pickAt(8.5, 8.2));

        expect(bound).toBe(true);
        const centers = (command as any).boundCenters;
        expect(centers).toHaveLength(1);
        expect(centers[0].sketchId).toBe(sketch.id);
        expect(centers[0].entityId).toBe(1);
        // The center is the entity's position projected onto the face frame.
        expect(centers[0].center.distanceTo(new XYZ(8, 8, 0))).toBeLessThan(1e-9);
        expect((command as any).stepDatas).toEqual([]);
    });

    test("a pick away from any sketch point stays raw", () => {
        const { doc, command } = setup();
        pointSketch(doc, [[8, 8]]);
        (command as any).picked = fakePicked(undefined);

        expect((command as any).bindSketchPoint(pickAt(50, 50))).toBe(false);
        expect((command as any).boundCenters).toEqual([]);
    });

    test("re-picking an already bound entity adds nothing", () => {
        const { doc, command } = setup();
        pointSketch(doc, [[8, 8]]);
        (command as any).picked = fakePicked(undefined);

        expect((command as any).bindSketchPoint(pickAt(8.4, 8))).toBe(true);
        expect((command as any).bindSketchPoint(pickAt(8.1, 7.9))).toBe(true);
        expect((command as any).boundCenters).toHaveLength(1);
    });

    test("the first bound sketch pins the binding; another sketch's point stays a raw pick", () => {
        const { doc, command } = setup();
        pointSketch(doc, [[8, 8]]);
        pointSketch(doc, [[-8, -8]]);
        (command as any).picked = fakePicked(undefined);

        expect((command as any).bindSketchPoint(pickAt(8.4, 8))).toBe(true);
        expect((command as any).bindSketchPoint(pickAt(-8.2, -8))).toBe(false);
        expect((command as any).boundCenters).toHaveLength(1);
    });

    test("onRestarting clears the bindings with the raw picks", () => {
        const { doc, command } = setup();
        pointSketch(doc, [[8, 8]]);
        (command as any).picked = fakePicked(undefined);
        (command as any).bindSketchPoint(pickAt(8.4, 8));
        (command as any).stepDatas = [pickAt(5, 5)];

        (command as any).onRestarting();

        expect((command as any).stepDatas).toEqual([]);
        expect((command as any).boundCenters).toEqual([]);
    });
});

describe("HoleFeatureCommand feature assembly", () => {
    /** A stand-in body capturing the feature list the command writes. */
    const fakeBody = () => {
        const written: HoleFeatureData[][] = [];
        return {
            written,
            body: {
                features: [],
                setFeaturesEmitShapeChanged: rs.fn((features: HoleFeatureData[]) => written.push(features)),
            },
        };
    };

    test("raw picks and bindings land in their own fields of one feature", () => {
        const { command } = setup();
        const { body, written } = fakeBody();
        (command as any).picked = fakePicked(body);
        (command as any).stepDatas = [pickAt(5, 5)];
        (command as any).boundCenters = [{ sketchId: "s1", entityId: 7, center: new XYZ(8, 8, 0) }];

        (command as any).executeMainTask();

        expect(written).toHaveLength(1);
        const feature = written[0][0];
        expect(feature.type).toBe("hole");
        expect(feature.points).toEqual([[5, 5]]);
        expect(feature.sketchPoints).toEqual({ sketchId: "s1", entityIds: [7] });
        expect(feature.style).toBe("simple");
        expect(feature.diameter).toBe(5);
    });

    test("bound centers alone still commit", () => {
        const { command } = setup();
        const { body, written } = fakeBody();
        (command as any).picked = fakePicked(body);
        (command as any).boundCenters = [{ sketchId: "s1", entityId: 7, center: new XYZ(8, 8, 0) }];

        (command as any).executeMainTask();

        expect(written[0][0].points).toEqual([]);
        expect(written[0][0].sketchPoints).toEqual({ sketchId: "s1", entityIds: [7] });
    });

    test("without bindings the feature carries no sketchPoints key at all", () => {
        const { command } = setup();
        const { body, written } = fakeBody();
        (command as any).picked = fakePicked(body);
        (command as any).stepDatas = [pickAt(5, 5)];

        (command as any).executeMainTask();

        expect("sketchPoints" in written[0][0]).toBe(false);
    });

    test("nothing picked at all writes nothing", () => {
        const { command } = setup();
        const { body, written } = fakeBody();
        (command as any).picked = fakePicked(body);

        (command as any).executeMainTask();

        expect(written).toEqual([]);
    });
});

describe("HoleFeatureCommand center preview", () => {
    test("bound centers draw as crosses, raw picks as dots", () => {
        const { command } = setup();
        (command as any).picked = fakePicked(undefined);
        (command as any).stepDatas = [pickAt(5, 5)];
        (command as any).boundCenters = [{ sketchId: "s1", entityId: 7, center: new XYZ(8, 8, 0) }];

        const meshes = (command as any).previewPoints(undefined);

        expect(meshes).toHaveLength(2);
        expect(meshes[0].position).toHaveLength(3); // a vertex dot
        expect(meshes[1].position).toHaveLength(12); // a four-arm cross
    });

    test("the cursor marker crosses where a pick would bind, dots where it would not", () => {
        const { doc, command } = setup();
        (doc.application as any).activeView = createMockView();
        pointSketch(doc, [[8, 8]]);
        (command as any).picked = fakePicked(undefined);

        const binding = (command as any).previewPoints(new XYZ(8.4, 8, 0));
        expect(binding).toHaveLength(1);
        expect(binding[0].position).toHaveLength(12);

        const raw = (command as any).previewPoints(new XYZ(50, 50, 0));
        expect(raw).toHaveLength(1);
        expect(raw[0].position).toHaveLength(3);
    });
});

/**
 * A planar face stand-in (the holeCenterPick tests' twin): `contains` answers the boundary
 * probe in the face's own frame, `transformedMul` recomposes so a moved body stays consistent.
 */
function planarFace(origin: XYZ, normal: XYZ, contains: (point: XYZ) => boolean): IFace {
    return {
        shapeType: ShapeTypes.face,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: () => [],
        surface: () => ({ isPlanar: () => true }),
        normal: () => [origin, normal] as [XYZ, XYZ],
        intersectLine: (point: XYZ) => (contains(point) ? point : undefined),
        transformedMul: (m: Matrix4) => {
            const inverse = m.invert()!;
            return planarFace(m.ofPoint(origin), m.ofVector(normal).normalize()!, (p) =>
                contains(inverse.ofPoint(p)),
            );
        },
    } as unknown as IFace;
}

/** A 40×40 plate face in the z = `z` plane, centred on the z axis. */
function plateFace(z: number): IFace {
    return planarFace(new XYZ(0, 0, z), XYZ.unitZ, (p) => Math.abs(p.x) <= 20 && Math.abs(p.y) <= 20);
}

function bodyWithFaces(doc: TestDocument, faces: IFace[], faceIds: (string | undefined)[]) {
    const body = new ParametricBodyNode({ document: doc, features: [] });
    rs.spyOn(body, "faceIdAt").mockImplementation((index: number) => faceIds[index]);
    // The shape setter would re-read the getter (observer old-value) and so evaluate the
    // empty chain; seed the cached result directly instead.
    (body as any)._shape = Result.ok({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? faces : []),
    } as unknown as IShape);
    doc.modelManager.addNode(body);
    return body;
}

describe("HoleFeatureCommand step flow", () => {
    // The sketch the points come from sits on the z = 10 plane, (u, v) = world (x, y).
    const raisedPlane = Plane.XY.offsetAlongNormal(10);

    function flowSetup() {
        const application = createMockApplication();
        const doc = new TestDocument({
            application,
            selection: createMockSelection(),
            visual: createMockVisual({ highlighter: createMockHighlighter().highlighter }),
        });
        const view = createMockView({ document: doc });
        (doc.application as any).activeView = view;
        const command = new HoleFeatureCommand();
        (command as any)._application = { activeView: view };
        return { doc, command, view };
    }

    /** The mock view maps world (x, y) to screen (x + 400, y + 300). */
    function clickAt(view: ReturnType<typeof createMockView>, handler: unknown, x: number, y: number) {
        const event = createPointerEvent({ offsetX: x + 400, offsetY: y + 300 });
        const h = handler as HoleCenterPickHandler;
        h.pointerMove(view, event);
        h.pointerDown(view, event);
        h.pointerUp(view, event);
    }

    /** Captures the features the command writes into the (real) body, without evaluating. */
    function captureWrites(body: ParametricBodyNode) {
        const written: FeatureData[][] = [];
        rs.spyOn(body, "setFeaturesEmitShapeChanged").mockImplementation((features: FeatureData[]) => {
            written.push(features);
        });
        return written;
    }

    function captureToasts() {
        const toasts: string[] = [];
        const sub = (...args: unknown[]) => toasts.push(args.join(" "));
        PubSub.default.sub("showToast", sub as never);
        return {
            toasts,
            restore: () => PubSub.default.remove("showToast", sub as never),
        };
    }

    test("picked points confirm into a bound-only feature on the deduced face", async () => {
        const { doc, command, view } = flowSetup();
        const sketch = pointSketch(
            doc,
            [
                [3, 4],
                [8, 4],
            ],
            raisedPlane,
        );
        const body = bodyWithFaces(doc, [plateFace(10)], ["top"]);
        const written = captureWrites(body);
        doc.picker.pickAsync = (async (handler: unknown, _p: unknown, controller: AsyncController) => {
            clickAt(view, handler, 3, 4);
            clickAt(view, handler, 8, 4);
            controller.success();
        }) as never;

        expect(await (command as any).executeSteps()).toBe(true);
        (command as any).executeMainTask();

        expect(written).toHaveLength(1);
        const feature = written[0][0] as HoleFeatureData;
        expect(feature.type).toBe("hole");
        expect(feature.points).toEqual([]);
        expect(feature.sketchPoints).toEqual({ sketchId: sketch.id, entityIds: [1, 2] });
        expect(feature.face.faceId).toBe("top");
        expect(feature.face.offset).toBeCloseTo(10, 9);
    });

    test("an empty confirm toasts and re-enters the step", async () => {
        const { doc, command, view } = flowSetup();
        pointSketch(doc, [[3, 4]], raisedPlane);
        bodyWithFaces(doc, [plateFace(10)], ["top"]);
        const { toasts, restore } = captureToasts();
        try {
            let calls = 0;
            doc.picker.pickAsync = (async (_h: unknown, _p: unknown, controller: AsyncController) => {
                calls++;
                if (calls === 1) {
                    controller.success();
                    return;
                }
                clickAt(view, _h, 3, 4);
                controller.success();
            }) as never;

            expect(await (command as any).executeSteps()).toBe(true);

            expect(calls).toBe(2);
            expect(toasts.some((t) => t.includes("Pick at least one hole center"))).toBe(true);
            expect((command as any).boundCenters).toHaveLength(1);
        } finally {
            restore();
        }
    });

    test("a failed deduction keeps the picks; a face click then takes the mixed path", async () => {
        const { doc, command, view } = flowSetup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        // The only face is NOT coplanar with the sketch — the deduction has to fail, and the
        // same face is then clicked as the manual fallback.
        const face = plateFace(20);
        const body = bodyWithFaces(doc, [face], ["offset"]);
        const written = captureWrites(body);
        (view as any).detectShapes = () => [
            {
                shape: face,
                owner: { node: body },
                transform: Matrix4.identity(),
                indexes: [0],
            } as unknown as VisualShapeData,
        ];
        const { toasts, restore } = captureToasts();
        try {
            let pickCalls = 0;
            doc.picker.pickAsync = (async (handler: unknown, _p: unknown, controller: AsyncController) => {
                if (handler instanceof HoleCenterPickHandler) {
                    pickCalls++;
                    if (pickCalls === 1) {
                        clickAt(view, handler, 3, 4);
                        controller.success();
                    } else {
                        clickAt(view, handler, 50, 50); // the face click
                    }
                    return;
                }
                controller.success(); // the raw-center loop: finished with no raw picks
            }) as never;

            expect(await (command as any).executeSteps()).toBe(true);
            (command as any).executeMainTask();

            expect(pickCalls).toBe(2);
            expect(toasts.some((t) => t.includes("No coplanar face found"))).toBe(true);
            expect(written).toHaveLength(1);
            const feature = written[0][0] as HoleFeatureData;
            expect(feature.face.offset).toBeCloseTo(20, 9);
            expect(feature.points).toEqual([]);
            expect(feature.sketchPoints).toEqual({ sketchId: sketch.id, entityIds: [1] });
        } finally {
            restore();
        }
    });

    test("a direct face click opens the raw-center loop like the old flow", async () => {
        const { doc, command, view } = flowSetup();
        pointSketch(doc, [[3, 4]], raisedPlane);
        const face = plateFace(10);
        const body = bodyWithFaces(doc, [face], ["top"]);
        (view as any).detectShapes = () => [
            {
                shape: face,
                owner: { node: body },
                transform: Matrix4.identity(),
                indexes: [0],
            } as unknown as VisualShapeData,
        ];
        let rawLoopRan = 0;
        doc.picker.pickAsync = (async (handler: unknown, _p: unknown, controller: AsyncController) => {
            if (handler instanceof HoleCenterPickHandler) {
                clickAt(view, handler, 50, 50); // the face click
                return;
            }
            rawLoopRan++;
            controller.success();
        }) as never;

        expect(await (command as any).executeSteps()).toBe(true);

        expect(rawLoopRan).toBe(1);
        const picked = (command as any).picked;
        expect(picked.body).toBe(body);
        expect(picked.ref.faceId).toBe("top");
        expect(picked.ref.offset).toBeCloseTo(10, 9);
    });

    test("cancelling step one aborts the command", async () => {
        const { doc, command } = flowSetup();
        doc.picker.pickAsync = (async (_h: unknown, _p: unknown, controller: AsyncController) => {
            controller.cancel();
        }) as never;

        expect(await (command as any).executeSteps()).toBe(false);
    });

    test("onRestarting clears the center picks with the rest", () => {
        const { doc, command } = flowSetup();
        const sketch = pointSketch(doc, [[3, 4]]);
        (command as any).centerPicks = [{ sketch, entityId: 1, world: new XYZ(3, 4, 0) }];
        (command as any).boundCenters = [{ sketchId: sketch.id, entityId: 1, center: new XYZ(3, 4, 0) }];

        (command as any).onRestarting();

        expect((command as any).centerPicks).toEqual([]);
        expect((command as any).boundCenters).toEqual([]);
        expect((command as any).picked).toBeUndefined();
    });
});
