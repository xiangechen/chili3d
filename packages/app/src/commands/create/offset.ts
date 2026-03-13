// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    GeometryUtils,
    I18n,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    type IWire,
    LengthAtAxisStep,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.offset",
    icon: "icon-offset",
})
export class OffsetCommand extends MultistepCommand {
    protected override executeMainTask() {
        const normal = this.getAxis().normal;
        const shape = this.createOffsetShape(normal, this.stepDatas[1].distance!);
        const node = new EditableShapeNode({
            document: this.document,
            name: I18n.translate("command.create.offset"),
            shape: shape.value,
        });
        this.document.modelManager.rootNode.add(node);
        this.document.visual.update();
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                (ShapeTypes.edge | ShapeTypes.wire | ShapeTypes.face) as ShapeType,
                "prompt.select.shape",
            ),
            new LengthAtAxisStep("common.length", () => {
                const ax = this.getAxis();
                return {
                    point: ax.point,
                    direction: ax.direction,
                    preview: (point: XYZ | undefined) => this.preview(ax, point),
                };
            }),
        ];
    }

    private preview(
        ax: { point: XYZ; direction: XYZ; normal: XYZ },
        point: XYZ | undefined,
    ): ShapeMeshData[] {
        const res: ShapeMeshData[] = [this.meshPoint(ax.point)];
        if (point !== undefined) {
            res.push(this.meshLine(ax.point, point));
            const distance = point.sub(ax.point).dot(ax.direction);
            const shape = this.createOffsetShape(ax.normal, distance);
            if (shape.isOk) {
                res.push(shape.value.edgesMeshPosition());
            }
        }
        return res;
    }

    private getAxis(): { direction: XYZ; point: XYZ; normal: XYZ } {
        const start = this.stepDatas[0].shapes[0].point!;
        const shape = this.transformdFirstShape(this.stepDatas[0]);
        if (shape.shapeType === ShapeTypes.edge) {
            return this.getEdgeAxis(shape as IEdge, start);
        }

        return this.getFaceOrWireAxis(shape, start);
    }

    private getFaceOrWireAxis(shape: IShape, start: XYZ) {
        let face = shape as IFace;
        if (shape.shapeType === ShapeTypes.wire) {
            face = (shape as IWire).toFace().value;
        }
        const normal = face.normal(0, 0)[1];
        const { nearest, direction } = this.getNearstPointAndDirection(shape, start, normal);
        return {
            point: nearest.point,
            normal,
            direction: direction.cross(normal).normalize()!,
        };
    }

    private getEdgeAxis(edge: IEdge, start: XYZ) {
        const curve = edge.curve;
        const parameter = curve.parameter(start, curve.length() * 0.1);
        const direction = curve.dn(parameter!, 1);
        const normal = GeometryUtils.normal(edge);
        return {
            point: start,
            normal,
            direction: direction.cross(normal).normalize()!,
        };
    }

    private getNearstPointAndDirection(shape: IShape, start: XYZ, normal: XYZ) {
        let wire = shape as IWire;
        if (shape.shapeType === ShapeTypes.face) {
            wire = (shape as IFace).outerWire();
        }
        const nearest = GeometryUtils.nearestPoint(wire, start);
        let direction = nearest.edge.curve.dn(0, 1);
        const nextEdge = GeometryUtils.findNextEdge(wire, nearest.edge).value;
        if (nextEdge) {
            const scale = nearest.edge.orientation() === nextEdge.orientation() ? 1 : -1;
            const nextDirection = nextEdge.curve.dn(0, 1).multiply(scale);
            if (direction.cross(nextDirection).normalize()?.isOppositeTo(normal)) {
                direction = direction.multiply(-1);
            }
        }
        return { nearest, direction };
    }

    private createOffsetShape(normal: XYZ, distance: number) {
        const shape = this.transformdFirstShape(this.stepDatas[0]);
        if (shape.shapeType === ShapeTypes.edge) {
            return (shape as IEdge).offset(distance, normal);
        }

        let wire = shape as IWire;
        if (shape.shapeType === ShapeTypes.face) {
            wire = (shape as IFace).outerWire();
        }
        return wire.offset(distance, "intersection");
    }
}
