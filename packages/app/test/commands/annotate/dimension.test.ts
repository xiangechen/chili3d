// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    DimensionAnnotation,
    FolderNode,
    type IDocument,
    type INode,
    MeshDataUtils,
    Plane,
    PointOnPlaneStep,
    PointStep,
    XY,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { AnnotateDimension } from "../../../src/commands/annotate/dimension";
import { pointStepResult, seedStepDatas } from "../commandTestUtils";

const p1 = () => new XYZ({ x: 0, y: 0, z: 0 });
const p2 = () => new XYZ({ x: 10, y: 0, z: 0 });
const p3 = () => new XYZ({ x: 5, y: 5, z: 0 });

/**
 * Wires the command to a document through a mock application. The layout scale is
 * fixed (`DIMENSION_LAYOUT_SCALE`), so the preview needs no camera to be well-defined.
 * `worldToScreen` maps obliquely so the screen-space axis inference sees distinct
 * projections for all three axes: X → (1, 0), Y → (−1, 0), Z → (0, −1).
 */
function dimensionCommand(
    doc: IDocument,
    points: XYZ[] = [p1(), p2(), p3()],
    viewDirection: XYZ = XYZ.unitNZ,
): AnnotateDimension {
    const cmd = new AnnotateDimension();
    const app = createMockApplication();
    app.activeView = {
        document: doc,
        workplane: Plane.XY,
        direction: () => viewDirection,
        worldToScreen: (p: XYZ) => new XY({ x: p.x - p.y, y: -p.z }),
    } as any;
    (cmd as any)._application = app;
    seedStepDatas(
        cmd,
        points.map((point) => pointStepResult({ point })),
    );
    return cmd;
}

function annotationFolders(doc: TestDocument): INode[] {
    return doc.modelManager.findNodes((node) => node instanceof FolderNode && node.name === "Annotations");
}

function dimensionAnnotations(doc: TestDocument): DimensionAnnotation[] {
    return doc.modelManager.findNodes((node) => node instanceof DimensionAnnotation) as DimensionAnnotation[];
}

