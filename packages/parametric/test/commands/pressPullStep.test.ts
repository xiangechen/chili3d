// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockVisualWithDocument,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { gripOf, PressPullHandler } from "../../src/commands/pressPullStep";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

/** Enough of a shape for `gripOf`: a normal, an identity transform, and an edge's parameter span. */
const shapeOf = (shapeType: ShapeType, normal: XYZ, overrides: Record<string, unknown> = {}) => {
    const shape: any = {
        shapeType,
        isSame: () => true,
        outerWire: () => ({ findSubShapes: () => [] }),
        findSubShapes: () => [],
        boundingBox: () => BoundingBox.zero,
        area: () => 0,
        normal: () => [XYZ.zero, normal],
        surface: () => ({ parameter: () => undefined, nearestPoint: () => undefined }),
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: () => XYZ.zero,
        dispose: () => {},
        ...overrides,
    };
    shape.transformedMul = () => shape;
    return shape;
};

const picked = (node: unknown, shape: any, point = XYZ.zero) =>
    ({ shape, owner: { node }, transform: Matrix4.identity(), indexes: [0], point }) as any;

describe("gripOf", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const body = new ParametricBodyNode({ document: doc, features: [] });

    test("a face drags out along its own normal, from where the pointer landed", () => {
        const at = new XYZ({ x: 1, y: 2, z: 3 });

        const grip = gripOf(picked(body, shapeOf(ShapeTypes.face, XYZ.unitZ), at));

        expect(grip!.origin).toBe(at);
        expect(grip!.direction.dot(XYZ.unitZ)).toBeCloseTo(1, 6);
    });

    test("a curved face answers on the side the pointer landed, not the seam's", () => {
        // A closed cylinder's (0, 0) parameter is its seam: the normal there can face straight
        // away from the pick. The kernel also hands back the raw D1U×D1V, whose length follows
        // the parametrization (a cylinder of radius r answers a vector of length r), so the
        // grip must take the pick-side normal AND normalize it.
        const seam = XYZ.unitX;
        const atPick = new XYZ({ x: 0, y: -10, z: 3 });
        const radial = new XYZ({ x: 0, y: -10, z: 0 });
        const shape = shapeOf(ShapeTypes.face, seam, {
            normal: (u: number) => (u === 0 ? [XYZ.zero, seam] : [atPick, radial]),
            surface: () => ({ parameter: () => ({ u: Math.PI, v: 3 }) }),
        });

        const grip = gripOf(picked(body, shape, atPick));

        expect(grip!.origin).toBe(atPick);
        expect(grip!.direction.length()).toBeCloseTo(1, 6);
        expect(grip!.direction.dot(XYZ.unitNY)).toBeCloseTo(1, 6);
    });

    test("a pick off the analytic surface (a mesh point) is projected before it is read", () => {
        // A viewport pick lands on the tessellation, off the analytic surface by the mesh
        // deflection — past the `parameter` tolerance. The grip must project it first, or it
        // falls back to the seam normal on every curved face.
        const seam = XYZ.unitX;
        const atPick = new XYZ({ x: 0, y: -10.01, z: 3 });
        const projected = new XYZ({ x: 0, y: -10, z: 3 });
        const radial = new XYZ({ x: 0, y: -10, z: 0 });
        const surface = {
            parameter: (point: XYZ) => (point === atPick ? undefined : { u: Math.PI, v: 3 }),
            nearestPoint: (point: XYZ) => {
                expect(point).toBe(atPick);
                return [projected, 0.01] as [XYZ, number];
            },
        };
        const shape = shapeOf(ShapeTypes.face, seam, {
            normal: (u: number) => (u === 0 ? [XYZ.zero, seam] : [projected, radial]),
            surface: () => surface,
        });

        const grip = gripOf(picked(body, shape, atPick));

        expect(grip!.origin).toBe(atPick);
        expect(grip!.direction.dot(XYZ.unitNY)).toBeCloseTo(1, 6);
    });

    test("an edge drags out of the material: its two faces' outward normals summed", () => {
        // An edge has no normal of its own; what it has is the two faces meeting along it.
        const edge = shapeOf(ShapeTypes.edge, XYZ.unitZ);
        const first = shapeOf(ShapeTypes.face, XYZ.unitX, { findSubShapes: () => [edge] });
        const second = shapeOf(ShapeTypes.face, XYZ.unitY, { findSubShapes: () => [edge] });
        const node = new ParametricBodyNode({ document: doc, features: [] });
        Object.defineProperty(node, "shape", {
            value: Result.ok({ findSubShapes: () => [first, second] }),
            configurable: true,
        });

        const grip = gripOf(picked(node, edge));

        const expected = XYZ.unitX.add(XYZ.unitY).normalize()!;
        expect(grip!.direction.x).toBeCloseTo(expected.x, 6);
        expect(grip!.direction.y).toBeCloseTo(expected.y, 6);
        expect(grip!.direction.z).toBeCloseTo(expected.z, 6);
    });

    test("an edge with no two faces to sum, and anything that is neither, has no arrow", () => {
        const node = new ParametricBodyNode({ document: doc, features: [] });
        Object.defineProperty(node, "shape", {
            value: Result.ok({ findSubShapes: () => [] }),
            configurable: true,
        });

        expect(gripOf(picked(node, shapeOf(ShapeTypes.edge, XYZ.unitZ)))).toBeUndefined();
        expect(gripOf(picked(node, shapeOf(ShapeTypes.solid, XYZ.unitZ)))).toBeUndefined();
        expect(gripOf(undefined)).toBeUndefined();
    });
});

