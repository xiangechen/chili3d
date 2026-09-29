// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CommandStore,
    DimensionAnnotation,
    FolderNode,
    type IDocument,
    type INode,
    PointOnPlaneStep,
    PubSub,
    SelectShapeStep,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import { AnnotateAngleDimension } from "../../../src/commands/annotate/angleDimension";
import { pointStepResult, seedStepDatas, shapeStepResult } from "../commandTestUtils";

/** A straight edge mock: `curve.basisCurve` reads as a line, `ends()` gives the segment. */
function lineShape(start: XYZ, end: XYZ) {
    return {
        curve: { basisCurve: { direction: end.sub(start).normalize()! } },
        ends: () => [start, end] as [XYZ, XYZ],
    };
}

const X_EDGE = lineShape(XYZ.zero, new XYZ({ x: 10, y: 0, z: 0 }));
const Y_EDGE = lineShape(XYZ.zero, new XYZ({ x: 0, y: 10, z: 0 }));
const POSITION = new XYZ({ x: 20, y: 20, z: 0 });

/** Wires the command to a document, both edges picked and the position placed. */
function angleCommand(
    doc: IDocument,
    edges: [ReturnType<typeof lineShape>, ReturnType<typeof lineShape>] = [X_EDGE, Y_EDGE],
    position: XYZ = POSITION,
): AnnotateAngleDimension {
    const cmd = new AnnotateAngleDimension();
    const app = createMockApplication();
    app.activeView = { document: doc } as any;
    (cmd as any)._application = app;
    seedStepDatas(cmd, [
        shapeStepResult([{ shape: edges[0] as any }]),
        shapeStepResult([{ shape: edges[1] as any }]),
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

describe("AnnotateAngleDimension", () => {
    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("should be registered in the CommandStore with its metadata", () => {
        const data = CommandStore.getComandData("annotate.angle");
        expect(data).not.toBeUndefined();
        expect(data!.key).toBe("annotate.angle");
        expect(data!.icon).toBe("icon-dAngle");
    });

    test("getSteps returns two line-edge picks then a position pick", () => {
        const steps = (new AnnotateAngleDimension() as any).getSteps();
        expect(steps).toHaveLength(3);
        expect(steps[0] instanceof SelectShapeStep).toBe(true);
        expect(steps[1] instanceof SelectShapeStep).toBe(true);
        expect(steps[2] instanceof PointOnPlaneStep).toBe(true);

        const filter = steps[0].options.shapeFilter;
        expect(filter.allow({ curve: { basisCurve: { direction: XYZ.unitX } } })).toBe(true);
        expect(
            filter.allow({ curve: { basisCurve: { center: XYZ.zero, radius: 1, axis: XYZ.unitZ } } }),
        ).toBe(false);
    });

    test("beforeExecute computes the vertex at the lines' intersection", () => {
        const doc = new TestDocument();
        const cmd = angleCommand(doc);
        (cmd as any).getPositionData().beforeExecute();

        const angle = (cmd as any).angle;
        expect(angle.vertex.isEqualTo(XYZ.zero)).toBe(true);
        expect(angle.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        // directions point from the vertex toward each edge's visible side
        expect(angle.p1.isEqualTo(XYZ.unitX)).toBe(true);
        expect(angle.p2.isEqualTo(XYZ.unitY)).toBe(true);

        (cmd as any).afterExecute();
    });

    test("the vertex of skew lines is the midpoint of their closest approach", () => {
        const doc = new TestDocument();
        // line along X at z=4, line along Y through the origin: closest pair (0,0,4)/(0,0,0)
        const skewed = lineShape(new XYZ({ x: 5, y: 0, z: 4 }), new XYZ({ x: 15, y: 0, z: 4 }));
        const cmd = angleCommand(doc, [skewed, Y_EDGE]);
        (cmd as any).getPositionData().beforeExecute();

        const angle = (cmd as any).angle;
        expect(angle.vertex.isEqualTo(new XYZ({ x: 0, y: 0, z: 2 }))).toBe(true);
        // the skewed edge's midpoint sits at +X of the vertex, so d1 keeps +X
        expect(angle.p1.isEqualTo(angle.vertex.add(XYZ.unitX))).toBe(true);

        (cmd as any).afterExecute();
    });

    test("the position pick is constrained to the angle's plane", () => {
        const cmd = angleCommand(new TestDocument());
        (cmd as any).getPositionData().beforeExecute();

        const plane = (cmd as any).getPositionData().plane();
        expect(plane.origin.isEqualTo(XYZ.zero)).toBe(true);
        expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);

        (cmd as any).afterExecute();
    });

    test("prompt shows the live sweep in degrees, reflex included", () => {
        const cmd = angleCommand(new TestDocument());
        (cmd as any).getPositionData().beforeExecute();

        const data = (cmd as any).getPositionData();
        expect(data.prompt(pointStepResult({ point: new XYZ({ x: 2, y: 2, z: 0 }) }))).toBe("90.0°");
        expect(data.prompt(pointStepResult({ point: new XYZ({ x: -2, y: -2, z: 0 }) }))).toBe("270.0°");

        (cmd as any).afterExecute();
    });

    test("beforeExecute creates the preview annotation with the vertex as centerPoint", () => {
        const doc = new TestDocument();
        const cmd = angleCommand(doc);
        (cmd as any).getPositionData().beforeExecute();

        const annotations = dimensionAnnotations(doc);
        expect(annotations).toHaveLength(1);
        const annotation = annotations[0];
        expect(annotation.dimensionType).toBe("angular");
        expect(annotation.centerPoint?.isEqualTo(XYZ.zero)).toBe(true);
        expect(annotation.startPoint.isEqualTo(XYZ.unitX)).toBe(true);
        expect(annotation.endPoint.isEqualTo(XYZ.unitY)).toBe(true);

        (cmd as any).afterExecute();
    });

    test("the cursor drives only the text point", () => {
        const doc = new TestDocument();
        const cmd = angleCommand(doc);
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(POSITION);

        const annotation = dimensionAnnotations(doc)[0];
        expect(annotation.textPoint.isEqualTo(POSITION)).toBe(true);
        expect(annotation.value).toBeCloseTo(90);

        (cmd as any).afterExecute();
    });

    test("executeMainTask commits the angular annotation under the Annotations folder", () => {
        const doc = new TestDocument();
        const cmd = angleCommand(doc);
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(POSITION);
        (cmd as any).executeMainTask();

        const folders = annotationFolders(doc);
        expect(folders).toHaveLength(1);
        const annotations = dimensionAnnotations(doc);
        expect(annotations).toHaveLength(1);
        const annotation = annotations[0];
        expect(annotation.parent).toBe(folders[0]);
        expect(annotation.dimensionType).toBe("angular");
        expect(annotation.centerPoint?.isEqualTo(XYZ.zero)).toBe(true);
        expect(annotation.textPoint.isEqualTo(POSITION)).toBe(true);
        expect(annotation.value).toBeCloseTo(90);
        expect(annotation.formattedValue()).toBe("90.0°");
        expect((cmd as any).repeatOperation).toBe(true);
    });

    test("a cancel removes the preview annotation and its folder", () => {
        const doc = new TestDocument();
        const cmd = angleCommand(doc);
        (cmd as any).getPositionData().beforeExecute();
        (cmd as any).dimensionPreview(POSITION);

        (cmd as any).afterExecute();

        expect(dimensionAnnotations(doc)).toHaveLength(0);
        expect(annotationFolders(doc)).toHaveLength(0);
        expect(doc.history.undoCount()).toBe(0);
    });

    test("parallel edges toast and cancel instead of creating a preview", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        const parallel = lineShape(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 }));
        const doc = new TestDocument();
        const cmd = angleCommand(doc, [X_EDGE, parallel]);
        (cmd as any).controller = { cancel: rs.fn(), dispose: () => {} };

        (cmd as any).getPositionData().beforeExecute();

        expect((cmd as any).angle).toBeUndefined();
        expect(pub).toHaveBeenCalledWith("showToast", "toast.dimension.parallelEdges");
        expect((cmd as any).controller.cancel).toHaveBeenCalled();
        expect(dimensionAnnotations(doc)).toHaveLength(0);

        (cmd as any).afterExecute();
    });

    test("the parallel-edge cancel settles a pick registered after beforeExecute", async () => {
        const parallel = lineShape(new XYZ({ x: 0, y: 5, z: 0 }), new XYZ({ x: 10, y: 5, z: 0 }));
        const doc = new TestDocument();
        const cmd = angleCommand(doc, [X_EDGE, parallel]);
        const controller = new AsyncController();
        (cmd as any).controller = controller;

        (cmd as any).getPositionData().beforeExecute();
        expect(controller.result?.status).toBe("cancel");

        // The real Picker registers its listeners only when pickAsync runs — after the
        // step's beforeExecute. Before the replay fix this promise never settled and the
        // command (and with it every later command) hung for good.
        let settledWith: string | undefined;
        const pick = new Promise<void>((resolve, reject) => {
            controller.onCompleted(() => {
                settledWith = "success";
                resolve();
            });
            controller.onCancelled(() => {
                settledWith = "cancel";
                resolve();
            });
            controller.onFailed((e) => reject(new Error(e.message ?? "pick failed")));
        });
        const outcome = await Promise.race([
            pick,
            new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1000)),
        ]);

        expect(outcome).not.toBe("timeout");
        expect(settledWith).toBe("cancel");
        expect(dimensionAnnotations(doc)).toHaveLength(0);

        (cmd as any).afterExecute();
    });
});
