// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type GeometryNode,
    type IEdge,
    type ILine,
    type IStep,
    isSameShapeData,
    Line,
    LineEdgeFilter,
    PubSub,
    property,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    VisualStates,
} from "@chili3d/core";
import { RevolvedNode } from "../../bodys";
import { CreateFromSelectionCommand } from "../createCommand";

@command({
    key: "create.revol",
    icon: "icon-revolve",
})
export class Revolve extends CreateFromSelectionCommand {
    private readonly axisFilter = new LineEdgeFilter();

    @property("common.angle")
    public get angle() {
        return this.getPrivateValue("angle", 360);
    }
    public set angle(value: number) {
        this.setProperty("angle", value);
    }

    protected override canExecute(): boolean {
        if (!super.canExecute()) return false;
        if (!Number.isFinite(this.angle) || this.angle === 0) {
            PubSub.default.pub("showToast", "error.input.invalidNumber");
            return false;
        }
        // The axis step keeps the profile selected, and confirming from the viewport hands
        // that selection back as the step's answer. A face/wire profile is not an axis, so
        // the edge gate has to be repeated here (the pick's filter never sees this path).
        const axis = this.stepDatas.at(1)?.shapes.at(0);
        const profile = this.stepDatas.at(0)?.shapes ?? [];
        if (axis !== undefined && profile.some((x) => isSameShapeData(x, axis))) {
            // A straight-edge profile is also a valid axis shape; revolving it about itself
            // is degenerate, so that pick is refused as well.
            PubSub.default.pub("showToast", "error.default:{0}", "The profile cannot be its own axis");
            return false;
        }
        if (
            axis !== undefined &&
            axis.shape.shapeType === ShapeTypes.edge &&
            this.axisFilter.allow(axis.shape)
        ) {
            return true;
        }
        PubSub.default.pub("showToast", "error.default:{0}", "Select a straight edge as the axis");
        return false;
    }

    protected override geometryNode(): GeometryNode {
        const shape = this.transformdFirstShape(this.stepDatas[0], false);
        const edge = (this.stepDatas[1].shapes[0].shape as IEdge).curve.basisCurve as ILine;
        const transform = this.stepDatas[1].shapes[0].transform;
        const axis = new Line({
            point: transform.ofPoint(edge.value(0)),
            direction: transform.ofVector(edge.direction),
        });
        return new RevolvedNode({ document: this.document, profile: shape, axis, angle: this.angle });
    }

    /**
     * The profile is the axis pick's context, not something to re-pick: keeping the selection
     * lets the axis be chosen with the profile still highlighted and selected.
     */
    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                (ShapeTypes.edge | ShapeTypes.face | ShapeTypes.wire) as ShapeType,
                "prompt.select.section",
            ),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.axis", {
                shapeFilter: this.axisFilter,
                keepSelection: true,
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
            }),
        ];
    }
}
