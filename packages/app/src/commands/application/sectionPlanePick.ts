// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type DatumPickResult,
    type DatumPlaneSpec,
    type FacePickResult,
    GeometryUtils,
    type IDocument,
    type IFace,
    type IStep,
    type Plane,
    PlanePickHandler,
    type SnapResult,
    type VisualShapeData,
} from "@chili3d/core";

export type SectionPlanePickResult = DatumPickResult | FacePickResult;

export class SectionPlanePickHandler extends PlanePickHandler<SectionPlanePickResult> {
    constructor(document: IDocument, controller: AsyncController) {
        super(document, controller, { unlit: true });
    }

    protected createDatumResult(datum: DatumPlaneSpec): DatumPickResult {
        return { kind: "datum", plane: datum.plane };
    }

    protected createFaceResult(face: VisualShapeData): FacePickResult {
        return { kind: "face", data: face };
    }
}

function planeFromPick(result: SectionPlanePickResult): Plane {
    if (result.kind === "datum") return result.plane;
    const face = result.data.shape.transformedMul(result.data.transform) as IFace;
    try {
        return GeometryUtils.planeFromFace(face);
    } finally {
        face.dispose();
    }
}

export class SectionPlanePickStep implements IStep {
    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        document.selection.clearSelection();
        const handler = new SectionPlanePickHandler(document, controller);
        try {
            await document.picker.pickAsync(
                handler,
                "prompt.select.plane",
                controller,
                "none",
                "select.default",
            );
            const view = document.application.activeView;
            if (!handler.result || !view) return undefined;
            const plane = planeFromPick(handler.result);
            const point = handler.result.kind === "face" ? handler.result.data.point : undefined;
            return { view, shapes: [], type: "input", point: point ?? plane.origin, plane };
        } finally {
            controller.dispose();
            handler.dispose();
        }
    }
}
