// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    EdgeMeshData,
    EditableShapeNode,
    GeometryNode,
    I18n,
    LineType,
    ShapeMeshData,
    VisualConfig,
    XYZ,
    command,
} from "chili-core";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.bezier",
    display: "command.bezier",
    icon: "icon-bezier",
})
export class BezierCommand extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let bezier = this.application.shapeFactory.bezier(this.stepDatas.map((x) => x.point!));
        return new EditableShapeNode(this.document, I18n.translate("command.bezier"), bezier.value);
    }

    protected override async executeSteps() {
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
        let firstStep = new PointStep("operate.pickFistPoint");
        let secondStep = new PointStep("operate.pickNextPoint", this.getNextData);
        return [firstStep, secondStep];
    }

    private readonly getNextData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas.at(-1)!.point!,
            dimension: Dimension.D1D2D3,
            validator: this.validator,
            preview: this.preview,
        };
    };

    private readonly preview = (point: XYZ | undefined): ShapeMeshData[] => {
        let ps: ShapeMeshData[] = this.stepDatas.map((data) => this.meshPoint(data.point!));
        let points = this.stepDatas.map((data) => data.point) as XYZ[];
        if (point) {
            points.push(point);
        }
        if (points.length > 1) {
            ps.push(...this.previewLines(points));
            ps.push(this.meshCreatedShape("bezier", points));
        }

        return ps;
    };

    private readonly previewLines = (points: XYZ[]): ShapeMeshData[] => {
        if (points.length < 2) {
            return [];
        }
        let res: ShapeMeshData[] = [];
        for (let i = 1; i < points.length; i++) {
            res.push(this.meshHandle(points[i - 1], points[i]));
        }
        return res;
    };

    protected meshHandle(start: XYZ, end: XYZ) {
        return EdgeMeshData.from(start, end, VisualConfig.temporaryEdgeColor, LineType.Dash);
    }

    private readonly validator = (point: XYZ): boolean => {
        for (const data of this.stepDatas) {
            if (point.distanceTo(data.point!) < 0.001) {
                return false;
            }
        }
        return true;
    };
}
