// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IStep,
    Plane,
    PointOnPlaneStep,
    type PointSnapData,
    PointStep,
    property,
    type ShapeMeshData,
    TextAnnotation,
    XYZ,
} from "@chili3d/core";
import { AnnotationCommandBase } from "./annotationCommandBase";

/**
 * Place a note: pick what it is about, then where the text sits.
 *
 * The text is drawn facing the camera (see the visual), so the second pick only has to
 * say *where* it goes, not which way it faces — it is constrained to the plane facing the
 * view through the picked point, which keeps the text under the cursor however the model
 * is turned. The leader runs from the picked point to the text, so what is picked first
 * is what the note reads as pointing at.
 */
@command({
    key: "annotate.text",
    icon: "icon-text",
})
export class TextAnnotationCommand extends AnnotationCommandBase<TextAnnotation> {
    @property("text.content")
    get content(): string {
        return this.getPrivateValue("content", "Text");
    }
    set content(value: string) {
        this.setProperty("content", value);
        this.redrawPreview?.();
    }

    protected override getSteps(): IStep[] {
        const leaderStep = new PointStep("prompt.pickLeaderPoint");
        const positionStep = new PointOnPlaneStep("prompt.pickTextPosition", this.getPositionStepData);
        return [leaderStep, positionStep];
    }

    private readonly getPositionStepData = (): PointSnapData => {
        return {
            prompt: () => this.content,
            preview: this.textPreview,
            plane: this.textPlane,
            beforeExecute: this.startPreview,
            onPreviewReady: this.onPreviewReady,
        };
    };

    /**
     * The plane the position pick is constrained to: the one through the picked point
     * facing the view, built the way `ViewUtils.ensurePlane` builds a working plane, so
     * the text lands where the cursor is rather than at some fixed depth.
     */
    private readonly textPlane = (): Plane => {
        const origin = this.stepDatas[0].point!;
        const view = this.application.activeView;
        const normal = view?.direction() ?? XYZ.unitNZ;
        // the camera's own left axis keeps the plane from being edge-on to the view
        const xvec = normal.cross(view?.up() ?? XYZ.unitY).normalize() ?? XYZ.unitX;
        return new Plane({ origin, normal, xvec });
    };

    private readonly textPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const leaderPoint = this.stepDatas[0].point!;
        if (point === undefined) return [this.meshPoint(leaderPoint)];

        if (this.previewAnnotation !== undefined) {
            this.previewAnnotation.content = this.content;
            this.previewAnnotation.textHeight = this.textHeight;
            this.previewAnnotation.position = point;
            this.document.visual.update();
        }
        return [this.meshPoint(leaderPoint), this.meshLine(leaderPoint, point)];
    };

    protected createPreviewAnnotation(): TextAnnotation {
        const leaderPoint = this.stepDatas[0].point!;
        return new TextAnnotation({
            document: this.document,
            name: "TextAnnotation",
            annotationType: "text",
            content: this.content,
            // On the leader's point until the cursor says where the text belongs.
            position: leaderPoint,
            leaderPoint,
            textHeight: this.textHeight,
        });
    }

    protected commitAnnotation(annotation: TextAnnotation): void {
        annotation.content = this.content;
        annotation.leaderPoint = this.stepDatas[0].point!;
        annotation.position = this.stepDatas[1].point!;
        annotation.textHeight = this.textHeight;
    }
}
