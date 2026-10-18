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
    type OffsetMode,
    PubSub,
    property,
    retargetInstanceSources,
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

    @property("option.command.offsetMode", {
        combobox: Combobox.from([
            "option.command.offsetMode.skin",
            "option.command.offsetMode.pipe",
            "option.command.offsetMode.rectoVerso",
        ]),
    })
    get offsetMode(): I18nKeys {
        return this.getPrivateValue("offsetMode", "option.command.offsetMode.skin");
    }
    set offsetMode(value: I18nKeys) {
        this.setProperty("offsetMode", value, this.redisplayTempShape);
    }

    @property("option.command.intersection")
    get intersection() {
        return this.getPrivateValue("intersection", false);
    }
    set intersection(value: boolean) {
        this.setProperty("intersection", value, this.redisplayTempShape);
    }

    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 1);
    }

    set thickness(value: number) {
        this.setProperty("thickness", value, this.redisplayTempShape);
    }

    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.stepDatas[0].shapes[0].owner.node as ShapeNode;
            const faces = this.stepDatas.at(-1)!.shapes.map((x) => x.shape as IFace);
            const shellShape = this.getShellShape(faces);

            if (!shellShape.isOk) {
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
        return shapeFactory.makeThickSolidByJoin(
            node.shape.value,
            faces,
            this.thickness,
            this.mapJoinType(),
            this.mapOffsetMode(),
            this.intersection,
        );
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
                beforeSelection: () => {
                    this.addFirstSelectedState(VisualStates.faceTransparent);
                    this.document.selection.onShapeChanged.sub(this.onOpenFacesChanged);
                },
                afterSelection: () => {
                    this.removeFirstSelectedState(VisualStates.faceTransparent);
                    this.document.selection.onShapeChanged.remove(this.onOpenFacesChanged);
                    if (this.tempVisual) {
                        this.document.visual.context.removeMesh(this.tempVisual);
                        this.tempVisual = undefined;
                    }
                    const nodeVisual = this.stepDatas.at(0)?.shapes.at(0)?.owner;
                    if (nodeVisual) {
                        nodeVisual.visible = true;
                    }
                },
            }),
        ];
    }

    private readonly onOpenFacesChanged = debounce(() => {
        this.redisplayTempShape();
    }, 20);

    private readonly redisplayTempShape = () => {
        const selected = this.document.selection.getSelectedShapes();
        if (this.tempVisual) {
            this.document.visual.context.removeMesh(this.tempVisual);
            this.tempVisual = undefined;
        }
        const nodeVisual = this.stepDatas.at(0)?.shapes.at(0)?.owner;
        if (!nodeVisual) return;
        if (selected.length === 0) {
            nodeVisual.visible = true;
            return;
        }

        const shellShape = this.getShellShape(selected.map((x) => x.shape as IFace));
        if (!shellShape.isOk) {
            nodeVisual.visible = true;
            PubSub.default.pub("showToast", "error.default:{0}", "shell failed");
            return;
        }
        this.disposeStack.add(shellShape.value);
        nodeVisual.visible = false;
        this.tempVisual = this.document.visual.context.displayMesh(
            [shellShape.value.mesh.faces!, shellShape.value.mesh.edges!].filter((x) => x !== undefined),
        );

        this.document.visual.update();
    };

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

    readonly mapOffsetMode = (): OffsetMode => {
        switch (this.offsetMode) {
            case "option.command.offsetMode.skin":
                return "skin";
            case "option.command.offsetMode.pipe":
                return "pipe";
            case "option.command.offsetMode.rectoVerso":
                return "rectoVerso";
            default:
                throw new Error("Unknow offsetMode");
        }
    };
}
