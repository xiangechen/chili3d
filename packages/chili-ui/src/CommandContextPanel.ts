import { div } from "chili-controls";
import { ICommand, PubSub } from "chili-core";
import { CommandContext } from "./ribbon/commandContext";
import style from "./ribbon/ribbon.module.css";

export class CommandContextPanel extends HTMLElement {
    private readonly _panel = div({ className: style.commandContextPanel });
    private commandContext?: CommandContext;

    constructor() {
        super();
        this.append(this._panel);
    }

    connectedCallback(): void {
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
    }

    private readonly openContext = (command: ICommand) => {
        if (this.commandContext) {
            this.closeContext();
        }
        this.commandContext = new CommandContext(command);
        this._panel.append(this.commandContext);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._panel.innerHTML = "";
    };
}

customElements.define("command-context-panel", CommandContextPanel);
