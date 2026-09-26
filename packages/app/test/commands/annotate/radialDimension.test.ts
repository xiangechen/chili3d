// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    DimensionAnnotation,
    FolderNode,
    type IDocument,
    type INode,
    PointOnPlaneStep,
    SelectShapeStep,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import {
    AnnotateDiameterDimension,
    AnnotateRadialDimension,
} from "../../../src/commands/annotate/radialDimension";
import { pointStepResult, seedStepDatas, shapeStepResult } from "../commandTestUtils";

const CIRCLE = { center: XYZ.zero, radius: 10, axis: XYZ.unitZ };
const POSITION = new XYZ({ x: 20, y: 0, z: 0 });

type RadialCommand = AnnotateRadialDimension | AnnotateDiameterDimension;

/** Wires a radial/diameter command to a document, the circle picked and the position placed. */
function radialCommand(doc: IDocument, create: () => RadialCommand, position: XYZ = POSITION): RadialCommand {
    const cmd = create();
    const app = createMockApplication();
    app.activeView = { document: doc } as any;
    (cmd as any)._application = app;
    seedStepDatas(cmd, [
        shapeStepResult([{ shape: { curve: { basisCurve: CIRCLE } } as any }]),
        pointStepResult({ point: position }),
    ]);
    return cmd;
}

function dimensionAnnotations(doc: TestDocument): DimensionAnnotation[] {
    return doc.modelManager.findNodes((node) => node instanceof DimensionAnnotation) as DimensionAnnotation[];
}

function annotationFolders(doc: TestDocument): INode[] {
    return doc.modelManager.findNodes((node) => node instanceof FolderNode && node.name === "Annotations");
}

