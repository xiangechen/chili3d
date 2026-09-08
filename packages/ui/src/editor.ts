// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ChatPanel, createChatPanel } from "@chili3d/ai";
import {
    type IApplication,
    type ICommand,
    type IDocument,
    type Material,
    PubSub,
    type Ribbon,
} from "@chili3d/core";
import { div } from "@chili3d/element";
import style from "./editor.module.css";
import { FloatPanel } from "./floatPanel";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { RibbonUI } from "./ribbon";
import { CommandContext } from "./ribbon/commandContext";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

export class Editor extends HTMLElement {
    private readonly _viewportContainer: HTMLDivElement;
    private readonly _commandContextContainer = div({});
    private _contentEl: HTMLDivElement | null = null;
    private commandContext?: CommandContext;
    private chatDock?: HTMLElement;
    private chatPanel?: ChatPanel;
    private floatingChat?: FloatPanel;
    private _sidebarWidth: number = 360;
    private _chatWidth: number = 320;
    private _isResizingSidebar: boolean = false;
    private _sidebarEl: HTMLDivElement | null = null;

    constructor(
        readonly app: IApplication,
        readonly ribbonContent: Ribbon,
    ) {
        super();
        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this._viewportContainer = div({ className: style.viewportContainer }, viewport);
        this.render();
        this.showChat();
    }

    private render() {
        this._sidebarEl = div(
            {
                className: style.sidebar,
                style: `width: ${this._sidebarWidth}px;`,
            },
            new ProjectView({ className: style.sidebarItem }),
            new PropertyView({ className: style.sidebarItem }),
            div({
                className: style.sidebarResizer,
                onpointerdown: (e: PointerEvent) => this._startSidebarResize(e),
            }),
        );
        this._contentEl = div({ className: style.content }, this._sidebarEl, this._viewportContainer);
        this.append(
            div(
                { className: style.root },
                new RibbonUI(this.app, this.ribbonContent),
                this._contentEl,
                new Statusbar(style.statusbar),
            ),
        );
        this.app.mainWindow?.appendChild(this);
    }

    private ensureChatPanel(): ChatPanel {
        if (this.chatPanel) return this.chatPanel;
        const chat = createChatPanel();
        chat.onClose = () => this.hideChat();
        chat.onDock = () => this.dockChat();
        this.attachDragToDetach(chat.header);
        this.chatPanel = chat;
        return chat;
    }

    private showChat() {
        if (this.chatDock || this.floatingChat) return;
        const chat = this.ensureChatPanel();
        chat.setFloating(false);

        const resizer = div({
            className: style.chatResizer,
            onpointerdown: (e: PointerEvent) => this._startChatResize(e),
        });
        this.chatDock = div({ className: style.rightPanel }, resizer, chat);
        this.chatDock.style.width = `${this._chatWidth}px`;
        this._contentEl?.append(this.chatDock);
    }

    private hideChat() {
        this.chatDock?.remove();
        this.chatDock = undefined;
        this.closeFloatingChat();
    }

    private closeFloatingChat() {
        if (this.floatingChat) {
            this.floatingChat.remove();
            this.floatingChat.dispose();
            this.floatingChat = undefined;
        }
    }

    private readonly toggleChat = () => {
        if (this.chatDock || this.floatingChat) {
            this.hideChat();
        } else {
            this.showChat();
        }
    };

    private attachDragToDetach(header: HTMLElement) {
        header.addEventListener("pointerdown", (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest("button")) return;
            const startX = e.clientX;
            const startY = e.clientY;
            this.trackPointerDrag((ev, stop) => {
                if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 6) {
                    this.detachChat(ev.clientX, ev.clientY);
                    stop();
                }
            });
        });
    }

    private trackPointerDrag(onMove: (ev: PointerEvent, stop: () => void) => void, onEnd?: () => void) {
        const onUp = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onUp);
            onEnd?.();
        };
        const move = (ev: PointerEvent) => onMove(ev, onUp);
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
    }

    private detachChat(mouseX: number, mouseY: number) {
        const chat = this.chatPanel;
        if (!chat || !this.chatDock) return;
        this.chatDock?.remove();
        this.chatDock = undefined;
        chat.setFloating(true);

        this.floatingChat = new FloatPanel({
            title: "ai.title",
            content: chat,
            actions: chat.floatingActions(),
            width: 380,
            height: 520,
            x: Math.max(0, mouseX - 190),
            y: Math.max(0, mouseY - 16),
            onClose: () => {
                this.floatingChat = undefined;
            },
        });
        this.app.mainWindow?.appendChild(this.floatingChat);
    }

    private dockChat() {
        this.closeFloatingChat();
        this.showChat();
    }

    private _startChatResize(e: PointerEvent) {
        e.preventDefault();
        const dock = this.chatDock;
        if (!dock) return;
        const rect = dock.getBoundingClientRect();
        if (this.app.mainWindow) this.app.mainWindow.style.cursor = "ew-resize";
        this.trackPointerDrag(
            (ev) => {
                const minWidth = 220;
                const maxWidth = Math.floor(window.innerWidth * 0.6);
                this._chatWidth = Math.max(minWidth, Math.min(maxWidth, rect.right - ev.clientX));
                dock.style.width = `${this._chatWidth}px`;
            },
            () => {
                if (this.app.mainWindow) this.app.mainWindow.style.cursor = "";
            },
        );
    }

    private _startSidebarResize(e: PointerEvent) {
        e.preventDefault();
        this._isResizingSidebar = true;
        if (this.app.mainWindow) this.app.mainWindow.style.cursor = "ew-resize";
        this.trackPointerDrag(
            (ev) => {
                if (!this._isResizingSidebar) return;
                if (!this._sidebarEl) return;
                const sidebarRect = this._sidebarEl.getBoundingClientRect();
                let newWidth = ev.clientX - sidebarRect.left;
                const minWidth = 75;
                const maxWidth = Math.floor(window.innerWidth * 0.85);
                newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
                this._sidebarWidth = newWidth;
                this._sidebarEl.style.width = `${newWidth}px`;
            },
            () => {
                this._isResizingSidebar = false;
                if (this.app.mainWindow) this.app.mainWindow.style.cursor = "";
            },
        );
    }

    connectedCallback(): void {
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
        PubSub.default.sub("toggleChatPanel", this.toggleChat);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
        PubSub.default.remove("toggleChatPanel", this.toggleChat);
        this.chatDock?.remove();
        this.chatDock = undefined;
        this.closeFloatingChat();
    }

    private readonly openContext = (command: ICommand) => {
        if (this.commandContext) {
            this.closeContext();
        }
        this.commandContext = new CommandContext(command);
        this._commandContextContainer.append(this.commandContext);
        this._viewportContainer.append(this._commandContextContainer);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._commandContextContainer.innerHTML = "";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        const context = new MaterialDataContent(document, callback, editingMaterial);
        this._viewportContainer.append(new MaterialEditor(context));
    };
}

customElements.define("chili-editor", Editor);
