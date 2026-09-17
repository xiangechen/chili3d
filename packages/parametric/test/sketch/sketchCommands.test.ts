// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IFace,
    type IView,
    Matrix4,
    Plane,
    Ray,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { PlanePickHandler } from "../../src/sketch/commands/planePickHandler";
import { CreateSketch, EnterSketch } from "../../src/sketch/commands/sketchCommands";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { sketchPlaneOfFace } from "../../src/sketch/planeRef";
import { SketchNode } from "../../src/sketch/sketchNode";

function faceWithNormal(point: XYZ, normal: XYZ): IFace {
    return { normal: () => [point, normal] } as unknown as IFace;
}

describe("sketchPlaneOfFace", () => {
    test("anchors the origin at the world origin projected onto the face", () => {
        const plane = sketchPlaneOfFace(faceWithNormal(new XYZ({ x: 1, y: 2, z: 5 }), XYZ.unitZ));

        expect(plane.origin.isEqualTo(new XYZ({ x: 0, y: 0, z: 5 }))).toBe(true);
        expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        // horizontal face: up = world Y, X = Y × Z = X
        expect(plane.xvec.isEqualTo(XYZ.unitX)).toBe(true);
        expect(plane.yvec.isEqualTo(XYZ.unitY)).toBe(true);
    });

    test("keeps world Z as the up axis on a vertical face", () => {
        const plane = sketchPlaneOfFace(faceWithNormal(XYZ.zero, XYZ.unitX));

        expect(plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(plane.yvec.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(plane.xvec.isEqualTo(XYZ.unitY)).toBe(true);
    });

    test("keeps world Z as up when the face tilts within the XY plane", () => {
        // normal (1, 1, 0) still leaves world Z in-plane, so up stays Z
        const plane = sketchPlaneOfFace(faceWithNormal(XYZ.zero, new XYZ({ x: 1, y: 1, z: 0 })));

        expect(plane.yvec.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(plane.xvec.isPerpendicularTo(plane.yvec)).toBe(true);
        expect(plane.xvec.isPerpendicularTo(plane.normal)).toBe(true);
    });

    test("projects world Z onto the plane when it is not fully in-plane", () => {
        const plane = sketchPlaneOfFace(faceWithNormal(XYZ.zero, new XYZ({ x: 1, y: 1, z: 1 })));

        expect(plane.yvec.isPerpendicularTo(plane.normal)).toBe(true);
        expect(plane.yvec.z).toBeGreaterThan(0);
        expect(plane.xvec.isPerpendicularTo(plane.yvec)).toBe(true);
        expect(plane.xvec.isPerpendicularTo(plane.normal)).toBe(true);
    });

    test("matches the ZX datum plane orientation on a +Y face", () => {
        const plane = sketchPlaneOfFace(faceWithNormal(XYZ.zero, XYZ.unitY));

        expect(plane.xvec.isEqualTo(Plane.ZX.xvec)).toBe(true);
        expect(plane.yvec.isEqualTo(Plane.ZX.yvec)).toBe(true);
    });

    test("projects the world origin onto a tilted face", () => {
        // face on x + y = 2; the world origin projects onto (1, 1, 0)
        const plane = sketchPlaneOfFace(
            faceWithNormal(new XYZ({ x: 1, y: 1, z: 0 }), new XYZ({ x: 1, y: 1, z: 0 })),
        );

        expect(plane.origin.isEqualTo(new XYZ({ x: 1, y: 1, z: 0 }))).toBe(true);
    });
});

describe("PlanePickHandler", () => {
    function event(x: number, y: number): PointerEvent {
        return {
            offsetX: x,
            offsetY: y,
            button: 0,
            buttons: 0,
            isPrimary: true,
            pointerId: 1,
            preventDefault: () => {},
        } as unknown as PointerEvent;
    }

    function setup(rayAt: IView["rayAt"], detectShapes?: IView["detectShapes"]) {
        const document = new TestDocument();
        document.visual = createMockVisualWithDocument(document) as any;
        const controller = new AsyncController();
        let completed = false;
        controller.onCompleted(() => (completed = true));
        const handler = new PlanePickHandler(document, controller);
        const view = createMockView({ document, rayAt, ...(detectShapes ? { detectShapes } : {}) });
        return { controller, handler, view, isCompleted: () => completed };
    }

    function click(handler: PlanePickHandler, view: IView) {
        handler.pointerMove(view, event(10, 10));
        handler.pointerDown(view, event(10, 10));
        handler.pointerUp(view, event(10, 10));
    }

    const hitXY = () =>
        new Ray({ point: new XYZ({ x: 50, y: 50, z: 10 }), direction: new XYZ({ x: 0, y: 0, z: -1 }) });

    test("clicking a datum quad resolves with the datum plane", () => {
        const { handler, view, isCompleted } = setup(hitXY);

        click(handler, view);

        expect(handler.result).toEqual({ kind: "datum", plane: Plane.XY });
        expect(isCompleted()).toBe(true);
    });

    test("the ZX quad sits in the positive quadrant and resolves to the Z-up plane", () => {
        // ray hits +X+Z (the quad's display quadrant) on the Y = 0 plane
        const hitZX = () =>
            new Ray({
                point: new XYZ({ x: 100, y: 100, z: 100 }),
                direction: new XYZ({ x: 0, y: -1, z: 0 }),
            });
        const { handler, view, isCompleted } = setup(hitZX);

        click(handler, view);

        expect(handler.result).toEqual({ kind: "datum", plane: Plane.ZX });
        expect(isCompleted()).toBe(true);
    });

    test.each([
        {
            name: "in the gap between the axes and the quad",
            rayAt: () =>
                new Ray({ point: new XYZ({ x: 5, y: 5, z: 10 }), direction: new XYZ({ x: 0, y: 0, z: -1 }) }),
        },
        {
            name: "parallel to all datum planes",
            rayAt: () =>
                new Ray({
                    point: new XYZ({ x: 50, y: 50, z: 10 }),
                    direction: new XYZ({ x: 1, y: 0, z: 0 }),
                }),
        },
    ])("clicking $name selects nothing", ({ rayAt }) => {
        const { handler, view, isCompleted } = setup(rayAt);

        click(handler, view);

        expect(handler.result).toBeUndefined();
        expect(isCompleted()).toBe(false);
    });

    test("a detected planar face takes precedence over a hovered datum quad", () => {
        const face = { shapeType: ShapeTypes.face, dispose: rs.fn() } as unknown as IFace;
        const data: VisualShapeData = {
            shape: face,
            owner: {} as any,
            transform: Matrix4.identity(),
            indexes: [0],
        };
        const { handler, view, isCompleted } = setup(hitXY, () => [data]);

        click(handler, view);

        expect(handler.result).toEqual({ kind: "face", data });
        expect(isCompleted()).toBe(true);
    });

    test("dispose removes the three datum meshes", () => {
        const removeMesh = rs.fn((_id: number) => {});
        let nextId = 0;
        const document = new TestDocument();
        document.visual = createMockVisualWithDocument(document, {
            context: { displayMesh: () => nextId++, removeMesh },
        }) as any;
        const handler = new PlanePickHandler(document, new AsyncController());

        handler.dispose();

        expect(removeMesh.mock.calls.length).toBe(3);
    });
});

describe("EnterSketch", () => {
    function setup(selected: () => SketchNode[], picked?: () => SketchNode[]) {
        const app = createMockApplication();
        const clearSelection = rs.fn();
        const pickNode = rs.fn(async () => picked?.() ?? []);
        const document = new TestDocument({
            application: app,
            selection: { getSelectedNodes: selected, clearSelection } as any,
            picker: { pickNode } as any,
        });
        (app as any).activeView = { document };
        const enter = rs.spyOn(SketchEditor, "enter").mockImplementation(() => ({}) as any);
        const sketch = new SketchNode({ document, plane: Plane.XY });
        return { app, enter, pickNode, clearSelection, sketch };
    }

    test("enters the selected sketch without prompting", async () => {
        const { app, enter, pickNode, sketch } = setup(() => [sketch]);
        try {
            await new EnterSketch().execute(app);

            expect(enter).toHaveBeenCalledWith(sketch);
            expect(pickNode).not.toHaveBeenCalled();
        } finally {
            enter.mockRestore();
        }
    });

    test("prompts a sketch pick when nothing is selected", async () => {
        const { app, enter, pickNode, clearSelection, sketch } = setup(
            () => [],
            () => [sketch],
        );
        try {
            await new EnterSketch().execute(app);

            expect(enter).toHaveBeenCalledWith(sketch);
            expect(pickNode).toHaveBeenCalledTimes(1);
            const [prompt, , options] = pickNode.mock.calls[0] as any[];
            expect(prompt).toBe("prompt.select.sketch");
            expect(options.nodeFilter.allow(sketch)).toBe(true);
            expect(options.nodeFilter.allow({})).toBe(false);
            expect(clearSelection).toHaveBeenCalled();
        } finally {
            enter.mockRestore();
        }
    });

    test("does nothing when the pick is cancelled", async () => {
        const { app, enter } = setup(() => []);
        try {
            await new EnterSketch().execute(app);

            expect(enter).not.toHaveBeenCalled();
        } finally {
            enter.mockRestore();
        }
    });
});

describe("CreateSketch", () => {
    function setup(rollbackIndex: number | undefined) {
        const app = createMockApplication();
        const clearSelection = rs.fn();
        // a planar world face with no boundary edges: the pick resolves a plane and
        // a face ref but no external refs, leaving refPositions as the only data
        const worldFace = {
            normal: () => [XYZ.zero, XYZ.unitZ],
            dispose: rs.fn(),
        } as unknown as IFace;
        const pickedFace = {
            transformedMul: () => worldFace,
            findSubShapes: () => [],
        } as unknown as IFace;
        const data: VisualShapeData = {
            shape: pickedFace,
            owner: {} as any,
            transform: Matrix4.identity(),
            indexes: [0],
        };
        const pickAsync = rs.fn(async (handler: PlanePickHandler) => {
            handler.result = { kind: "face", data };
        });
        const document = new TestDocument({
            application: app,
            selection: { clearSelection } as any,
            picker: { pickAsync } as any,
        });
        let body!: ParametricBodyNode;
        document.visual = createMockVisualWithDocument(document, {
            context: { getNode: () => body },
        }) as any;
        body = new ParametricBodyNode({
            document,
            features: [
                { id: "e0", type: "extrude", sketchId: "missing-sketch", depth: 10 },
                { id: "e1", type: "extrude", sketchId: "missing-sketch", depth: 10 },
            ],
        });
        if (rollbackIndex !== undefined) {
            // the fillet/chamfer reselect pick previews the body at this position —
            // a sketch created on it must anchor there, not at the full feature count
            Object.defineProperty(body, "rollbackIndex", { value: rollbackIndex });
        }
        (app as any).activeView = { document };
        const enter = rs.spyOn(SketchEditor, "enter").mockImplementation(() => ({}) as any);
        return { app, body, enter };
    }

    test.each([
        { name: "the live rollback position on a rollback preview", rollbackIndex: 1, expected: 1 },
        { name: "the full feature count outside a rollback preview", rollbackIndex: undefined, expected: 2 },
    ])("a face pick anchors refPositions to $name", async ({ rollbackIndex, expected }) => {
        const { app, body, enter } = setup(rollbackIndex);
        try {
            await new CreateSketch().execute(app);

            expect(enter).toHaveBeenCalledTimes(1);
            const node = enter.mock.calls[0][0] as SketchNode;
            expect(body.features.length).toBe(2);
            expect(node.data.refPositions).toEqual({ [body.id]: expected });
        } finally {
            enter.mockRestore();
        }
    });
});
