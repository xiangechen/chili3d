import { command, Component, ComponentNode, Transaction } from "chili-core";
import { GetOrSelectNodeStep, IStep } from "../../step";
import { MultistepCommand } from "../multistepCommand";

@command({
    name: "create.group",
    display: "command.group",
    icon: "icon-group",
})
export class GroupCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [new GetOrSelectNodeStep("prompt.select.shape", { multiple: true })];
    }
    protected override executeMainTask(): void {
        Transaction.execute(this.document, "create group", () => {
            const component = new Component("group", this.stepDatas[0].nodes!);
            this.document.components.push(component);

            const group = new ComponentNode(this.document, "group", component.id, component.origin);
            this.document.addNode(group);

            for (const node of component.nodes) {
                node.parent?.remove(node);
            }
        });
    }
}
