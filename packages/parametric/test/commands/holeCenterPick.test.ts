// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IFace,
    type IShape,
    type IView,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
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
import {
    HoleCenterPickHandler,
    type SketchPointGlyphHit,
    sketchPointGlyphAt,
} from "../../src/commands/holeCenterPickHandler";
import { deduceHoleFace } from "../../src/commands/holeFace";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

/**
 * The mock view maps world (x, y) to screen (x + 400, y + 300) at one world unit per pixel,
 * so a glyph hit is a click within `Config.SnapDistance` = 10 px of the entity's own coords.
 */
const screenOf = (x: number, y: number) => ({ offsetX: x + 400, offsetY: y + 300 });

function pointSketch(doc: TestDocument, points: [number, number][], plane: Plane = Plane.XY) {
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
}

function setup() {
    const application = createMockApplication();
    const { highlighter, addCalls, removeCalls } = createMockHighlighter();
    const visual = createMockVisual({ highlighter });
    const doc = new TestDocument({
        application,
        selection: createMockSelection(),
        visual,
    });
    (doc.application as any).activeView = createMockView({ document: doc });
    return { doc, addCalls, removeCalls };
}

describe("sketchPointGlyphAt", () => {
    test("hits the point within snap distance, nearest first", () => {
        const { doc } = setup();
        const view = createMockView();
        const sketch = pointSketch(doc, [
            [8, 8],
            [11, 8],
        ]);

        const hit = sketchPointGlyphAt(doc, view, 411, 308);
        expect(hit?.sketch).toBe(sketch);
        expect(hit?.entityId).toBe(2);
        expect(hit?.world.distanceTo(new XYZ(11, 8, 0))).toBeLessThan(1e-9);
    });

    test("misses beyond snap distance", () => {
        const { doc } = setup();
        pointSketch(doc, [[8, 8]]);
        expect(sketchPointGlyphAt(doc, createMockView(), 421, 308)).toBeUndefined();
    });

    test("skips construction points", () => {
        const { doc } = setup();
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [{ id: 1, type: "point" as const, params: [8, 8], construction: true }],
                constraints: [],
            },
        });
        doc.modelManager.addNode(sketch);
        expect(sketchPointGlyphAt(doc, createMockView(), 408, 308)).toBeUndefined();
    });

    test("skips hidden sketches", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[8, 8]]);
        sketch.visible = false;
        expect(sketchPointGlyphAt(doc, createMockView(), 408, 308)).toBeUndefined();
    });

    test("reads the point in the sketch's world transform", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[8, 8]]);
        sketch.transform = Matrix4.fromTranslation(100, 0, 0);

        const hit = sketchPointGlyphAt(doc, createMockView(), 508, 308);
        expect(hit?.entityId).toBe(1);
        expect(hit?.world.distanceTo(new XYZ(108, 8, 0))).toBeLessThan(1e-9);
    });
});