describe("PressPullHandler", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const body = new ParametricBodyNode({ document: doc, features: [] });
    const other = new ParametricBodyNode({ document: doc, features: [] });

    /** The arrow is meshed through the shape factory, whose global is a getter off the registered
     * application — which a unit test has none of. */
    beforeEach(() => {
        const noValue = () => ({
            mesh: { faces: { position: new Float32Array(), range: [] } },
            findSubShapes: () => [],
            dispose: () => {},
        });
        const shape = () => ({ isOk: true, value: noValue() });
        setupShapeFactoryMock({
            cylinder: shape,
            cone: shape,
            combine: () => ({ isOk: true, value: noValue() }),
        });
    });

    function handler(value = 2) {
        const settled: number[] = [];
        const face = shapeOf(ShapeTypes.face, XYZ.unitZ);
        const node = new ParametricBodyNode({ document: doc, features: [] });
        Object.defineProperty(node, "shape", {
            value: Result.ok({ findSubShapes: () => [face], dispose: () => {} }),
            configurable: true,
        });
        const target: any = {
            shape: face,
            owner: { node },
            transform: Matrix4.identity(),
            indexes: [0],
            point: XYZ.zero,
        };
        const made = new PressPullHandler(doc, new AsyncController(), value, (v: number) => settled.push(v));
        return { made, settled, target };
    }

    test("a gesture with nothing picked cannot be confirmed — there is nothing to open", () => {
        const { made } = handler(5);

        expect((made as any).canConfirm()).toBe(false);
        expect((made as any).arrowSegment().start.z).toBe(0);
        expect((made as any).arrowSegment().end.z).toBe(0);
    });

    test("confirming with nothing picked ends the command instead of doing nothing", () => {
        // The confirm button is shown regardless of the pick, so an inert click on it reads as
        // broken. An empty confirm means "done", the way an empty Enter ends a command.
        const { made } = handler(5);

        (made as any).confirm();

        expect(made.controller.result?.status).toBe("cancel");
    });

    test("confirming a real push hands the gesture over", () => {
        const { made, target } = handler(4);
        (made as any).picked.push({ shape: target.shape, owner: target.owner });
        (made as any).grip = { origin: XYZ.zero, direction: XYZ.unitZ };

        (made as any).confirm();

        expect(made.controller.result?.status).toBe("success");
    });

    test("what the hand moves is reported out, so the panel follows the arrow", () => {
        const { made, settled } = handler(2);

        (made as any).setCurrentValue(-3.5);

        expect(settled).toEqual([-3.5]);
        expect(made.value).toBe(-3.5);
    });

    test("the shaft leaves the grip point by the value, and turns around past zero", () => {
        const { made } = handler(4);
        (made as any).picked.push({ shape: shapeOf(ShapeTypes.face, XYZ.unitZ), owner: { node: body } });
        (made as any).grip = { origin: XYZ.zero, direction: XYZ.unitZ };
        (made as any).arrowLength = 10;

        const out = (made as any).arrowSegment();
        expect(out.start.z).toBeCloseTo(4, 6);
        expect(out.end.z).toBeCloseTo(14, 6);

        (made as any).setCurrentValue(-4);
        const back = (made as any).arrowSegment();
        expect(back.start.z).toBeCloseTo(-4, 6);
        // Past zero the arrow points the way the drag is going, not the way the normal does.
        expect(back.end.z).toBeCloseTo(-14, 6);
        expect((made as any).canConfirm()).toBe(true);
    });

    test("the grip it stands on is published as a plane, so the command can read the direction", () => {
        const { made } = handler(2);
        const origin = new XYZ({ x: 1, y: 2, z: 3 });
        (made as any).grip = { origin, direction: XYZ.unitZ };

        const plane = made.gripPlane;

        expect(plane).toBeDefined();
        expect(plane!.origin).toBe(origin);
        expect(plane!.normal.dot(XYZ.unitZ)).toBeCloseTo(1, 6);
        // A horizontal axis keeps the frame well-defined when the normal is itself vertical.
        expect(plane!.xvec.dot(XYZ.unitZ)).toBeCloseTo(0, 6);
    });

    test("no pick yet means no plane to hand over", () => {
        expect(handler(2).made.gripPlane).toBeUndefined();
    });

    test("a pick of another kind, or on another body, is refused", () => {
        // One distance has one meaning: on a face it is how far it moves, on an edge whether it is
        // rounded or chamfered. A body is one, too — the command that opens works on one.
        const { made, target } = handler(2);
        const mine = { shape: target.shape, owner: target.owner };
        (made as any).picked.push(mine);

        expect((made as any).admit(mine)).toBe(true);
        expect((made as any).admit({ shape: shapeOf(ShapeTypes.edge, XYZ.unitZ), owner: target.owner })).toBe(
            false,
        );
        expect(
            (made as any).admit({ shape: shapeOf(ShapeTypes.face, XYZ.unitZ), owner: { node: other } }),
        ).toBe(false);
    });

    test("the body being changed is ghosted while the preview is up, and put back after", () => {
        // The preview IS that body moved: drawn together over the very faces the user is looking
        // at, the two overlap and it reads as a ghost over the geometry it replaces.
        const previous = doc.visual;
        const highlighter = { addState: rs.fn(), removeState: rs.fn() };
        doc.visual = createMockVisualWithDocument(doc, { highlighter: highlighter as any });
        try {
            const { made, target } = handler(2);
            (made as any).picked.push({ shape: target.shape, owner: target.owner });

            (made as any).syncGhost();
            expect(highlighter.addState).toHaveBeenCalledWith(
                target.owner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );

            (made as any).onCleanup();
            expect(highlighter.removeState).toHaveBeenCalledWith(
                target.owner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
        } finally {
            doc.visual = previous;
        }
    });

    test("only a sketch's profiles are detectable, never its edges", () => {
        // A sketch's edges are the lines the profile is drawn with. Pushing one has no meaning —
        // the edge branch would open a Fillet on a sketch line — so the pointer never takes one.
        const { made } = handler(2);
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        const picked = (shape: unknown) => ({
            shape,
            owner: { node: sketch },
            transform: Matrix4.identity(),
            indexes: [0],
            point: XYZ.zero,
        });
        const line = picked(shapeOf(ShapeTypes.edge, XYZ.unitZ));
        const profile = picked(shapeOf(ShapeTypes.face, XYZ.unitZ));
        const view = { detectShapes: () => [line, profile] } as any;

        expect((made as any).detect(view, { offsetX: 0, offsetY: 0 })).toBe(profile);
    });

    test("a sketch lying on a solid face is taken before the face it is drawn on", () => {
        // Coplanar, so the raycast hits both and their order flips with the pointer. The sketch
        // is what the user put there, so a pick that takes the first entry must take it.
        const { made } = handler(2);
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        const sketchFace = {
            shape: shapeOf(ShapeTypes.face, XYZ.unitZ),
            owner: { node: sketch },
            transform: Matrix4.identity(),
            indexes: [0],
            point: XYZ.zero,
        };
        const solidFace = {
            shape: shapeOf(ShapeTypes.face, XYZ.unitZ),
            owner: { node: body },
            transform: Matrix4.identity(),
            indexes: [0],
            point: XYZ.zero,
        };
        const view = { detectShapes: () => [solidFace, sketchFace] } as any;

        expect((made as any).detect(view, { offsetX: 0, offsetY: 0 })).toBe(sketchFace);
    });

    test("an empty pick admits anything", () => {
        const { made } = handler(2);

        expect(
            (made as any).admit({ shape: shapeOf(ShapeTypes.edge, XYZ.unitZ), owner: { node: body } }),
        ).toBe(true);
    });
});