describe("AnnotateRadialDimension", () => {
    test("should be registered in the CommandStore with its metadata", () => {
        for (const key of ["annotate.radius", "annotate.diameter"]) {
            const data = CommandStore.getComandData(key);
            expect(data).not.toBeUndefined();
            expect(data!.key).toBe(key);
        }
        expect(CommandStore.getComandData("annotate.radius")!.icon).toBe("icon-dRadius");
        expect(CommandStore.getComandData("annotate.diameter")!.icon).toBe("icon-circle");
    });

    test("getSteps returns a circle-edge pick then a position pick", () => {
        const steps = (new AnnotateRadialDimension() as any).getSteps();
        expect(steps).toHaveLength(2);
        expect(steps[0] instanceof SelectShapeStep).toBe(true);
        expect(steps[1] instanceof PointOnPlaneStep).toBe(true);
        expect(steps.map((step: any) => step.tip ?? step.prompt)).toEqual([
            "prompt.select.circleEdge",
            "prompt.pickDimensionPosition",
        ]);
    });

    test("the shape filter only allows circle or arc edges", () => {
        const filter = (new AnnotateRadialDimension() as any).getSteps()[0].options.shapeFilter;
        const circle = { curve: { basisCurve: { center: XYZ.zero, radius: 1, axis: XYZ.unitZ } } };
        const line = { curve: { basisCurve: { direction: XYZ.unitX } } };
        const spline = { curve: { basisCurve: {} } };
        expect(filter.allow(circle)).toBe(true);
        expect(filter.allow(line)).toBe(false);
        expect(filter.allow(spline)).toBe(false);
    });

    test("the position pick is constrained to the circle's plane", () => {
        const cmd = radialCommand(new TestDocument(), () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();

        const plane = (cmd as any).getPositionData().plane();
        expect(plane.origin.isEqualTo(XYZ.zero)).toBe(true);
        expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);

        (cmd as any).afterExecute();
    });

    test("beforeExecute creates the preview annotation on the circle", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();

        const annotations = dimensionAnnotations(doc);
        expect(annotations).toHaveLength(1);
        const annotation = annotations[0];
        expect(annotation.dimensionType).toBe("radial");
        expect(annotation.startPoint.isEqualTo(XYZ.zero)).toBe(true);
        expect(annotation.startPoint.distanceTo(annotation.endPoint)).toBeCloseTo(10);
        expect(annotation.planeNormal?.isEqualTo(XYZ.unitZ)).toBe(true);

        (cmd as any).afterExecute();
    });

    test("the cursor drives the leader direction and the text point", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();

        (cmd as any).dimensionPreview(new XYZ({ x: 0, y: 25, z: 0 }));

        const annotation = dimensionAnnotations(doc)[0];
        expect(annotation.startPoint.isEqualTo(XYZ.zero)).toBe(true);
        expect(annotation.endPoint.isEqualTo(new XYZ({ x: 0, y: 10, z: 0 }))).toBe(true);
        expect(annotation.textPoint.isEqualTo(new XYZ({ x: 0, y: 25, z: 0 }))).toBe(true);
        expect(annotation.value).toBeCloseTo(10);

        (cmd as any).afterExecute();
    });

    test("a pick at the circle center keeps the previous leader direction", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(new XYZ({ x: 0, y: 25, z: 0 }));

        (cmd as any).dimensionPreview(XYZ.zero);

        const annotation = dimensionAnnotations(doc)[0];
        expect(annotation.endPoint.isEqualTo(new XYZ({ x: 0, y: 10, z: 0 }))).toBe(true);

        (cmd as any).afterExecute();
    });

    test("prompt shows the radius, or the diameter for the diameter command", () => {
        const radial = radialCommand(new TestDocument(), () => new AnnotateRadialDimension());
        (radial as any).getPositionData().beforeExecute();
        expect((radial as any).dimensionPrompt()).toBe("R10.00");
        (radial as any).afterExecute();

        const diameter = radialCommand(new TestDocument(), () => new AnnotateDiameterDimension());
        (diameter as any).getPositionData().beforeExecute();
        expect((diameter as any).dimensionPrompt()).toBe("Ø20.00");
        (diameter as any).afterExecute();
    });

    test("a diameter preview spans the circle through its center", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateDiameterDimension());
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(new XYZ({ x: 0, y: 25, z: 0 }));

        const annotation = dimensionAnnotations(doc)[0];
        expect(annotation.dimensionType).toBe("diameter");
        expect(annotation.startPoint.isEqualTo(new XYZ({ x: 0, y: -10, z: 0 }))).toBe(true);
        expect(annotation.endPoint.isEqualTo(new XYZ({ x: 0, y: 10, z: 0 }))).toBe(true);
        expect(annotation.value).toBeCloseTo(20);

        (cmd as any).afterExecute();
    });

    test("executeMainTask commits the annotation under the Annotations folder", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(POSITION);
        (cmd as any).executeMainTask();

        const folders = annotationFolders(doc);
        expect(folders).toHaveLength(1);
        const annotations = dimensionAnnotations(doc);
        expect(annotations).toHaveLength(1);
        const annotation = annotations[0];
        expect(annotation.parent).toBe(folders[0]);
        expect(annotation.dimensionType).toBe("radial");
        expect(annotation.endPoint.isEqualTo(new XYZ({ x: 10, y: 0, z: 0 }))).toBe(true);
        expect(annotation.textPoint.isEqualTo(POSITION)).toBe(true);
        expect(annotation.planeNormal?.isEqualTo(XYZ.unitZ)).toBe(true);
        expect((cmd as any).repeatOperation).toBe(true);
    });

    test("a cancel removes the preview annotation and its folder", () => {
        const doc = new TestDocument();
        const cmd = radialCommand(doc, () => new AnnotateRadialDimension());
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(POSITION);

        (cmd as any).afterExecute();

        expect(dimensionAnnotations(doc)).toHaveLength(0);
        expect(annotationFolders(doc)).toHaveLength(0);
        expect(doc.history.undoCount()).toBe(0);
    });
});
