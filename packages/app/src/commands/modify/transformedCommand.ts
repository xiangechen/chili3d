// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Annotation,
    AsyncController,
    BoundingBox,
    ComponentNode,
    cloneForCopyNode,
    type EdgeMeshData,
    GeometryNode,
    isConsumedTool,
    isReferenceGeometryNode,
    type Matrix4,
    MeshDataUtils,
    MeshNode,
    MultistepCommand,
    PubSub,
    property,
    Transaction,
    VisualConfig,
    type VisualNode,
    type XYZ,
} from "@chili3d/core";

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
        // Reference geometry (datum planes) and inputs such as sketches are defined in
        // world space and are not placements of a body: moving them would only
        // desynchronise their references (or, for a sketch, do nothing at all).
        const transformable = (node: VisualNode) =>
            !isReferenceGeometryNode(node) && node.transformMode !== "none";
        const selected = this.document.selection.getSelectedVisualNodes();
        this.models = selected.filter(transformable);
        if (this.models.length > 0) return true;
        // A selection made only of inputs (a sketch, a datum plane) is not "nothing
        // selected": say why it cannot move instead of opening the picker again.
        if (selected.length > 0) {
            PubSub.default.pub("showToast", "toast.node.notTransformable");
            return false;
        }

        this.controller = new AsyncController();
        this.models = await this.document.picker.pickNode("prompt.select.models", this.controller, {
            multi: true,
            nodeFilter: { allow: transformable },
        });

        if (this.models.length > 0) return true;
        if (this.controller.result?.status === "success") {
            PubSub.default.pub("showToast", "toast.select.noSelected");
        }
        return false;
    }

    protected override async canExcute(): Promise<boolean> {
        if (!(await this.ensureSelectedModels())) return false;

        // Consumed boolean tools are owned by the body's feature list: copying one
        // would insert an unreferenced hidden child, moving one fights the body's
        // parametric placement. Filter them out before the preview positions are
        // computed so the preview matches what executeMainTask will actually touch.
        const freeModels = this.models!.filter((x) => !isConsumedTool(x));
        if (freeModels.length !== this.models!.length) {
            PubSub.default.pub("showToast", "toast.consumedTool.forbidden");
            this.models = freeModels;
        }
        if (freeModels.length === 0) return false;

        this.positions = this.models!.flatMap((model) => {
            if (model instanceof MeshNode) {
                return model.mesh.position ? model.transform.ofPoints(model.mesh.position) : [];
            } else if (model instanceof GeometryNode) {
                return model.mesh.edges?.position ? model.transform.ofPoints(model.mesh.edges.position) : [];
            } else if (model instanceof ComponentNode) {
                return Array.from(BoundingBox.wireframe(model.boundingBox()!).position);
            } else if (model instanceof Annotation) {
                const box = model.boundingBox();
                return box ? model.transform.ofPoints(Array.from(BoundingBox.wireframe(box).position)) : [];
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

            // `canExcute` already filtered consumed boolean tools and non-transformable
            // inputs out of `models`.
            if (this.isClone) {
                this.models?.forEach((x) => {
                    const clone = cloneForCopyNode(x, transform);
                    x.parent?.insertAfter(x, clone);
                });
            } else {
                this.models?.forEach((x) => {
                    this.applyPlacement(x, transform);
                });
            }

            this.document.visual.update();
        });
    }

    /**
     * Hooks rather than direct `transform` writes: a parametric body records the move as
     * a feature, a sketch refuses it. The fallback keeps plain-object test doubles and
     * third-party nodes that predate the hook working as before.
     */
    private applyPlacement(node: VisualNode, transform: Matrix4): void {
        const apply = (node as { applyTransform?: (matrix: Matrix4) => boolean }).applyTransform;
        if (apply !== undefined) {
            // Only an explicit refusal counts (same rule as the AI tool): a JS plugin's
            // hook that returns nothing still accepted the move.
            if (apply.call(node, transform) === false) {
                PubSub.default.pub("showToast", "toast.node.transformRefused");
            }
        } else {
            node.transform = node.transform.multiply(transform);
        }
    }
}
