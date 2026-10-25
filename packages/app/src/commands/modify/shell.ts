// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    command,
    debounce,
    EditableShapeNode,
    type I18nKeys,
    type IFace,
    type JoinType,
    MultistepCommand,
    PubSub,
    property,
    retargetInstanceSources,
    SELECTED_FACE_STATE,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";

@command({
    key: "modify.shell",
    icon: "icon-shell",
})
export class ShellCommand extends MultistepCommand {
    private tempVisual?: number;

    @property("option.command.joinType", {
        combobox: Combobox.from(["option.command.joinType.arc", "option.command.joinType.intersection"]),
    })
    get joinType(): I18nKeys {
        return this.getPrivateValue("joinType", "option.command.joinType.arc");
    }
    set joinType(value: I18nKeys) {
        this.setProperty("joinType", value, this.redisplayTempShape);
    }

    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 1);
    }

    set thickness(value: number) {
        this.setProperty("thickness", value, this.redisplayTempShape);
    }

    /** Onshape's "Shell outward": the wall is added outside the boundary instead of carved out. */
    @property("option.command.outward")
    get outward() {
        return this.getPrivateValue("outward", false);
    }

    set outward(value: boolean) {
        this.setProperty("outward", value, this.redisplayTempShape);
    }

    protected override executeMainTask() {
        if (!(this.thickness > 0)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid thickness");
            return;
        }
        const faces = this.stepDatas.at(-1)!.shapes.map((x) => x.shape as IFace);
        if (faces.length === 0) {
            // The kernel answers an empty closing set with the shrunken solid rather than a
            // hollow body, so a shell with nothing open is refused up front.
            PubSub.default.pub("showToast", "error.default:{0}", "Select at least one face to open");
            return;
        }

        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const shellShape = this.getShellShape(faces);

            if (!shellShape.isOk) {
                PubSub.default.pub("displayError", shellShape.error);
                return;
            }

            const model = new EditableShapeNode({
                document: this.document,
                name: node.name,
                shape: shellShape,
                materialId: node.materialId,
            });
            model.transform = node.transform;

            (node.parent ?? this.document.modelManager.rootNode).add(model);
            retargetInstanceSources(this.document, node.id, model.id);
            node.parent?.remove(node);
            this.document.visual.update();
        });
    }

    private getShellShape(faces: IFace[]) {
        const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
        // The kernel's sign: negative carves the wall out of the input, positive stands it
        // outside. A shell is hollow by default, so `outward` flips the sign.
        const thickness = this.outward ? this.thickness : -this.thickness;
        // The offset mode and the intersection flag the kernel accepts change nothing on
        // this thick-solid path (measured: three modes × both flags, identical output on a
        // box, an L, a holed plate, a cylinder and a stepped block), so they are not exposed.
        return shapeFactory.makeThickSolidByJoin(node.shape.value, faces, thickness, this.mapJoinType());
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                shapeFilter: {
                    allow: (shape) => {
                        return (
                            shape.shapeType === ShapeTypes.solid ||
                            shape.shapeType === ShapeTypes.compound ||
                            shape.shapeType === ShapeTypes.compoundSolid
                        );
                    },
                },
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep(ShapeTypes.face, "prompt.select.openFaces", {
                multiple: true,
                // Translucent fill with the boundary outlined: an opaque selection hides the
                // preview and the faces behind the ones already picked.
                selectedState: SELECTED_FACE_STATE,
                // The opening is one body's: faces of another body picked now would be handed
                // to the kernel against the first one's shape.
                nodeFilter: {
                    allow: (node) => node === this.stepDatas.at(0)?.shapes.at(0)?.owner.node,
                },
                beforeSelection: () => {
                    this.addFirstSelectedState(VisualStates.faceTransparent);
                    this.document.selection.onShapeChanged.sub(this.onOpenFacesChanged);
                },
                afterSelection: () => {
                    this.removeFirstSelectedState(VisualStates.faceTransparent);
                    this.document.selection.onShapeChanged.remove(this.onOpenFacesChanged);
                    this.clearTempShape();
                },
            }),
        ];
    }

    private readonly onOpenFacesChanged = debounce(() => {
        this.redisplayTempShape();
    }, 20);

    private readonly redisplayTempShape = () => {
        const selected = this.document.selection.getSelectedShapes();
        this.clearTempShape();
        if (selected.length === 0) return;

        const shellShape = this.getShellShape(selected.map((x) => x.shape as IFace));
        // A preview the kernel refuses is simply not shown: the user is still picking, and a
        // toast per selection change would bury the picker.
        if (!shellShape.isOk) return;
        this.disposeStack.add(shellShape.value);

        // The kernel runs in the body's local space; the preview is drawn in world coordinates.
        const world = shellShape.value.transformedMul(this.stepDatas[0].shapes[0].transform);
        try {
            const { faces, edges } = world.mesh;
            if (faces === undefined) return;
            this.tempVisual = this.document.visual.context.displayMesh(
                [faces, edges].filter((x) => x !== undefined),
            );
        } finally {
            world.dispose();
        }

        this.document.visual.update();
    };

    private clearTempShape() {
        if (this.tempVisual === undefined) return;
        this.document.visual.context.removeMesh(this.tempVisual);
        this.tempVisual = undefined;
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
