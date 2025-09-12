// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    Component,
    ComponentNode,
    GeometryNode,
    MathUtils,
    Matrix4,
    MeshLike,
    MeshNode,
    Plane,
    PlaneAngle,
    Precision,
    Property,
    PubSub,
    Ray,
    ShapeMeshData,
    Transaction,
    VisualNode,
    XYZ,
} from "chili-core";
import { Dimension, PointSnapData, SnapLengthAtPlaneData } from "../../snap";
import { AngleStep, IStep, LengthAtPlaneStep, PointOnAxisStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "modify.array",
    icon: "icon-array",
})
export class ArrayCommand extends MultistepCommand {
    private _planeAngle: PlaneAngle | undefined;
    private _meshId: number | undefined = undefined;
    protected models?: VisualNode[];
    protected meshData?: MeshLike;

    @Property.define("common.isGroup")
    get isGroup() {
        return this.getPrivateValue("isGroup", true);
    }
    set isGroup(value: boolean) {
        this.setProperty("isGroup", value);
    }

    @Property.define("option.command.circularPattern")
    get circularPattern() {
        return this.getPrivateValue("circularPattern", false);
    }
    set circularPattern(value: boolean) {
        this.setProperty("circularPattern", value, () => {
            this.restart();
        });
    }

    @Property.define("common.count", {
        dependencies: [
            {
                property: "circularPattern",
                value: true,
            },
        ],
    })
    get count() {
        return this.getPrivateValue("count", 3);
    }
    set count(value: number) {
        this.setProperty("count", value, () => this.resetMesh());
    }

    @Property.define("common.numberX", {
        dependencies: [
            {
                property: "circularPattern",
                value: false,
            },
        ],
    })
    get numberX() {
        return this.getPrivateValue("numberX", 3);
    }
    set numberX(value: number) {
        this.setProperty("numberX", value, () => this.resetMesh());
    }

    @Property.define("common.numberY", {
        dependencies: [
            {
                property: "circularPattern",
                value: false,
            },
        ],
    })
    get numberY() {
        return this.getPrivateValue("numberY", 3);
    }
    set numberY(value: number) {
        this.setProperty("numberY", value, () => this.resetMesh());
    }

    @Property.define("common.numberZ", {
        dependencies: [
            {
                property: "circularPattern",
                value: false,
            },
        ],
    })
    get numberZ() {
        return this.getPrivateValue("numberZ", 3);
    }
    set numberZ(value: number) {
        this.setProperty("numberZ", value, () => this.resetMesh());
    }

    private async ensureSelectedModels() {
        this.models = this.document.selection.getSelectedNodes().filter((x) => x instanceof VisualNode);
        if (this.models.length > 0) return true;

        this.controller = new AsyncController();
        this.models = await this.document.selection.pickNode("prompt.select.models", this.controller, true);

        if (this.models.length > 0) return true;
        if (this.controller.result?.status === "success") {
            PubSub.default.pub("showToast", "toast.select.noSelected");
        }

        return false;
    }

    protected override async canExcute(): Promise<boolean> {
        if (!(await this.ensureSelectedModels())) return false;

        const meshes = this.collectFaceMeshes();
        this.meshData = this.concatFaceMeshData(meshes);

        return true;
    }

    private collectFaceMeshes(): MeshLike[] {
        return (
            this.models?.map((model) => {
                let mesh: MeshLike | undefined;
                if (model instanceof MeshNode) {
                    mesh = model.mesh as MeshLike;
                } else if (model instanceof GeometryNode) {
                    mesh = model.mesh.faces!;
                } else if (model instanceof ComponentNode) {
                    mesh = this.concatFaceMeshData([
                        model.component.mesh.face,
                        model.component.mesh.surface as MeshLike,
                    ]);
                }
                if (!mesh) {
                    throw new Error("model not support array");
                }

                return {
                    position: new Float32Array(model.transform.ofPoints(mesh.position)),
                    normal: new Float32Array(model.transform.ofVectors(mesh.normal)),
                    index: mesh.index,
                    uv: mesh.uv,
                };
            }) ?? []
        );
    }

    private concatFaceMeshData(datas: MeshLike[]) {
        const positionLength = datas.reduce((prev, cur) => prev + cur.position.length, 0);
        const position = new Float32Array(positionLength);
        const normal = new Float32Array(positionLength);
        const uv = new Float32Array(datas.reduce((prev, cur) => prev + cur.uv.length, 0));
        const index = new Uint32Array(datas.reduce((prev, cur) => prev + cur.index.length, 0));

        let uvOffset = 0;
        let positionOffset = 0;
        let indexOffset = 0;
        for (const data of datas) {
            position.set(data.position, positionOffset);
            normal.set(data.normal, positionOffset);
            index.set(
                data.index.map((x) => x + positionOffset / 3),
                indexOffset,
            );
            uv.set(data.uv, uvOffset);

            uvOffset += data.uv.length;
            positionOffset += data.position.length;
            indexOffset += data.index.length;
        }
        return {
            position,
            normal,
            index,
            uv,
        };
    }

