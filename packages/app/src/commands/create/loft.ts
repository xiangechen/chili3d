// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    Continuities,
    type Continuity,
    command,
    EditableShapeNode,
    type IEdge,
    type IShape,
    type IVertex,
    type IWire,
    PubSub,
    property,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypes,
    VisualConfig,
} from "@chili3d/core";

@command({
    key: "create.loft",
    icon: "icon-loft",
})
export class LoftCommand extends CancelableCommand {
    private visual: number | undefined = undefined;
    private readonly shapes: IShape[] = [];
    private shape: Result<IShape> = Result.err("None shape");
    private readonly _continuity = Continuities[0];

    @property("option.command.isSolid")
    get isSolid() {
        return this.getPrivateValue("isSolid", false);
    }
    set isSolid(value: boolean) {
        this.setProperty("isSolid", value, () => {
            this.displayVisual();
        });
    }

    @property("option.command.isRuled")
    get isRuled() {
        return this.getPrivateValue("isRuled", false);
    }
    set isRuled(value: boolean) {
        this.setProperty("isRuled", value, () => {
            this.displayVisual();
        });
    }

    @property("option.command.continuity", {
        dependencies: [
            {
                property: "isRuled",
                value: false,
            },
        ],
        combobox: Combobox.from([...Continuities]),
    })
    get continuity(): Continuity {
        return this._continuity;
    }
    set continuity(value: Continuity) {
        this.setProperty("continuity", value, () => {
            console.log(value);
            this.displayVisual();
        });
    }

    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    protected override async executeAsync(): Promise<void> {
        try {
            while (true) {
                const data = await this.selectSection();
                if (data === undefined) {
                    if (this.controller?.result?.status === "success") {
                        break;
                    } else {
                        return;
                    }
                }

                this.shapes.push(data.shapes[0].shape.transformedMul(data.nodes![0].worldTransform()));
                this.displayVisual();
            }

            this.document.modelManager.addNode(
                new EditableShapeNode({ document: this.document, name: "loft", shape: this.shape }),
            );
        } finally {
            this.clearVisual();
        }
    }

    private async selectSection() {
        this.controller = new AsyncController();
        const step = new SelectShapeStep(
            (ShapeTypes.vertex | ShapeTypes.wire | ShapeTypes.edge) as ShapeType,
            "prompt.select.section",
        );
        return await step.execute(this.document, this.controller);
    }

    private clearVisual() {
        this.removeVisual();
        this.document.visual.highlighter.clear();
        this.document.visual.update();
    }

    private displayVisual() {
        this.removeVisual();
        const edges: ShapeMeshData[] = this.shapes.map((x) => {
            const m = x.mesh.edges!;
            m.color = VisualConfig.selectedEdgeColor;
            m.lineWidth = 3;
            return m;
        });
        if (this.shapes.length > 1) {
            this.shape = shapeFactory.loft(
                this.shapes as (IVertex | IEdge | IWire)[],
                this.isSolid,
                this.isRuled,
                this.continuity,
            );
            if (!this.shape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", this.shape.error);
            } else {
                edges.push(this.shape.value.mesh.faces!);
            }
        }
        this.visual = this.document.visual.context.displayMesh(edges, {
            meshOpacity: 0.5,
        });
        this.document.visual.update();
        return true;
    }

    readonly removeVisual = () => {
        if (this.visual !== undefined) {
            this.document.visual.context.removeMesh(this.visual);
            this.visual = undefined;
        }
    };
}
