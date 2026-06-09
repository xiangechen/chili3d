// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    Dimensions,
    I18n,
    type IEdge,
    type IStep,
    type PointSnapData,
    PointStep,
    property,
    type ShapeMeshData,
    type XYZ,
} from "@chili3d/core";
import { PipeNode } from "../../bodys";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.pipe",
    icon: "icon-pipe",
})
export class Pipe extends MultistepCommand {
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius", 5);
    }
    set radius(value: number) {
        this.setProperty("radius", value);
    }

    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    protected override executeMainTask(): void {
        const points = this.stepDatas.map((s) => s.point).filter((p): p is XYZ => !!p);
        if (points.length < 2) return;

        const edges: IEdge[] = [];
        for (let i = 0; i < points.length - 1; i++) {
            const result = shapeFactory.line(points[i], points[i + 1]);
            if (result.isOk) {
                edges.push(result.value);
            }
        }

        const pathResult = shapeFactory.wire(edges);
        if (!pathResult.isOk) return;

        const node = new PipeNode({ document: this.document, radius: this.radius, path: pathResult.value });
        this.document.modelManager.addNode(node);
        this.document.selection.setSelection([node], false);
    }

    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        let firstStep = true;
        while (true) {
            const step = firstStep ? steps[0] : steps[1];
            if (firstStep) firstStep = false;

            this.controller = new AsyncController();
            const data = await step.execute(this.document, this.controller);

            if (data === undefined) {
                return this.controller.result?.status === "success";
            }

            this.stepDatas.push(data);
        }
    }

    protected override getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private readonly getNextData = (): PointSnapData => {
        const lastPoint = this.stepDatas.at(-1)?.point;
        const firstPoint = this.stepDatas.at(0)?.point;
        const data: PointSnapData = {
            refPoint: () => {
                if (!lastPoint) throw new Error("Missing last point for snap reference");
                return lastPoint;
            },
            dimension: Dimensions.D1D2D3,
            preview: this.preview,
        };
        if (firstPoint && this.stepDatas.length > 1) {
            data.featurePoints = [
                {
                    point: firstPoint,
                    prompt: I18n.translate("common.confirm"),
                    when: () => this.stepDatas.length > 1,
                },
            ];
        }
        return data;
    };

    private readonly preview = (point: XYZ | undefined): ShapeMeshData[] => {
        const validPts: XYZ[] = [];
        for (const s of this.stepDatas) {
            if (s.point) validPts.push(s.point);
        }

        const meshPts = validPts.map((p) => this.meshPoint(p));
        const lines: ShapeMeshData[] = [];

        for (let i = 0; i < validPts.length - 1; i++) {
            lines.push(this.meshLine(validPts[i], validPts[i + 1]));
        }

        if (point && validPts.length > 0) {
            lines.push(this.meshLine(validPts[validPts.length - 1], point));
        }

        return [...meshPts, ...lines];
    };
}