    override afterExecute() {
        this.removeMesh();

        super.afterExecute();
    }

    private removeMesh() {
        if (this._meshId) {
            this.document.visual.context.removeMesh(this._meshId);
            this._meshId = undefined;
        }
    }

    private resetMesh() {
        this.removeMesh();

        let count = this.count;
        if (!this.circularPattern) {
            count = this.numberX * this.numberY * this.numberZ;
        }
        const matrixs = new Array<Matrix4>(count).fill(new Matrix4());
        this._meshId = this.document.visual.context.displayInstancedMesh(this.meshData!, matrixs, 0.2);
    }

    private getBoxTransforms(xvec: XYZ, yvec: XYZ, zvec: XYZ) {
        const count = this.numberX * this.numberY * this.numberZ;
        const transforms = new Array<Matrix4>(count);
        let index = 0;
        for (let i = 0; i < this.numberX; i++) {
            for (let j = 0; j < this.numberY; j++) {
                for (let k = 0; k < this.numberZ; k++) {
                    const vec = xvec.multiply(i).add(yvec.multiply(j)).add(zvec.multiply(k));
                    transforms[index++] = Matrix4.fromTranslation(vec.x, vec.y, vec.z);
                }
            }
        }
        return transforms;
    }

    private getArcMatrixs(center: XYZ, normal: XYZ, angle: number) {
        const transforms = new Array<Matrix4>(this.count);
        for (let i = 0; i < this.count; i++) {
            transforms[i] = Matrix4.fromAxisRad(center, normal, i * angle);
        }
        return transforms;
    }

    protected override getSteps(): IStep[] {
        this.resetMesh();

        if (this.circularPattern) {
            return [
                new PointStep("prompt.pickCircleCenter", undefined, true),
                new LengthAtPlaneStep("prompt.pickRadius", this.getRadiusData, true),
                new AngleStep(
                    "prompt.pickNextPoint",
                    () => this.stepDatas[0].point!,
                    () => this.stepDatas[1].point!,
                    this.getAngleData,
                    true,
                ),
            ];
        } else {
            return [
                new PointStep("prompt.pickFistPoint", undefined, true),
                new PointStep("prompt.pickNextPoint", () => this.vectorArrayStepData(), true),
                new PointOnAxisStep("prompt.pickNextPoint", () => this.pointOnAxisArray(2), true),
                new PointOnAxisStep("prompt.pickNextPoint", () => this.pointOnAxisArray(3), true),
            ];
        }
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.circlePreview,
            plane: (p: XYZ | undefined) => this.findPlane(view, point!, p),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                return p.sub(point!).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };

    private readonly circlePreview = (end: XYZ | undefined) => {
        const visualCenter = this.meshPoint(this.stepDatas[0].point!);
        if (!end) return [visualCenter];
        const { point, view } = this.stepDatas[0];
        const plane = this.findPlane(view, point!, end);
        return [
            visualCenter,
            this.meshLine(this.stepDatas[0].point!, end),
            this.meshCreatedShape("circle", plane.normal, point!, plane.projectDistance(point!, end)),
        ];
    };

    private readonly getAngleData = () => {
        const [center, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, center, p1);
        const points: ShapeMeshData[] = [this.meshPoint(center), this.meshPoint(p1)];
        this._planeAngle = new PlaneAngle(new Plane(center, plane.normal, p1.sub(center)));

        return {
            dimension: Dimension.D1D2,
            preview: (point: XYZ | undefined) => this.anglePreview(point, center, p1, points),
            plane: () => plane,
            validators: [this.angleValidator(center, plane)],
        };
    };

    private anglePreview(
        point: XYZ | undefined,
        center: XYZ,
        p1: XYZ,
        points: ShapeMeshData[],
    ): ShapeMeshData[] {
        point = point ?? p1;
        this._planeAngle!.movePoint(point);
        const result = [...points];
        if (Math.abs(this._planeAngle!.angle) > Precision.Angle) {
            const transforms = this.getArcMatrixs(
                center,
                this._planeAngle!.plane.normal,
                MathUtils.degToRad(this._planeAngle!.angle),
            );
            this.document.visual.context.setInstanceMatrix(this._meshId!, transforms);

            result.push(
                this.meshCreatedShape(
                    "arc",
                    this._planeAngle!.plane.normal,
                    center,
                    p1,
                    this._planeAngle!.angle,
                ),
            );
        }
        return result;
    }

