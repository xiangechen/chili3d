// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    EdgeMeshDataBuilder,
    I18n,
    type IEdge,
    property,
    type ShapeMeshData,
    type XYZ,
} from "chili-core";
import { PipeNode } from "../../bodys";
import { Dimension, type PointSnapData } from "../../snap";
import { type IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.pipe",
    icon: "icon-pipe", // Ensure this icon exists
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
        const points = this.stepDatas.map((s) => s.point!).filter((p) => !!p);
        if (points.length < 2) return;

        // Build edges
        const edges: IEdge[] = [];
        for (let i = 0; i < points.length - 1; i++) {
            const result = this.application.shapeFactory.line(points[i], points[i + 1]);
            if (result.isOk) {
                edges.push(result.value);
            }
        }
        const pathResult = this.application.shapeFactory.wire(edges);
        if (!pathResult.isOk) return;
        const path = pathResult.value;

        const node = new PipeNode(this.document, this.radius, path);
        // Add to document
        this.document.modelManager.addNode(node);
        this.document.selection.setSelection([node], false);
    }

    // Logic from Polygon for dynamic steps
    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        let firstStep = true;
        while (true) {
            const step = firstStep ? steps[0] : steps[1];
            if (firstStep) firstStep = false;

            this.controller = new AsyncController();
            // Pass controller to be able to cancel/finish
            const data = await step.execute(this.document, this.controller);

            if (data === undefined) {
                // If data is undefined, it might be a confirm (success) or cancel (fail)
                return this.controller.result?.status === "success";
            }

            this.stepDatas.push(data);
            // Unlike polygon, we don't auto-close on point match, user must confirm/finish?
            // Or we can double click (simulate confirm)?
        }
    }

    protected override getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private readonly getNextData = (): PointSnapData => {
        const lastPoint = this.stepDatas.at(-1)?.point;
        return {
            refPoint: () => lastPoint!, // refPoint expects XYZ, force it (checked in logic)
            dimension: Dimension.D1D2D3,
            preview: this.preview,
            featurePoints: [
                {
                    point: this.stepDatas.at(0)?.point!, // Not closing, but confirming?
                    prompt: I18n.translate("common.confirm"), // Or "Finish"?
                    when: () => this.stepDatas.length > 1,
                    // Wait, Polygon logic uses featurePoints to detect closure.
                    // We can use it to let user click on last point to finish?
                    // Or first point?
                    // Let's rely on the property button "Confirm" or Double click/Enter (which controller handles).
                },
            ],
        };
    };

    private readonly preview = (point: XYZ | undefined): ShapeMeshData[] => {
        const ps = this.stepDatas.map((data) => this.meshPoint(data.point!));
        const edges = new EdgeMeshDataBuilder();
        this.stepDatas.forEach((data, index) => {
            if (index < this.stepDatas.length - 1) {
                // edges.addPosition ... but we need lines between them
            }
        });

        // Simpler: just recreate lines
        const lines: ShapeMeshData[] = [];
        for (let i = 0; i < this.stepDatas.length - 1; i++) {
            lines.push(this.meshLine(this.stepDatas[i].point!, this.stepDatas[i + 1].point!));
        }

        if (point && this.stepDatas.length > 0) {
            lines.push(this.meshLine(this.stepDatas.at(-1)!.point!, point));
        }

        return [...ps, ...lines]; // spread
    };
}