describe("AnnotateDimension", () => {
    test("should be registered in the CommandStore with its metadata", () => {
        const data = CommandStore.getComandData("annotate.dimension");
        expect(data).not.toBeUndefined();
        expect(data!.key).toBe("annotate.dimension");
        expect(data!.icon).toBe("icon-dDimension");
    });

    test("getSteps should return three point steps with the expected prompts", () => {
        const steps = (new AnnotateDimension() as any).getSteps();
        expect(steps).toHaveLength(3);
        expect(steps[0] instanceof PointStep).toBe(true);
        expect(steps[1] instanceof PointStep).toBe(true);
        // the position pick is constrained to the annotation plane
        expect(steps[2] instanceof PointOnPlaneStep).toBe(true);
        expect(steps.map((step: any) => step.tip)).toEqual([
            "prompt.pickFistPoint",
            "prompt.pickNextPoint",
            "prompt.pickDimensionPosition",
        ]);
    });

    describe("getSecondPointData", () => {
        test("refPoint returns the first picked point and validator rejects coincident points", () => {
            const cmd = dimensionCommand(new TestDocument());
            const data = (cmd as any).getSecondPointData();

            expect(data.refPoint().isEqualTo(p1())).toBe(true);
            expect(data.validator(p1())).toBe(false);
            expect(data.validator(new XYZ({ x: 1, y: 0, z: 0 }))).toBe(true);
        });

        test("preview renders a rubber-band line from the first point to the cursor", () => {
            const cmd = dimensionCommand(new TestDocument());
            const data = (cmd as any).getSecondPointData();

            expect(data.preview(undefined)).toHaveLength(1);
            expect(data.preview(new XYZ({ x: 3, y: 0, z: 0 }))).toHaveLength(2);
        });
    });

    describe("getThirdPointData", () => {
        test("prompt shows the measured distance", () => {
            const cmd = dimensionCommand(new TestDocument());
            const data = (cmd as any).getThirdPointData();

            expect(data.prompt(pointStepResult({ point: p3() }))).toBe("10.00");
        });

        test("preview renders only the two measured points as markers", () => {
            const cmd = dimensionCommand(new TestDocument());
            const preview = (cmd as any).dimensionPreview(undefined);

            expect(preview).toHaveLength(2);
            expect(MeshDataUtils.isVertexMesh(preview[0])).toBe(true);
            expect(MeshDataUtils.isVertexMesh(preview[1])).toBe(true);
        });

        test("beforeExecute creates the live preview annotation with a placeholder text point", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            (cmd as any).getThirdPointData().beforeExecute();

            const annotations = dimensionAnnotations(doc);
            expect(annotations).toHaveLength(1);
            const annotation = annotations[0];
            expect(annotation.startPoint.isEqualTo(p1())).toBe(true);
            expect(annotation.endPoint.isEqualTo(p2())).toBe(true);
            expect(annotation.textPoint.isEqualTo(p1().add(p2()).multiply(0.5))).toBe(true);

            (cmd as any).afterExecute();
        });

        test("moving the cursor drives the live annotation: text point and text height", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            (cmd as any).getThirdPointData().beforeExecute();
            cmd.textHeight = 7;

            const preview = (cmd as any).dimensionPreview(p3());

            expect(preview).toHaveLength(2);
            const annotation = dimensionAnnotations(doc)[0];
            expect(annotation.textPoint.isEqualTo(p3())).toBe(true);
            expect(annotation.textHeight).toBe(7);

            (cmd as any).afterExecute();
        });

        test("a cancel removes the preview annotation and its folder", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            (cmd as any).getThirdPointData().beforeExecute();
            (cmd as any).dimensionPreview(p3());

            (cmd as any).afterExecute();

            expect(dimensionAnnotations(doc)).toHaveLength(0);
            expect(annotationFolders(doc)).toHaveLength(0);
            expect(doc.history.undoCount()).toBe(0);
        });

        test("the position pick is constrained to the nearest principal plane", () => {
            const cmd = dimensionCommand(new TestDocument());
            const plane = (cmd as any).getThirdPointData().plane();

            // measuring along X viewed from -Z: the XY plane through the first point
            expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(plane.origin.isEqualTo(p1())).toBe(true);
            expect(plane.xvec.isEqualTo(XYZ.unitX)).toBe(true);
        });

        test("the annotation plane follows the view direction on ties", () => {
            const cmd = dimensionCommand(new TestDocument(), [p1(), p2(), p3()], XYZ.unitNY);
            const plane = (cmd as any).getThirdPointData().plane();

            // the same X measurement viewed from the front: the XZ plane faces the user
            expect(plane.normal.isEqualTo(XYZ.unitY)).toBe(true);
        });

        test("the annotation plane follows where the pick drags", () => {
            const cmd = dimensionCommand(new TestDocument());
            const plane = (cmd as any).getThirdPointData().plane;

            // dragging up from the X segment picks the XZ plane, aside the XY plane
            expect(Math.abs(plane(new XYZ({ x: 5, y: 0, z: 8 })).normal.y)).toBeCloseTo(1, 9);
            expect(Math.abs(plane(new XYZ({ x: 5, y: 8, z: 0 })).normal.z)).toBeCloseTo(1, 9);
        });

        test("an axis-aligned pull snaps and draws a dashed axis-colored feedback line", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            const data = (cmd as any).getThirdPointData();
            data.beforeExecute();

            const pick = new XYZ({ x: 5, y: 0, z: 8 });
            data.plane(pick);
            const preview = (cmd as any).dimensionPreview(pick);

            // pulled along Z: the feedback line runs from the segment foot to the pick, dashed blue
            expect(preview).toHaveLength(3);
            expect(preview[2].lineType).toBe("dash");
            expect(preview[2].color).toBe(0x0000ff);
            expect(Array.from(preview[2].position)).toEqual([5, 0, 0, 5, 0, 8]);

            (cmd as any).afterExecute();
        });

        test("a pull off every axis draws no feedback line", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            const data = (cmd as any).getThirdPointData();
            data.beforeExecute();

            // 30° between Y and Z: past the snap threshold
            const pick = new XYZ({ x: 5, y: Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) });
            data.plane(pick);
            const preview = (cmd as any).dimensionPreview(pick);

            expect(preview).toHaveLength(2);

            (cmd as any).afterExecute();
        });

        test("a pull toward the negative axis side snaps and extends the dimension downward", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            const data = (cmd as any).getThirdPointData();
            data.beforeExecute();

            const pick = new XYZ({ x: 5, y: 0, z: -8 });
            data.plane(pick);
            const preview = (cmd as any).dimensionPreview(pick);

            // the dashed feedback line runs from the segment foot down to the pick
            expect(preview).toHaveLength(3);
            expect(Array.from(preview[2].position)).toEqual([5, 0, 0, 5, 0, -8]);

            const annotation = dimensionAnnotations(doc)[0];
            expect(annotation.textPoint.isEqualTo(pick)).toBe(true);

            (cmd as any).afterExecute();
        });
    });

    describe("executeMainTask", () => {
        test("creates a DimensionAnnotation under an Annotations folder", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            (cmd as any).executeMainTask();

            const folders = annotationFolders(doc);
            expect(folders).toHaveLength(1);

            const annotations = dimensionAnnotations(doc);
            expect(annotations).toHaveLength(1);
            const annotation = annotations[0];
            expect(annotation.parent).toBe(folders[0]);
            expect(annotation.annotationType).toBe("dimension");
            expect(annotation.dimensionType).toBe("linear");
            expect(annotation.startPoint.isEqualTo(p1())).toBe(true);
            expect(annotation.endPoint.isEqualTo(p2())).toBe(true);
            expect(annotation.textPoint.isEqualTo(p3())).toBe(true);
            expect(annotation.value).toBeCloseTo(10, 6);
            expect((cmd as any).repeatOperation).toBe(true);
        });

        test("reuses the same Annotations folder on repeated execution", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc);
            (cmd as any).executeMainTask();
            (cmd as any).executeMainTask();

            const folders = annotationFolders(doc);
            expect(folders).toHaveLength(1);

            const annotations = dimensionAnnotations(doc);
            expect(annotations).toHaveLength(2);
            for (const annotation of annotations) {
                expect(annotation.parent).toBe(folders[0]);
            }
        });

        test("commits the picked text point unchanged — the step constrains it to the plane", () => {
            const doc = new TestDocument();
            const cmd = dimensionCommand(doc, [p1(), p2(), new XYZ({ x: 5, y: 5, z: 0 })]);
            (cmd as any).executeMainTask();

            const annotation = dimensionAnnotations(doc)[0];
            expect(annotation.textPoint.isEqualTo(new XYZ({ x: 5, y: 5, z: 0 }))).toBe(true);
        });
    });
});