/**
 * A planar face stand-in: `contains` answers the boundary probe in the face's own frame, and
 * `transformedMul` recomposes it so a moved body keeps the fake consistent.
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
function plateFace(z: number, normal: XYZ = XYZ.unitZ): IFace {
    return planarFace(new XYZ(0, 0, z), normal, (p) => Math.abs(p.x) <= 20 && Math.abs(p.y) <= 20);
}

function bodyWithFaces(
    doc: TestDocument,
    faces: IFace[],
    options?: { transform?: Matrix4; faceIds?: (string | undefined)[] },
) {
    const body = new ParametricBodyNode({ document: doc, features: [] });
    if (options?.transform !== undefined) body.transform = options.transform;
    rs.spyOn(body, "faceIdAt").mockImplementation((index: number) => options?.faceIds?.[index]);
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

describe("deduceHoleFace", () => {
    // A sketch on the z = 10 plane, points read in its (u, v) = world (x, y).
    const raisedPlane = Plane.XY.offsetAlongNormal(10);

    test("the coplanar face containing the selected points wins", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        const body = bodyWithFaces(doc, [plateFace(10)], { faceIds: ["face-top"] });

        const picked = deduceHoleFace(doc, sketch, [1]);

        expect(picked?.body).toBe(body);
        expect(picked?.ref.faceId).toBe("face-top");
        expect(picked?.ref.offset).toBeCloseTo(10, 9);
        expect(picked?.worldFrame.origin.distanceTo(new XYZ(0, 0, 10))).toBeLessThan(1e-9);
        picked?.worldFace.dispose();
    });

    test("a parallel face off the sketch plane is not coplanar", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        bodyWithFaces(doc, [plateFace(20)]);

        expect(deduceHoleFace(doc, sketch, [1])).toBeUndefined();
    });

    test("a non-parallel face is not coplanar", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        bodyWithFaces(doc, [planarFace(new XYZ(0, 0, 10), XYZ.unitX, () => true)]);

        expect(deduceHoleFace(doc, sketch, [1])).toBeUndefined();
    });

    test("the anti-parallel face on the sketch's far side still counts as coplanar", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        const body = bodyWithFaces(doc, [plateFace(10, XYZ.unitZ.reverse())]);

        expect(deduceHoleFace(doc, sketch, [1])?.body).toBe(body);
    });

    test("a coplanar face containing none of the points is not a candidate", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[100, 100]], raisedPlane);
        bodyWithFaces(doc, [plateFace(10)]);

        expect(deduceHoleFace(doc, sketch, [1])).toBeUndefined();
    });

    test("the face containing more of the selected points wins", () => {
        const { doc } = setup();
        const sketch = pointSketch(
            doc,
            [
                [3, 4],
                [30, 4],
            ],
            raisedPlane,
        );
        const small = bodyWithFaces(doc, [plateFace(10)]);
        // The big plate reaches both points; added second, it still has to win.
        const big = bodyWithFaces(doc, [
            planarFace(new XYZ(0, 0, 10), XYZ.unitZ, (p) => Math.abs(p.x) <= 100 && Math.abs(p.y) <= 100),
        ]);

        expect(deduceHoleFace(doc, sketch, [1, 2])?.body).toBe(big);
        expect(small).not.toBe(big);
    });

    test("a tie keeps the first body encountered", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        const first = bodyWithFaces(doc, [plateFace(10)]);
        bodyWithFaces(doc, [plateFace(10)]);

        expect(deduceHoleFace(doc, sketch, [1])?.body).toBe(first);
    });

    test("hidden bodies and bodies without a shape are skipped", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        const hidden = bodyWithFaces(doc, [plateFace(10)]);
        hidden.visible = false;
        const shapeless = new ParametricBodyNode({ document: doc, features: [] });
        // Reading `.shape` would evaluate the empty chain; seed the failed cache directly.
        (shapeless as any)._shape = Result.err("no features");
        (shapeless as any)._evaluated = true;
        doc.modelManager.addNode(shapeless);

        expect(deduceHoleFace(doc, sketch, [1])).toBeUndefined();
    });

    test("the body's own transform is honoured", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        // The body sits 100 to the side: its plate covers world x ∈ [80, 120].
        const body = bodyWithFaces(doc, [plateFace(10)], { transform: Matrix4.fromTranslation(100, 0, 0) });

        expect(deduceHoleFace(doc, sketch, [1])).toBeUndefined();

        const far = pointSketch(doc, [[103, 4]], raisedPlane);
        expect(deduceHoleFace(doc, far, [1])?.body).toBe(body);
    });

    test("entity ids that are not points find no face", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[3, 4]], raisedPlane);
        bodyWithFaces(doc, [plateFace(10)]);

        expect(deduceHoleFace(doc, sketch, [99])).toBeUndefined();
    });
});

describe("HoleCenterPickHandler", () => {
    function handlerWith(doc: TestDocument, selected: SketchPointGlyphHit[] = []) {
        const controller = new AsyncController();
        const handler = new HoleCenterPickHandler(doc, controller, selected);
        return { controller, handler };
    }

    function click(view: IView, handler: HoleCenterPickHandler, x: number, y: number) {
        const event = createPointerEvent(screenOf(x, y));
        handler.pointerMove(view, event);
        handler.pointerDown(view, event);
        handler.pointerUp(view, event);
    }

    test("clicking a glyph toggles the point into the selection and draws its cross", () => {
        const { doc } = setup();
        pointSketch(doc, [[8, 8]]);
        const { controller, handler } = handlerWith(doc);
        const view = createMockView();

        click(view, handler, 8, 8);

        expect(handler.selectedPoints).toHaveLength(1);
        expect(handler.selectedPoints[0].entityId).toBe(1);
        // a toggle never ends the step
        expect(controller.result).toBeUndefined();
        handler.dispose();
    });

    test("clicking a selected glyph again removes it", () => {
        const { doc } = setup();
        pointSketch(doc, [[8, 8]]);
        const { handler } = handlerWith(doc);
        const view = createMockView();

        click(view, handler, 8, 8);
        click(view, handler, 8, 8);

        expect(handler.selectedPoints).toHaveLength(0);
        handler.dispose();
    });

    test("a second sketch's point is refused while the selection is pinned to one sketch", () => {
        const { doc } = setup();
        pointSketch(doc, [[8, 8]]);
        pointSketch(doc, [[-8, -8]]);
        const toasts: unknown[] = [];
        const sub = (message: unknown) => toasts.push(message);
        PubSub.default.sub("showToast", sub as never);
        try {
            const { handler } = handlerWith(doc);
            const view = createMockView();

            click(view, handler, 8, 8);
            click(view, handler, -8, -8);

            expect(handler.selectedPoints).toHaveLength(1);
            expect(toasts).toHaveLength(1);
        } finally {
            PubSub.default.remove("showToast", sub as never);
        }
    });

    test("clicking a planar body face captures it and ends the step", () => {
        const { doc, addCalls } = setup();
        pointSketch(doc, [[8, 8]]);
        const face = plateFace(0);
        const body = bodyWithFaces(doc, [face]);
        const view = createMockView({
            detectShapes: () => [
                {
                    shape: face,
                    owner: { node: body },
                    transform: Matrix4.identity(),
                    indexes: [2],
                } as unknown as VisualShapeData,
            ],
        });
        const { controller, handler } = handlerWith(doc);

        click(view, handler, 50, 50);

        expect(handler.faceResult?.body).toBe(body);
        expect(handler.faceResult?.ref.offset).toBeCloseTo(0, 9);
        expect(controller.result?.status).toBe("success");
        // the face was hovered on the way to the click
        expect(addCalls.length).toBeGreaterThan(0);
        handler.dispose();
    });

    test("a glyph wins over the face under it", () => {
        const { doc, addCalls } = setup();
        pointSketch(doc, [[8, 8]]);
        const face = plateFace(0);
        const body = bodyWithFaces(doc, [face]);
        const view = createMockView({
            detectShapes: () => [
                {
                    shape: face,
                    owner: { node: body },
                    transform: Matrix4.identity(),
                    indexes: [0],
                } as unknown as VisualShapeData,
            ],
        });
        const { handler } = handlerWith(doc);

        click(view, handler, 8, 8);

        expect(handler.selectedPoints).toHaveLength(1);
        expect(handler.faceResult).toBeUndefined();
        // the glyph won: the face under it was never highlighted
        expect(addCalls).toHaveLength(0);
        handler.dispose();
    });

    test("an initial selection draws and stays toggleable", () => {
        const { doc } = setup();
        const sketch = pointSketch(doc, [[8, 8]]);
        const initial = [{ sketch, entityId: 1, world: new XYZ(8, 8, 0) }];
        const { handler } = handlerWith(doc, initial);
        const view = createMockView();

        click(view, handler, 8, 8);

        expect(handler.selectedPoints).toHaveLength(0);
        handler.dispose();
    });

    test("dispose removes the hover and selected crosses", () => {
        const { doc } = setup();
        pointSketch(doc, [[8, 8]]);
        const removed: number[] = [];
        let nextId = 1;
        (doc.visual.context as any).displayMesh = () => nextId++;
        (doc.visual.context as any).removeMesh = (id: number) => removed.push(id);
        const { handler } = handlerWith(doc);
        const view = createMockView();

        click(view, handler, 8, 8); // selects: one hover cross + one selected cross shown
        handler.pointerMove(view, createPointerEvent(screenOf(8, 8)));

        handler.dispose();

        expect(removed.length).toBeGreaterThanOrEqual(2);
    });
});
