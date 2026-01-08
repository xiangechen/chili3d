// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    ComponentNode,
    type EdgeMeshData,
    GeometryNode,
    type Matrix4,
    MeshDataUtils,
    MeshNode,
    PubSub,
    property,
    Transaction,
    VisualConfig,
    VisualNode,
    type XYZ,
} from "chili-core";
import { MultistepCommand } from "../multistepCommand";

export abstract class TransformedCommand extends MultistepCommand {
    protected models?: VisualNode[];
    protected positions?: number[];

    @property("common.clone")
    get isClone() {
        return this.getPrivateValue("isClone", false);
    }
    set isClone(value: boolean) {
        this.setProperty("isClone", value);
    }

    protected abstract transfrom(p2: XYZ): Matrix4;

    protected transformPreview = (point: XYZ): EdgeMeshData => {
        const transform = this.transfrom(point);
        const positions = transform.ofPoints(this.positions!);
        return {
            position: new Float32Array(positions),
            lineType: "solid",
            color: VisualConfig.defaultEdgeColor,
            range: [],
        };
    };

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

        this.positions = this.models!.flatMap((model) => {
            if (model instanceof MeshNode) {
                return model.mesh.position ? model.transform.ofPoints(model.mesh.position) : [];
            } else if (model instanceof GeometryNode) {
                return model.mesh.edges?.position ? model.transform.ofPoints(model.mesh.edges.position) : [];
            } else if (model instanceof ComponentNode) {
                return Array.from(BoundingBox.wireframe(model.boundingBox()!).position);
            }
            return [];
        });
        return true;
    }

    protected getTempLineData(start: XYZ, end: XYZ) {
        return MeshDataUtils.createEdgeMesh(start, end, VisualConfig.temporaryEdgeColor, "solid");
    }

    protected executeMainTask(): void {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const transform = this.transfrom(this.stepDatas.at(-1)!.point!);

            if (this.isClone) {
                this.models?.forEach((x) => {
                    const clone = x.clone();
                    clone.transform = x.transform.multiply(transform);
                    x.parent?.insertAfter(x, clone);
                });
            } else {
                this.models?.forEach((x) => {
                    x.transform = x.transform.multiply(transform);
                });
            }

            this.document.visual.update();
        });
    }
}
