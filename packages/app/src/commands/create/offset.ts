// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    EditableShapeNode,
    GeometryUtils,
    I18n,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    type IWire,
    type JoinType,
    LengthAtAxisStep,
    MathUtils,
    property,
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
    @property("option.command.joinType", {
        combobox: Combobox.from([
            "option.command.joinType.arc",
            "option.command.joinType.tangent",
            "option.command.joinType.intersection",
        ]),
    })
    get joinType(): I18nKeys {
        return this.getPrivateValue("joinType", "option.command.joinType.arc");
    }
    set joinType(value: I18nKeys) {
        this.setProperty("joinType", value);
    }

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
                    validator: (point) => !MathUtils.almostEqual(point.sub(ax.point).dot(ax.direction), 0),
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
        const wire = shape.shapeType === ShapeTypes.face ? (shape as IFace).outerWire() : (shape as IWire);

        const nearest = GeometryUtils.nearestPoint(wire, start);
        let direction = this.wireTangent(nearest.edge, nearest.parameter);

        const nextEdge = GeometryUtils.findNextEdge(wire, nearest.edge).value;
        const nextDir = nextEdge && this.nextEdgeTangent(nearest.edge, nextEdge);
        if (nextDir && direction.cross(nextDir).normalize()?.isOppositeTo(normal)) {
            direction = direction.multiply(-1);
        }

        return { nearest, direction };
    }

    private wireTangent(edge: IEdge, param: number): XYZ {
        const t = edge.curve.dn(param, 1);
        return edge.orientation() === "reversed" ? t.multiply(-1) : t;
    }

    private nextEdgeTangent(current: IEdge, next: IEdge): XYZ | undefined {
        const currentCurve = current.curve;
        const wireEndParam =
            current.orientation() === "reversed"
                ? currentCurve.firstParameter()
                : currentCurve.lastParameter();
        const connectionPoint = currentCurve.value(wireEndParam);

        const nextCurve = next.curve;
        const nextFirst = nextCurve.firstParameter();
        const nextLast = nextCurve.lastParameter();
        const nextParam =
            connectionPoint.distanceTo(nextCurve.value(nextFirst)) <
            connectionPoint.distanceTo(nextCurve.value(nextLast))
                ? nextFirst
                : nextLast;

        let t = nextCurve.dn(nextParam, 1);
        if (next.orientation() === "reversed") {
            t = t.multiply(-1);
        }
        const wireStart = next.orientation() === "reversed" ? nextLast : nextFirst;
        if (nextParam !== wireStart) {
            t = t.multiply(-1);
        }
        return t;
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
        return wire.offset(distance, this.mapJoinType());
    }

    readonly mapJoinType = (): JoinType => {
        switch (this.joinType) {
            case "option.command.joinType.arc":
                return "arc";
            case "option.command.joinType.intersection":
                return "intersection";
            case "option.command.joinType.tangent":
                return "tangent";
            default:
                throw new Error("Unknow joinType");
        }
    };
}
