// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Binding,
    FolderNode,
    I18n,
    type IDocument,
    type INode,
    isNodeWarning,
    Transaction,
} from "@chili3d/core";
import { label, setSVGIcon, span, svg } from "@chili3d/element";
import style from "./treeItem.module.css";

export abstract class TreeItem extends HTMLElement {
    readonly name: HTMLLabelElement;
    readonly visibleIcon: SVGSVGElement;
    /**
     * SolidWorks-FeatureManager-style warning mark, shown while the node reports
     * warnings through the `INodeWarning` contract (e.g. a sketch whose external
     * references lost their source); its tooltip carries the count. Rows place it
     * after the eye icon.
     */
    readonly warningBadge: HTMLElement;

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
        this.warningBadge = span({
            className: `${style.warning} ${style.hidden}`,
            textContent: "!",
        });
        this.setVisibleStyle(node.parentVisible);
        this.refreshVisibleIcon();
        this.refreshWarningBadge();
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

    private readonly onPropertyChanged = (property: string, model: INode) => {
        if (property === "visible") {
            setSVGIcon(this.visibleIcon, this.getVisibleIcon());
        } else if (property === "parentVisible") {
            this.setVisibleStyle(model.parentVisible);
        } else if (property === "warningCount") {
            this.refreshWarningBadge();
        }
    };

    /** Syncs the badge with the node's `INodeWarning` state; plain nodes keep it hidden. */
    private refreshWarningBadge() {
        const node = this.node;
        const warning = isNodeWarning(node) ? node : undefined;
        const count = warning?.warningCount ?? 0;
        this.warningBadge.classList.toggle(style.hidden, count === 0);
        if (warning !== undefined && count > 0) {
            I18n.set(this.warningBadge, "title", warning.warningTooltip, count);
        }
    }

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
