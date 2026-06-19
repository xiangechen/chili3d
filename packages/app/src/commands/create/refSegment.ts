// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    RefSegmentAnnotation,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

/**
 * Creates a RefSegmentAnnotation — a dashed reference line segment
 * between two picked points.  Unlike geometry nodes, annotations are
 * construction helpers that live on the document's AnnotationManager.
 */
@command({
    key: "create.refSegment",
    icon: "icon-line",
})
export class RefSegment extends MultistepCommand {
    protected override executeMainTask(): void {
        Transaction.execute(this.document, "create RefSegmentAnnotation", () => {
            const annotation = new RefSegmentAnnotation({
                document: this.document,
                name: "RefSegmentAnnotation",
                annotationType: "refSegment",
                startPoint: this.stepDatas[0].point!,
                endPoint: this.stepDatas[1].point!,
            });
            this.document.modelManager.addNode(annotation);
            this.document.visual.update();
        });
        this.repeatOperation = true;
    }

    getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override resetStepDatas(): void {
        // Reuse the last endpoint as the start of the next segment
        this.stepDatas[0] = this.stepDatas[1];
        this.stepDatas.length = 1;
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.segmentPreview,
        };
    };

    private readonly segmentPreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };
}
