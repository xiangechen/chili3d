import {
    EditableShapeNode,
    GeometryNode,
    I18n,
    IEdge,
    IFace,
    IShape,
    IWire,
    JoinType,
    ShapeMeshData,
    ShapeType,
    XYZ,
    command,
} from "chili-core";
import { GeoUtils } from "chili-geo";
import { IStep, LengthAtAxisStep, SelectShapeStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    name: "create.offset",
    display: "command.offset",
    icon: "icon-offset",
})
export class OffsetCommand extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        let normal = this.getAxis().normal;
        let shape = this.createOffsetShape(normal, this.stepDatas[1].distance!);
        return new EditableShapeNode(this.document, I18n.translate("command.offset"), shape.value);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                ShapeType.Edge | ShapeType.Wire | ShapeType.Face,
                "prompt.select.shape",
                false,
            ),
            new LengthAtAxisStep("common.length", () => {
                let ax = this.getAxis();
                return {
                    point: ax.point,
                    direction: ax.direction,
                    preview: (point: XYZ | undefined) => {
                        let res: ShapeMeshData[] = [this.previewPoint(ax.point)];
                        if (point === undefined) return res;
                        res.push(this.previewLine(ax.point, point));

                        let distance = point.sub(ax.point).dot(ax.direction);
                        let shape = this.createOffsetShape(ax.normal, distance);
                        if (shape.isOk) {
                            res.push(shape.value.mesh.edges!);
                        }
                        return res;
                    },
                };
            }),
        ];
    }

    private getAxis(): { direction: XYZ; point: XYZ; normal: XYZ } {
        let start = this.stepDatas[0].shapes[0].point!;
        let shape = this.stepDatas[0].shapes[0].shape;
        if (shape.shapeType === ShapeType.Edge) {
            return this.getEdgeAxis(shape as IEdge, start);
        }

        return this.getFaceOrWireAxis(shape, start);
    }

    private getFaceOrWireAxis(shape: IShape, start: XYZ) {
        let face = shape as IFace;
        if (shape.shapeType === ShapeType.Wire) {
            face = (shape as IWire).toFace().value;
        }
        let normal = face.normal(0, 0)[1];
        let { nearest, direction } = this.getNearstPointAndDirection(shape, start, normal);
        return {
            point: nearest.point,
            normal,
            direction: direction.cross(normal).normalize()!,
        };
    }

    private getEdgeAxis(edge: IEdge, start: XYZ) {
        let curve = edge.curve();
        let direction = curve.dn(curve.parameter(start, 1e-3)!, 1);
        let normal = GeoUtils.normal(edge);
        return {
            point: start,
            normal,
            direction: direction.cross(normal).normalize()!,
        };
    }

    private getNearstPointAndDirection(shape: IShape, start: XYZ, normal: XYZ) {
        let wire = shape as IWire;
        if (shape.shapeType === ShapeType.Face) {
            wire = (shape as IFace).outerWire();
        }
        let nearest = GeoUtils.nearestPoint(wire, start);
        let nextEdge = GeoUtils.findNextEdge(wire, nearest.edge).value;
        let direction = nearest.edge.curve().dn(0, 1);
        let scale = nearest.edge.orientation() === nextEdge.orientation() ? 1 : -1;
        let nextDirection = nextEdge.curve().dn(0, 1).multiply(scale);
        if (direction.cross(nextDirection).normalize()?.isOppositeTo(normal)) {
            direction = direction.multiply(-1);
        }
        return { nearest, direction };
    }

    private createOffsetShape(normal: XYZ, distance: number) {
        let shape = this.stepDatas[0].shapes[0].shape;
        if (shape.shapeType === ShapeType.Edge) {
            return (shape as IEdge).offset(distance, normal);
        }

        let wire = shape as IWire;
        if (shape.shapeType === ShapeType.Face) {
            wire = (shape as IFace).outerWire();
        }
        return wire.offset(distance, JoinType.intersection);
    }
}
