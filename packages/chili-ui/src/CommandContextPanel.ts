import { div } from "chili-controls";
import { ICommand, PubSub } from "chili-core";
import { CommandContext } from "./ribbon/commandContext";
import style from "./ribbon/ribbon.module.css";

export class CommandContextPanel extends HTMLElement {
    private readonly _panel = div({
        className: style.commandContextOverlay + " " + style.commandContextOverlayHidden,
    });
    private commandContext?: CommandContext;
    private _visible = false;

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
        this.setVisible(true);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._panel.innerHTML = "";
        this.setVisible(false);
    };

    private setVisible(visible: boolean) {
        this._visible = visible;
        if (visible) {
            this._panel.className = style.commandContextOverlay;
        } else {
            this._panel.className = style.commandContextOverlay + " " + style.commandContextOverlayHidden;
        }
    }
}

customElements.define("command-context-panel", CommandContextPanel);
