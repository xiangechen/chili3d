// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    IApplication,
    ICommand,
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
import { SelectShapeStep } from "../step";

export class WorkingPlaneViewModel extends Observable {
    @Property.define("workingPlane.set")
    planes: SelectableItems<string> = new SelectableItems(["XOY", "YOZ", "ZOX"], SelectMode.radio, ["XOY"]);
}

@command({
    name: "workingPlane.set",
    display: "workingPlane.set",
    icon: "icon-setWorkingPlane",
})
export class SetWorkplane implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView;
        if (!view) return;
        const vm = new WorkingPlaneViewModel();
        PubSub.default.pub("showDialog", "workingPlane.set", vm, () => {
            const planes = [Plane.XY, Plane.YZ, Plane.ZX];
            view.workplane = planes[vm.planes.selectedIndexes[0]];
        });
    }
}

@command({
    name: "workingPlane.alignToPlane",
    display: "workingPlane.alignToPlane",
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
        const [point, normal] = (data.shapes[0].shape as IFace).normal(0, 0);
        let xvec = XYZ.unitX;
        if (!normal.isParallelTo(XYZ.unitZ)) {
            xvec = XYZ.unitZ.cross(normal).normalize()!;
        }
        view.workplane = new Plane(point, normal, xvec);
    }
}
