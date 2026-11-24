// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IFace,
    type IVisualObject,
    Matrix4,
    Ray,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, createMockView } from "@chili3d/core/test-utils";
import { expect, rs, test } from "@rstest/core";
import {
    SectionPlanePickHandler,
    SectionPlanePickStep,
} from "../../../src/commands/application/sectionPlanePick";

function pointerEvent(): PointerEvent {
    return {
        offsetX: 10,
        offsetY: 10,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault() {},
    } as PointerEvent;
}

function createPicker() {
    const document = createMockDocument();
    const removeMesh = rs.fn();
    const displayedIds: number[] = [];
    document.visual.context.displayMesh = rs.fn(() => {
        const id = displayedIds.length + 1;
        displayedIds.push(id);
        return id;
    });
    document.visual.context.setMeshColor = rs.fn();
    document.visual.context.setMeshOpacity = rs.fn();
    document.visual.context.removeMesh = removeMesh;
    const controller = new AsyncController();
    const handler = new SectionPlanePickHandler(document, controller);
    return { document, controller, handler, removeMesh, displayedIds };
}

test("displays and disposes the three datum planes", () => {
    const { document, handler, removeMesh, displayedIds } = createPicker();

    expect(document.visual.context.displayMesh).toHaveBeenCalledTimes(3);
    expect(
        (document.visual.context.displayMesh as ReturnType<typeof rs.fn>).mock.calls.every(
            (call) => call[1]?.unlit === true,
        ),
    ).toBe(true);
    handler.dispose();

    expect(removeMesh.mock.calls).toEqual(displayedIds.map((id) => [id]));
});

test("picks a highlighted datum plane in the viewport", () => {
    const { document, controller, handler } = createPicker();
    const ray = new Ray({ point: new XYZ(125, 125, 100), direction: XYZ.unitNZ });
    const view = createMockView({ document, rayAt: () => ray });

    handler.pointerMove(view, pointerEvent());
    handler.pointerDown(view, pointerEvent());
    handler.pointerUp(view, pointerEvent());

    expect(handler.result?.kind).toBe("datum");
    expect(handler.result?.kind === "datum" && handler.result.plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    expect(controller.result?.status).toBe("success");
    expect(document.visual.context.setMeshOpacity).toHaveBeenCalledWith(expect.any(Number), 0.7);
});

test("converts a picked planar face to a command plane", async () => {
    const { document, controller } = createPicker();
    const origin = new XYZ(3, 4, 5);
    const face = {
        normal: () => [origin, XYZ.unitY],
        transformedMul: () => face,
        dispose: rs.fn(),
    } as unknown as IFace;
    const data = {
        owner: {} as IVisualObject,
        shape: face,
        transform: Matrix4.identity(),
        indexes: [],
    } as unknown as VisualShapeData;
    document.picker.pickAsync = async (handler, _prompt, pickController) => {
        (handler as SectionPlanePickHandler).result = { kind: "face", data };
        pickController.success();
    };
    const view = createMockView({ document });
    document.application.activeView = view;

    const result = await new SectionPlanePickStep().execute(document, controller);

    expect(result?.plane?.origin.isEqualTo(origin)).toBe(true);
    expect(result?.plane?.normal.isEqualTo(XYZ.unitY)).toBe(true);
    expect(face.dispose).toHaveBeenCalledOnce();
});
