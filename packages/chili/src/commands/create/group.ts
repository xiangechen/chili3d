// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { button, div, input, label, XYZConverter } from "chili-controls";
import {
    AsyncController,
    Binding,
    command,
    Component,
    ComponentNode,
    DialogResult,
    IApplication,
    ICommand,
    IDocument,
    Localize,
    Observable,
    PubSub,
    Transaction,
    VisualNode,
    XYZ,
} from "chili-core";
import { GetOrSelectNodeStep, IStep, PointStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

class GroupDefinition extends Observable {
    get name() {
        return this.getPrivateValue("name", "unnamed");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    get insert() {
        return this.getPrivateValue("insert", XYZ.zero);
    }
    set insert(value: XYZ) {
        this.setProperty("insert", value);
    }

    get convertInstance() {
        return this.getPrivateValue("convertInstance", true);
    }
    set convertInstance(value: boolean) {
        this.setProperty("convertInstance", value);
    }
}

@command({
    key: "create.group",
    icon: "icon-group",
})
export class GroupCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.shape", { multiple: true })];
    }

    protected override executeMainTask(): void {
        const nodes = this.stepDatas[0].nodes?.filter((node) => node instanceof VisualNode);
        if (!nodes || nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        let definition = new GroupDefinition();

        PubSub.default.pub("showDialog", "command.create.group", this.dialog(definition), (r) => {
            if (r === DialogResult.ok) this.createGroup(definition, nodes);
        });
    }

    private createGroup(definition: GroupDefinition, nodes: VisualNode[]) {
        Transaction.execute(this.document, "create group", () => {
            for (const node of nodes) {
                const worldTransform = node.worldTransform();
                node.parent?.transfer(node);
                node.transform = worldTransform;
            }

            const component = new Component(definition.name, this.stepDatas[0].nodes!, definition.insert);
            this.document.components.push(component);

            if (definition.convertInstance) {
                const group = new ComponentNode(
                    this.document,
                    definition.name,
                    component.id,
                    component.origin,
                );
                this.document.rootNode.add(group);
            }
        });
    }

    private readonly pickInsertPoint = async (definition: GroupDefinition, e: MouseEvent) => {
        const dialog = this.findDialog(e.target as HTMLElement);
        if (!dialog) return;
        dialog.close();

        const command = new PickInsertPointCommand(this.document, definition);
        try {
            if (this.document.application.executingCommand) {
                throw new Error("Command is executing");
            }
            this.document.application.executingCommand = command;
            await command.execute(this.document.application);
        } finally {
            dialog.showModal();
            this.document.application.executingCommand = undefined;
        }
    };

    private readonly findDialog = (e: HTMLElement): HTMLDialogElement | undefined => {
        if (e instanceof HTMLDialogElement) return e;
        if (!e.parentElement) return undefined;

        return this.findDialog(e.parentElement);
    };

    private dialog(definition: GroupDefinition) {
        return div(
            {
                style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                },
            },
            label(
                {
                    textContent: new Localize("common.name"),
                },
                ": ",
            ),
            input({
                value: new Binding(definition, "name"),
                onkeydown: (e) => {
                    e.stopPropagation();
                },
                onblur: (e) => {
                    definition.name = (e.target as HTMLInputElement).value;
                },
            }),
            label(
                {
                    textContent: new Localize("option.command.insertPoint"),
                },
                ": ",
            ),
            div(
                {
                    style: {
                        display: "inline-flex",
                        flexDirection: "row",
                        padding: "10px",
                        backgroundColor: "#eee",
                        borderRadius: "5px",
                        gap: "6px",
                    },
                },
                input({
                    value: new Binding(definition, "insert", new XYZConverter()),
                    onkeydown: (e) => {
                        e.stopPropagation();
                    },
                }),
                button({
                    textContent: new Localize("option.command.insertPoint"),
                    onclick: (e) => this.pickInsertPoint(definition, e),
                }),
            ),
            div(
                input({
                    type: "checkbox",
                    id: "instanceID",
                    checked: new Binding(definition, "convertInstance"),
                    onchange: (e) => {
                        definition.convertInstance = (e.target as HTMLInputElement).checked;
                    },
                }),
                " ",
                label({
                    textContent: new Localize("option.command.isConvertInstance"),
                    htmlFor: "instanceID",
                }),
            ),
        );
    }
}

class PickInsertPointCommand implements ICommand {
    constructor(
        readonly document: IDocument,
        readonly defination: GroupDefinition,
    ) {}

    async execute(application: IApplication): Promise<void> {
        const pickPointStep = new PointStep("option.command.insertPoint");
        const controller = new AsyncController();
        const result = await pickPointStep.execute(this.document, controller);

        if (result?.point) {
            this.defination.insert = result.point;
        }
    }
}
