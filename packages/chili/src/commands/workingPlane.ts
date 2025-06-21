// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { RadioGroup, div } from "chili-controls";
import {
    AsyncController,
    DialogResult,
    I18n,
    IApplication,
    ICommand,
    ICurve,
    IEdge,
    IFace,
    Observable,
    Plane,
    Property,
    PubSub,
    SelectMode,
    SelectableItems,
    ShapeType,
    XYZ,
    command,
} from "chili-core";
import { Dimension } from "../snap";
import { IStep, PointOnCurveStep, SelectShapeStep } from "../step";
import { MultistepCommand } from "./multistepCommand";

export class WorkingPlaneViewModel extends Observable {
    @Property.define("dialog.title.selectWorkingPlane")
    planes: SelectableItems<string> = new SelectableItems(["XOY", "YOZ", "ZOX"], SelectMode.radio, ["XOY"]);
}

@command({
    key: "workingPlane.set",
    icon: "icon-setWorkingPlane",
})
export class SetWorkplane implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (!view) return;

        const vm = new WorkingPlaneViewModel();
        PubSub.default.pub("showDialog", "dialog.title.selectWorkingPlane", this.ui(vm), (result) => {
            if (result === DialogResult.ok) {
                const planes = [Plane.XY, Plane.YZ, Plane.ZX];
                view.workplane = planes[vm.planes.selectedIndexes[0]];
            }
        });
    }

    private ui(vm: WorkingPlaneViewModel) {
        return div(
            ...Property.getProperties(vm).map((x) => {
                const value = (vm as any)[x.name];
                if (value instanceof SelectableItems) {
                    return new RadioGroup(I18n.translate(x.display), value);
                }
                return "";
            }),
        );
    }
}

@command({
    key: "workingPlane.alignToPlane",
    icon: "icon-alignWorkingPlane",
})
export class AlignToPlane implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (!view) return;
        view.document.selection.clearSelection();
        const controller = new AsyncController();
        const data = await new SelectShapeStep(ShapeType.Face, "prompt.select.faces").execute(
            view.document,
            controller,
        );
        controller.dispose();
        if (!data || data.shapes.length === 0) return;
        view.document.visual.highlighter.clear();
        const face = data.shapes[0].shape.transformedMul(data.shapes[0].transform) as IFace;
        const [point, normal] = face.normal(0, 0);
        face.dispose();
        let xvec = XYZ.unitX;
        if (!normal.isParallelTo(XYZ.unitZ)) {
            xvec = XYZ.unitZ.cross(normal).normalize()!;
        }
        view.workplane = new Plane(point, normal, xvec);
    }
}

@command({
    key: "workingPlane.fromSection",
    icon: "icon-fromSection",
})
export class FromSection extends MultistepCommand {
    protected override executeMainTask() {
        const curve = this.transformedCurve();
        const point = this.stepDatas[1].point!;

        const parameter = curve.parameter(point, 1e-3);
        if (parameter === undefined) return;
        const direction = curve.d1(parameter).vec.normalize()!;
        let xvec: XYZ = this.findXVec(direction);
        const plane = new Plane(point, direction, xvec);
        const view = this.application.activeView;
        if (!view) return;
        view.workplane = plane;
    }

    private findXVec(direction: XYZ) {
        let xvec: XYZ;
        if (direction.isEqualTo(XYZ.unitZ)) {
            xvec = XYZ.unitX;
        } else if (direction.isEqualTo(new XYZ(0, 0, -1))) {
            xvec = XYZ.unitY;
        } else {
            xvec = direction.cross(XYZ.unitZ).normalize()!;
        }
        return xvec;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge, "prompt.select.edges"),
            new PointOnCurveStep("prompt.pickFistPoint", this.handlePointData, true),
        ];
    }

    private transformedCurve() {
        const shape = this.stepDatas[0].shapes[0].shape as IEdge;
        const matrix = shape.matrix.multiply(this.stepDatas[0].shapes[0].transform);
        const curve = shape.curve.transformed(matrix) as ICurve;
        this.disposeStack.add(curve);
        return curve;
    }

    private readonly handlePointData = () => {
        const curve = this.transformedCurve();
        return {
            curve,
            dimension: Dimension.D1,
            preview: (point: XYZ | undefined) => {
                if (!point) return [];
                let project = curve.project(point).at(0);
                return [this.meshPoint(project ?? point)];
            },
        };
    };
}