    private angleValidator(center: XYZ, plane: Plane) {
        return (p: XYZ) =>
            p.distanceTo(center) >= Precision.Distance && !p.sub(center).isParallelTo(plane.normal);
    }

    private readonly vectorArrayStepData = () => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            validator: (p: XYZ | undefined) =>
                p !== undefined && p.distanceTo(this.stepDatas[0].point!) > Precision.Distance,
            preview: (p: XYZ | undefined) => {
                if (!p) {
                    return [this.meshPoint(this.stepDatas[0].point!)];
                }
                const vector = p.sub(this.stepDatas[0].point!);
                const matrixs = this.getBoxTransforms(vector, XYZ.zero, XYZ.zero);
                this.document.visual.context.setInstanceMatrix(this._meshId!, matrixs);

                return [
                    this.meshPoint(this.stepDatas[0].point!),
                    this.meshLine(this.stepDatas[0].point!, p),
                    this.meshPoint(p),
                ];
            },
        } satisfies PointSnapData;
    };

    private readonly pointOnAxisArray = (index: 2 | 3) => {
        const { ray, yvec, normal, xvec } = this.boxPlaneInfo(index);

        return {
            ray,
            validator: (p: XYZ) => {
                return ray.location.distanceTo(p) > Precision.Distance;
            },
            preview: (p: XYZ | undefined) => {
                if (!p) {
                    return [this.meshPoint(this.stepDatas[0].point!)];
                }

                const matrixs = this.boxArrayMatrixs(index, xvec, yvec, normal, p);
                this.document.visual.context.setInstanceMatrix(this._meshId!, matrixs);
                return [
                    this.meshLine(this.stepDatas[1].point!, p),
                    this.meshPoint(p),
                    this.meshPoint(this.stepDatas[1].point!),
                ];
            },
        };
    };

    private boxArrayMatrixs(index: number, xvec: XYZ, yvec: XYZ, normal: XYZ, end: XYZ) {
        let y: XYZ, z: XYZ;
        if (index === 2) {
            y = yvec.multiply(end.sub(this.stepDatas[1].point!).dot(yvec));
            z = XYZ.zero;
        } else {
            y = yvec.multiply(this.stepDatas[2].point!.sub(this.stepDatas[1].point!).dot(yvec));
            z = normal.multiply(end.sub(this.stepDatas[1].point!).dot(normal));
        }
        return this.getBoxTransforms(xvec, y, z);
    }

    private boxPlaneInfo(index: number) {
        const plane =
            this.stepDatas[1].plane ??
            this.findPlane(this.stepDatas[1].view, this.stepDatas[0].point!, this.stepDatas[1].point);
        const xvec = this.stepDatas[1].point!.sub(this.stepDatas[0].point!);
        const yvec = plane.normal.isParallelTo(xvec) ? XYZ.unitY : plane.normal.cross(xvec).normalize()!;
        const normal = xvec.cross(yvec).normalize()!;
        const ray =
            index === 2
                ? new Ray(this.stepDatas[1].point!, yvec)
                : new Ray(this.stepDatas[1].point!, normal);
        return { ray, yvec, normal, xvec };
    }

    protected override executeMainTask(): void {
        const nodes: VisualNode[] = this.cloneNodes();

        Transaction.execute(this.document, "Array", () => {
            if (this.isGroup) {
                const component = new Component("Array", nodes);
                this.document.components.push(component);
                this.document.addNode(
                    new ComponentNode(this.document, "Array", component.id, component.origin),
                );
            } else {
                this.document.addNode(...nodes);
            }
            this.models?.forEach((model) => {
                model.parent?.remove(model);
            });
        });
    }

    private cloneNodes() {
        let matrixs: Matrix4[];
        if (this.circularPattern) {
            matrixs = this.getArcMatrixs(
                this.stepDatas[0].point!,
                this._planeAngle!.plane.normal,
                MathUtils.degToRad(this._planeAngle!.angle),
            );
        } else {
            const { xvec, yvec, normal } = this.boxPlaneInfo(3);
            matrixs = this.boxArrayMatrixs(3, xvec, yvec, normal, this.stepDatas[3].point!);
        }
        const nodes: VisualNode[] = [];
        for (const matrix of matrixs) {
            this.models?.forEach((model) => {
                const cloned = model.clone();
                cloned.transform = cloned.transform.multiply(matrix);
                nodes.push(cloned);
            });
        }
        return nodes;
    }
}
