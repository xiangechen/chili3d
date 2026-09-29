// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CommandStore,
    Dimensions,
    type IDocument,
    MeshDataUtils,
    Plane,
    PointOnPlaneStep,
    PointStep,
    SnapPointPlaneEventHandler,
    TextAnnotation,
    XY,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, rs, test } from "@rstest/core";
import { TextAnnotationCommand } from "../../../src/commands/annotate/text";
import { pointStepResult, seedStepDatas } from "../commandTestUtils";

const leader = () => new XYZ({ x: 0, y: 0, z: 0 });
const position = () => new XYZ({ x: 5, y: 5, z: 0 });

/** Wires the command to a document through a mock application, viewed from -Z. */
function textCommand(doc: IDocument, points: XYZ[] = [leader(), position()], up: XYZ = XYZ.unitY) {
    const cmd = new TextAnnotationCommand();
    const app = createMockApplication();
    app.activeView = {
        document: doc,
        workplane: Plane.XY,
        direction: () => XYZ.unitNZ,
        up: () => up,
        worldToScreen: (p: XYZ) => new XY({ x: p.x, y: -p.y }),
    } as any;
    (cmd as any)._application = app;
    seedStepDatas(
        cmd,
        points.map((point) => pointStepResult({ point })),
    );
    return cmd;
}

function textAnnotations(doc: TestDocument): TextAnnotation[] {
    return doc.modelManager.findNodes((node) => node instanceof TextAnnotation) as TextAnnotation[];
}

describe("TextAnnotationCommand", () => {
    test("should be registered in the CommandStore with its metadata", () => {
        const data = CommandStore.getComandData("annotate.text");
        expect(data).not.toBeUndefined();
        expect(data!.key).toBe("annotate.text");
        expect(data!.icon).toBe("icon-text");
    });

    test("getSteps asks for the leader point, then the text position", () => {
        const steps = (new TextAnnotationCommand() as any).getSteps();

        expect(steps).toHaveLength(2);
        expect(steps[0] instanceof PointStep).toBe(true);
        expect(steps[1] instanceof PointOnPlaneStep).toBe(true);
        expect(steps.map((step: any) => step.tip)).toEqual([
            "prompt.pickLeaderPoint",
            "prompt.pickTextPosition",
        ]);
    });

    describe("position step", () => {
        test("the pick is constrained to the plane facing the view through the leader point", () => {
            const cmd = textCommand(new TestDocument());
            const plane = (cmd as any).getPositionStepData().plane();

            expect(plane.origin.isEqualTo(leader())).toBe(true);
            expect(plane.normal.isEqualTo(XYZ.unitNZ)).toBe(true);
            // the camera's left axis, so the plane is never edge-on to the view
            expect(plane.xvec.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("prompt shows the note's content", () => {
            const cmd = textCommand(new TestDocument());
            (cmd as any).content = "Torque here";

            expect((cmd as any).getPositionStepData().prompt()).toBe("Torque here");
        });

        test("numeric coordinate input passes the position pick's validation", () => {
            const cmd = textCommand(new TestDocument());
            const data = (cmd as any).getPositionStepData();
            expect(data.dimension).toBe(Dimensions.D1D2D3);

            const controller = new AsyncController();
            try {
                const handler = new SnapPointPlaneEventHandler(new TestDocument(), controller, data);
                expect((handler as any).inputError("10,20,30")).toBeUndefined();
                expect((handler as any).inputError("#10,20,30")).toBeUndefined();
                // the pick has no refPoint, so two numbers cannot be placed — the same answer
                // the dimension commands' position pick gives, not "unsupportedInputs"
                expect((handler as any).inputError("10,20")).toBe("error.input.threeNumberCanBeInput");
            } finally {
                controller.dispose();
            }
        });

        test("preview draws the leader's point, and a line to the cursor from there", () => {
            const cmd = textCommand(new TestDocument());
            const preview = (cmd as any).textPreview;

            expect(preview(undefined)).toHaveLength(1);
            expect(MeshDataUtils.isVertexMesh(preview(undefined)[0])).toBe(true);
            expect(preview(position())).toHaveLength(2);
        });

        test("beforeExecute brings up the live note at the picked leader point", () => {
            const doc = new TestDocument();
            const cmd = textCommand(doc);
            (cmd as any).getPositionStepData().beforeExecute();

            const annotations = textAnnotations(doc);
            expect(annotations).toHaveLength(1);
            const note = annotations[0];
            expect(note.content).toBe("Text");
            expect(note.leaderPoint?.isEqualTo(leader())).toBe(true);
            // on the leader until the cursor says where the text belongs
            expect(note.position.isEqualTo(leader())).toBe(true);

            (cmd as any).afterExecute();
        });

        test("moving the cursor drives the live note's position and height", () => {
            const doc = new TestDocument();
            const cmd = textCommand(doc);
            (cmd as any).getPositionStepData().beforeExecute();
            cmd.textHeight = 7;

            (cmd as any).textPreview(position());

            const note = textAnnotations(doc)[0];
            expect(note.position.isEqualTo(position())).toBe(true);
            expect(note.textHeight).toBe(7);

            (cmd as any).afterExecute();
        });

        test("an edit reaches the note on the next cursor move, and asks for a redraw", () => {
            const doc = new TestDocument();
            const cmd = textCommand(doc);
            (cmd as any).getPositionStepData().beforeExecute();

            // the panel row hands the step's redraw callback back, as `onPreviewReady` does
            const redraw = rs.fn();
            (cmd as any).redrawPreview = redraw;
            (cmd as any).content = "Torque here";
            expect(redraw).toHaveBeenCalledTimes(1);

            (cmd as any).textPreview(position());
            expect(textAnnotations(doc)[0].content).toBe("Torque here");

            (cmd as any).afterExecute();
        });

        test("a cancel removes the preview annotation", () => {
            const doc = new TestDocument();
            const cmd = textCommand(doc);
            (cmd as any).getPositionStepData().beforeExecute();
            (cmd as any).textPreview(position());
            (cmd as any).afterExecute();

            expect(textAnnotations(doc)).toHaveLength(0);
            expect(doc.history.undoCount()).toBe(0);
        });
    });

    test("committing keeps the content, the picked leader point and the position", () => {
        const doc = new TestDocument();
        const cmd = textCommand(doc);
        (cmd as any).content = "Torque here";
        const note = (cmd as any).createPreviewAnnotation();

        (cmd as any).commitAnnotation(note);

        expect(note.content).toBe("Torque here");
        expect(note.leaderPoint.isEqualTo(leader())).toBe(true);
        expect(note.position.isEqualTo(position())).toBe(true);
    });
});
