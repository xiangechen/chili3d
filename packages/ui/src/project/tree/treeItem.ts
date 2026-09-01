// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Binding, FolderNode, type IDocument, type INode, Transaction } from "@chili3d/core";
import { label, setSVGIcon, svg } from "@chili3d/element";
import style from "./treeItem.module.css";

export abstract class TreeItem extends HTMLElement {
    readonly name: HTMLLabelElement;
    readonly visibleIcon: SVGSVGElement;

    private _node: INode;
    get node() {
        return this._node;
    }

    constructor(
        protected document: IDocument,
        node: INode,
    ) {
        super();
        this._node = node;
        this.draggable = true;
        this.name = label({
            className: style.name,
            textContent: new Binding(node, "name"),
        });
        this.visibleIcon = svg({
            className: style.icon,
            icon: this.getVisibleIcon(),
            onclick: this.onVisibleIconClick,
        });
        this.setVisibleStyle(node.parentVisible);
        this.refreshVisibleIcon();
    }

    /**
     * Consumed boolean tools (children of a parametric body, not of a folder) never
     * render in the scene, so their eye icon would toggle a flag with no visual
     * effect — hide it. Called on construction and after every tree move.
     */
    refreshVisibleIcon() {
        const consumed = this.node.parent !== undefined && !(this.node.parent instanceof FolderNode);
        this.visibleIcon.classList.toggle(style.hidden, consumed);
    }

    connectedCallback(): void {
        this.node.onPropertyChanged(this.onPropertyChanged);
    }

    disconnectedCallback(): void {
        this.node.removePropertyChanged(this.onPropertyChanged);
    }

    private readonly onPropertyChanged = (property: keyof INode, model: INode) => {
        if (property === "visible") {
            setSVGIcon(this.visibleIcon, this.getVisibleIcon());
        } else if (property === "parentVisible") {
            this.setVisibleStyle(model[property]);
        }
    };

    private setVisibleStyle(parentVisible?: boolean) {
        if (parentVisible === true) {
            this.visibleIcon.classList.remove(style["parent-hidden"]);
        } else {
            this.visibleIcon.classList.add(style["parent-hidden"]);
        }
    }

    addStyle(style: string) {
        this.mainElement().classList.add(style);
    }

    removeStyle(style: string) {
        this.mainElement().classList.remove(style);
    }

    abstract mainElement(): HTMLElement;

    dispose() {
        this.remove();
        this.node.removePropertyChanged(this.onPropertyChanged);
        this.visibleIcon.removeEventListener("click", this.onVisibleIconClick);
        this.document = null as any;
        this._node = null as any;
    }

    private getVisibleIcon() {
        return this.node.visible ? "icon-eye" : "icon-eye-slash";
    }

    private readonly onVisibleIconClick = (e: MouseEvent) => {
        e.stopPropagation();
        Transaction.execute(this.document, "change visible", () => {
            this.node.visible = !this.node.visible;
        });
        this.document.visual.update();
    };
}
