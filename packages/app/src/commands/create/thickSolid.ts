// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    I18n,
    type IFace,
    type IShape,
    type IStep,
    MultistepCommand,
    PreviewVisual,
    PubSub,
    property,
    SELECTED_FACE_STATE,
    SelectShapeStep,
    type ShapeMeshData,
    ShapeTypes,
    Transaction,
    thickenFaces,
    type VisualShapeData,
} from "@chili3d/core";

@command({
    key: "create.thickSolid",
    icon: "icon-thickSolid",
})
export class ThickSolidCommand extends MultistepCommand {
    private readonly preview = new PreviewVisual();
    /** Only a running command has an application to preview into. */
    private previewActive = false;

    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 10);
    }
    set thickness(value: number) {
        this.setProperty("thickness", value, () => this.refreshPreview());
    }

    /** How far the solid also reaches to the far side; ignored while midplane is on. */
    @property("option.command.thickness2", {
        dependencies: [{ property: "midplane", value: false }],
    })
    get thickness2() {
        return this.getPrivateValue("thickness2", 0);
    }
    set thickness2(value: number) {
        this.setProperty("thickness2", value, () => this.refreshPreview());
    }

    /** Onshape's Midplane: the thickness straddles the faces instead of standing off them. */
    @property("option.command.symmetric")
    get midplane() {
        return this.getPrivateValue("midplane", false);
    }
    set midplane(value: boolean) {
        this.setProperty("midplane", value, () => this.refreshPreview());
    }

    /** Onshape's Opposite Direction: which side of the faces the material goes. */
    @property("option.command.oppositeDirection")
    get oppositeDirection() {
        return this.getPrivateValue("oppositeDirection", false);
    }
    set oppositeDirection(value: boolean) {
        this.setProperty("oppositeDirection", value, () => this.refreshPreview());
    }

    protected override async executeAsync(): Promise<void> {
        this.previewActive = true;
        this.document.selection.onShapeChanged.sub(this.updatePreview);
        try {
            await super.executeAsync();
        } finally {
            this.document.selection.onShapeChanged.remove(this.updatePreview);
            this.removePreview();
            this.previewActive = false;
        }
    }

    protected override executeMainTask(): void {
        const plan = this.plan();
        const faces = this.pickedFaces();
        if (plan === undefined || faces.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid thickness");
            return;
        }

        // The node's shape lives in its own local space and the new node inherits its
        // transform; building in world coordinates here and then handing over the transform
        // as well would apply it twice.
        const local = faces.map((x) => x.shape as IFace);
        const thickened = thickenFaces(local, plan);
        if (!thickened.isOk) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return;
        }

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = faces[0].owner.node;
            const model = new EditableShapeNode({
                document: this.document,
                name: I18n.translate("command.create.thickSolid"),
                shape: thickened.value,
            });
            model.transform = node.transform;
            node.parent!.insertAfter(node, model);
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.face, "prompt.select.faces", {
                multiple: true,
                // Translucent fill with the boundary outlined: an opaque selection hides the
                // preview and the faces behind the ones already picked.
                selectedState: SELECTED_FACE_STATE,
                // The thickened solid belongs to one body. The pick has one step, so
                // `stepDatas` is still empty while it runs — the live selection is what
                // names the body the first face came from.
                nodeFilter: {
                    allow: (node) => {
                        const first = this.document.selection
                            .getSelectedShapes()
                            .find((x) => x.shape.shapeType === ShapeTypes.face)?.owner.node;
                        return first === undefined || node === first;
                    },
                },
            }),
        ];
    }

    // ------------------------------------------------------------------ Preview

    private readonly refreshPreview = () => {
        if (!this.previewActive) return;
        this.updatePreview();
    };

    /**
     * Shows the thickened solid built by the same kernel call the commit makes. The source body
     * is ghosted while it is up: the new material is what the user is deciding on. A preview
     * that cannot be built simply shows nothing.
     */
    private readonly updatePreview = () => {
        const plan = this.plan();
        const picked = this.pickedFaces();
        if (plan === undefined || picked.length === 0) return;

        // Group and thicken in the body's own space (copies would break edge identity, see
        // `connectedFaceGroups`), then place the result for display.
        const local = picked.map((x) => x.shape as IFace);
        const tool = thickenFaces(local, plan);
        if (!tool.isOk) return;
        const world = tool.value.transformedMul(picked[0].transform);
        tool.value.dispose();
        try {
            const meshes = meshed(world);
            this.preview.show(this.document, meshes, { ghost: [picked[0].owner], opacity: 1 });
        } finally {
            world.dispose();
        }
    };

    private removePreview() {
        this.preview.hide(this.document);
    }

    // ------------------------------------------------------------------ Geometry

    /** The signed thicknesses, one per direction; midplane splits the value across both. */
    private plan(): number[] | undefined {
        const thickness = this.thickness;
        if (!Number.isFinite(thickness) || !(thickness > 0)) return undefined;
        const sign = this.oppositeDirection ? -1 : 1;
        // Midplane ignores thickness2, and its row is hidden while it is on — validating a
        // value the user cannot see (or edit) would block the commit for no visible reason.
        if (this.midplane) return [(thickness / 2) * sign, (-thickness / 2) * sign];
        const thickness2 = this.thickness2;
        if (!Number.isFinite(thickness2) || thickness2 < 0) return undefined;
        return thickness2 === 0 ? [thickness * sign] : [thickness * sign, -thickness2 * sign];
    }

    /** The faces being picked: the live selection while the pick is up, its result afterwards. */
    private pickedFaces(): VisualShapeData[] {
        const shapes = this.stepDatas[0]?.shapes ?? this.document.selection.getSelectedShapes();
        return shapes.filter((x) => x.shape.shapeType === ShapeTypes.face);
    }
}

/** A solid's own mesh — what the preview draws. Disposing the shape is the caller's job. */
function meshed(tool: IShape): ShapeMeshData[] {
    const { faces, edges } = tool.mesh;
    if (faces === undefined) return [];
    return edges === undefined ? [faces] : [faces, edges];
}
