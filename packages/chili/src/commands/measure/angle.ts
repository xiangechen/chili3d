// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Precision, ShapeMeshData, VisualConfig, XYZ } from "chili-core";
import { Dimension, PointSnapData, SnapResult } from "../../snap";
import { IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

const ARC_POSITION = 0.5;

@command({
    key: "measure.angle",
    icon: "icon-measureAngle",
})
export class AngleMeasure extends MultistepCommand {
    protected override getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        const thirdStep = new PointStep("prompt.pickNextPoint", this.getThirdPointData);
        return [firstStep, secondStep, thirdStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };

    private readonly getThirdPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
            prompt: (result: SnapResult) => this.anglePrompt(result.point!),
            validator: (point: XYZ) => {
                return (
                    this.stepDatas[0].point!.distanceTo(point) > Precision.Distance &&
                    this.stepDatas[1].point!.distanceTo(point) > Precision.Distance
                );
            },
            preview: this.arcPreview,
        };
    };

    private readonly anglePrompt = (point: XYZ) => {
        const { rad } = this.arcInfo(point);
        return ((rad * 180) / Math.PI).toFixed(2) + "°";
    };

    private readonly arcPreview = (point: XYZ | undefined) => {
        const meshes: ShapeMeshData[] = [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(this.stepDatas[1].point!),
            this.meshLine(
                this.stepDatas[0].point!,
                this.stepDatas[1].point!,
                VisualConfig.highlightEdgeColor,
                3,
            ),
        ];
        if (!point) return meshes;

        const { v1, rad, normal } = this.arcInfo(point);
        const angle = (rad * 180) / Math.PI;
        if (angle < Precision.Angle) return meshes;

        const line2 = this.meshLine(this.stepDatas[0].point!, point, VisualConfig.highlightEdgeColor, 3);
        const arc = this.application.shapeFactory
            .arc(
                normal,
                this.stepDatas[0].point!,
                this.stepDatas[0].point!.add(v1.multiply(this.lineLength(point) * ARC_POSITION)),
                angle,
            )
            .unchecked()?.mesh.edges!;
        arc.lineWidth = 3;
        arc.color = VisualConfig.highlightEdgeColor;
        return [line2, arc, ...meshes];
    };

    private lineLength(point: XYZ | undefined) {
        const d1 = this.stepDatas[0].point!.distanceTo(this.stepDatas[1].point!);
        if (!point) {
            return d1;
        }
        const d2 = this.stepDatas[0].point!.distanceTo(point);
        return Math.min(d1, d2);
    }

    private arcInfo(point: XYZ) {
        const v1 = this.stepDatas[1].point!.sub(this.stepDatas[0].point!).normalize()!;
        const v2 = point.sub(this.stepDatas[0].point!).normalize()!;
        const rad = v1.angleTo(v2)!;
        const normal = v1.cross(v2).normalize()!;
        return {
            v1,
            v2,
            rad,
            normal,
        };
    }

    protected override executeMainTask(): void {
        const { v1, rad, normal } = this.arcInfo(this.stepDatas[2].point!);
        const arcMid = v1
            .rotate(normal, rad * 0.5)!
            .multiply(this.lineLength(this.stepDatas[2].point) * ARC_POSITION)
            .add(this.stepDatas[0].point!);
        const visualId = this.document.visual.context.displayMesh([
            this.meshPoint(this.stepDatas[2].point!),
            ...this.arcPreview(this.stepDatas[2].point),
       ]);
        this.application.activeView?.htmlText(((rad * 180) / Math.PI).toFixed(2) + "°", arcMid, {
            onDispose: () => {
                this.document.visual.context.removeMesh(visualId);
            },
        });
    }
}
