// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    Binding,
    Component,
    ComponentNode,
    command,
    GetOrSelectNodeStep,
    type IApplication,
    type ICommand,
    type IDocument,
    type INode,
    type IStep,
    isConsumedTool,
    isInstanceNode,
    Localize,
    MultistepCommand,
    NodeUtils,
    Observable,
    PointStep,
    PubSub,
    Transaction,
    VisualNode,
    XYZ,
} from "@chili3d/core";
import { button, div, input, label, XYZConverter } from "@chili3d/element";

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
        return [
            new GetOrSelectNodeStep("prompt.select.shape", {
                multiple: true,
                filter: { allow: (node: INode) => this.canGroup(node) },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const selected = this.stepDatas[0].nodes?.filter((node) => node instanceof VisualNode) ?? [];
        const nodes = selected.filter((node) => this.canGroup(node));
        if (nodes.length < selected.length) {
            PubSub.default.pub("showToast", "toast.instance.groupUnsupported");
        }
        if (nodes.length === 0) {
            if (selected.length === 0) PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        const definition = new GroupDefinition();

        PubSub.default.pub("showDialog", "command.create.group", this.dialog(definition), () => {
            this.createGroup(definition, nodes);
        });
    }

    /**
     * A Component freezes one merged mesh. An instance inside it never follows its source,
     * and grouping a source freezes ITS display while the instances keep reading the live
     * node — both are refused for the same reason Array falls back for instances.
     */
    private canGroup(node: INode): boolean {
        if (isConsumedTool(node)) return false;
        const subtree = NodeUtils.isLinkedListNode(node) ? [node, ...NodeUtils.children(node)] : [node];
        if (subtree.some((x) => isInstanceNode(x))) return false;
        // A consumed tool is resolved from the root tree by feature evaluation. Grouped
        // into a Component definition it would no longer be found on the next rebuild.
        if (subtree.some((x) => isConsumedTool(x))) return false;
        const sources = this.instanceSources();
        return !subtree.some((x) => sources.has(x.id));
    }

    /** The document scan runs once per pick session, not once per hovered candidate. */
    private instanceSources(): Set<string> {
        this._instanceSources ??= new Set(
            this.document.modelManager.findNodesDeep(isInstanceNode).map((x) => x.sourceId),
        );
        return this._instanceSources;
    }

    private _instanceSources?: Set<string>;

    private createGroup(definition: GroupDefinition, nodes: VisualNode[]) {
        Transaction.execute(this.document, "create group", () => {
            for (const node of nodes) {
                // The nodes become a frozen Component definition merged into one mesh.
                // A parametric body contributes identity here (its moves are features),
                // and grouping is not an edit of its definition.
                const worldTransform = node.worldTransform();
                node.parent?.transfer(node);
                node.transform = worldTransform;
            }

            const component = new Component({
                name: definition.name,
                nodes,
                origin: definition.insert,
            });
            this.document.modelManager.components.push(component);

            if (definition.convertInstance) {
                const group = new ComponentNode({
                    document: this.document,
                    name: definition.name,
                    componentId: component.id,
                    insert: component.origin,
                });
                this.document.modelManager.rootNode.add(group);
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
                        borderRadius: "5px",
                        border: "1px solid var(--border-color)",
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
