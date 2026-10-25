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
    type IFace,
    type IShape,
    type IVertex,
    type IWire,
    instanceSourcesInUse,
    PubSub,
    property,
    Result,
    SelectShapeStep,
    type ShapeMeshData,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    Transaction,
    VisualConfig,
    type VisualShapeData,
} from "@chili3d/core";
import { selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.loft",
    icon: "icon-loft",
})
export class LoftCommand extends CancelableCommand {
    private visual: number | undefined = undefined;
    private readonly shapes: IShape[] = [];
    private readonly selectedDatas: SnapResult[] = [];
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
        this.setProperty("continuity", value, () => this.displayVisual());
    }

    @property("option.command.deleteObjects")
    get deleteObjects() {
        return this.getPrivateValue("deleteObjects", true);
    }
    set deleteObjects(value: boolean) {
        this.setProperty("deleteObjects", value);
    }

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

                if (this.acceptSection(data)) this.displayVisual();
            }

            this.commitLoft();
        } finally {
            this.clearVisual();
        }
    }

    /**
     * Adds the lofted node and drops the picked sections, as one undo step.
     *
     * `shape` is only filled once there is a loft to build (`displayVisual`), so it is still
     * the initial failure when the user confirms with fewer than two sections — committing
     * that would drop an empty node under the cursor. The kernel refusing the picked
     * sections leaves the same failure behind, and `displayVisual` has already said so.
     */
    private commitLoft(): void {
        if (!this.shape.isOk) {
            if (this.shapes.length < 2) {
                PubSub.default.pub("showToast", "error.default:{0}", "Loft requires at least 2 sections");
            }
            return;
        }
        const sections = selectedWholeShapeNodes(this.selectedDatas);
        // The loft is a new node, not a replacement for any section: consuming a
        // referenced section would leave its instances dangling.
        if (this.deleteObjects && instanceSourcesInUse(this.document, sections).size > 0) {
            PubSub.default.pub("showToast", "toast.instance.sourceInUse");
            return;
        }
        Transaction.execute(this.document, "loft", () => {
            this.document.modelManager.addNode(
                new EditableShapeNode({ document: this.document, name: "loft", shape: this.shape }),
            );
            if (this.deleteObjects) {
                sections.forEach((node) => {
                    node.parent?.remove(node);
                });
            }
        });
    }

    /** Adds a section if it is a usable one; refusals publish their own reason. */
    private acceptSection(data: SnapResult): boolean {
        const previous = this.selectedDatas.at(-1)?.shapes.at(0);
        // A vertex may open or close the loft, but not sit in the middle: once it has a
        // section after it, nothing else may follow.
        if (previous?.shape.shapeType === ShapeTypes.vertex && this.selectedDatas.length >= 2) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Loft vertex sections must be first or last",
            );
            return false;
        }
        const picked = data.shapes[0];
        if (this.isDuplicate(picked)) return false;

        const section = this.sectionShape(picked);
        if (!section.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", section.error);
            return false;
        }
        try {
            this.shapes.push(section.value.transformedMul(data.shapes[0].transform));
        } finally {
            if (section.value !== picked.shape) section.value.dispose();
        }
        this.selectedDatas.push(data);
        return true;
    }

    /** A face section lofts by its outer boundary; an edge section has to close on itself. */
    private sectionShape(picked: VisualShapeData): Result<IShape> {
        if (picked.shape.shapeType === ShapeTypes.face) {
            // A face without an outer boundary throws rather than answering; report it the
            // same way every other refusal here is reported.
            try {
                return Result.ok((picked.shape as unknown as IFace).outerWire());
            } catch {
                return Result.err("A loft section face has no outer boundary");
            }
        }
        if (picked.shape.shapeType === ShapeTypes.edge && !(picked.shape as IEdge).isClosed()) {
            return Result.err("A loft section edge must be closed");
        }
        return Result.ok(picked.shape);
    }

    /** Same node and same picked sub-shape (a vertex: same point) — picking twice adds nothing. */
    private isDuplicate(picked: VisualShapeData): boolean {
        const nodeId = picked.owner.node.id;
        return this.selectedDatas.some((data) => {
            const previous = data.shapes[0];
            if (previous.owner.node.id !== nodeId) return false;
            if (previous.shape.shapeType !== picked.shape.shapeType) return false;
            return picked.shape.shapeType === ShapeTypes.vertex
                ? (previous.shape as IVertex).point().isEqualTo((picked.shape as IVertex).point())
                : previous.shape.isEqual(picked.shape);
        });
    }

    private async selectSection() {
        this.controller = new AsyncController();
        const step = new SelectShapeStep(
            (ShapeTypes.vertex | ShapeTypes.wire | ShapeTypes.edge | ShapeTypes.face) as ShapeType,
            "prompt.select.section",
            // A click accepts a section and completes the pick; the viewport bar's confirm
            // is what ends the section list (it resolves with nothing selected).
            { showConfirmControl: true },
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
