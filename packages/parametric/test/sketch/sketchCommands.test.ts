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
import { PlanePickHandler } from "../../src/sketch/commands/planePickHandler";
import { EnterSketch } from "../../src/sketch/commands/sketchCommands";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { planeOfFace } from "../../src/sketch/planeRef";
import { SketchNode } from "../../src/sketch/sketchNode";

function faceWithNormal(point: XYZ, normal: XYZ): IFace {
    return { normal: () => [point, normal] } as unknown as IFace;
}

describe("planeOfFace", () => {
    test("a Z-facing face yields an XY-parallel plane at the face point", () => {
        const plane = planeOfFace(faceWithNormal(new XYZ({ x: 1, y: 2, z: 5 }), XYZ.unitZ));

        expect(plane.origin.isEqualTo(new XYZ({ x: 1, y: 2, z: 5 }))).toBe(true);
        expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(plane.xvec.isEqualTo(XYZ.unitX)).toBe(true);
    });

    test("a non-Z normal takes Z cross normal as the x direction", () => {
        const plane = planeOfFace(faceWithNormal(XYZ.zero, XYZ.unitX));

        expect(plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(plane.xvec.isEqualTo(XYZ.unitY)).toBe(true);
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
