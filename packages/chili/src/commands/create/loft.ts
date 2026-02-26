// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    Continuity,
    command,
    EditableShapeNode,
    type IEdge,
    type IShape,
    type IVertex,
    type IWire,
    PubSub,
    property,
    Result,
    ShapeType,
} from "chili-core";
import { SelectShapeStep } from "../../step";

@command({
    key: "create.loft",
    icon: "icon-loft",
})
export class LoftCommand extends CancelableCommand {
    private visual: number | undefined = undefined;
    private readonly shapes: IShape[] = [];
    private shape: Result<IShape> = Result.err("None shape");
    private readonly _continuity = this.initContinuties();

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
    })
    get continuity(): Combobox<string> {
        return this._continuity;
    }

    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    private initContinuties() {
        const box = new Combobox<string>();
        for (const item of Object.values(Continuity)) {
            if (typeof item === "number") continue;

            box.items.push(item.toString());
        }
        return box;
    }

    protected override async executeAsync(): Promise<void> {
        this._continuity.onPropertyChanged(this.handleContinuityChange);

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

            this.document.modelManager.addNode(new EditableShapeNode(this.document, "loft", this.shape));
        } finally {
            this._continuity.removePropertyChanged(this.handleContinuityChange);
            this.clearVisual();
        }
    }

    private async selectSection() {
        this.controller = new AsyncController();
        const step = new SelectShapeStep(
            ShapeType.Vertex | ShapeType.Wire | ShapeType.Edge,
            "prompt.select.section",
            {
                keepSelection: true,
            },
        );
        return await step.execute(this.document, this.controller);
    }

    private readonly handleContinuityChange = (p: keyof Combobox<string>) => {
        if (p === "selectedIndex") this.displayVisual();
    };

    private clearVisual() {
        this.removeVisual();
        this.document.visual.highlighter.clear();
        this.document.visual.update();
    }

    private displayVisual() {
        this.removeVisual();
        if (this.shapes.length < 2) {
            return false;
        }
        this.shape = this.document.application.shapeFactory.loft(
            this.shapes as (IVertex | IEdge | IWire)[],
            this.isSolid,
            this.isRuled,
            this.continuity.selectedIndex,
        );
        if (!this.shape.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", this.shape.error);
            return false;
        }
        this.visual = this.document.visual.context.displayMesh([this.shape.value.mesh.faces!], 0.5);
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
