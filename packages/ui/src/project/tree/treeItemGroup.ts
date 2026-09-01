// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { FolderNode, type IDocument, type INodeLinkedList, isFeatureListNode } from "@chili3d/core";
import { div, setSVGIcon, svg } from "@chili3d/element";
import { TreeItem } from "./treeItem";
import style from "./treeItemGroup.module.css";
import { TreeItemReference } from "./treeItemReference";

export class TreeGroup extends TreeItem {
    private _isExpanded = true;
    readonly header: HTMLElement;
    readonly items: HTMLDivElement = div({ className: `${style.container} ${style.left16px}` });
    readonly expanderIcon: SVGSVGElement;
    /** Mirror rows of nodes referenced by a feature list (e.g. sketches), before real children. */
    private readonly refItems: HTMLDivElement | undefined;
    private referenceRows: TreeItemReference[] = [];

    constructor(document: IDocument, node: INodeLinkedList) {
        super(document, node);
        // A parametric body is a linked list of consumed boolean tools, not a folder —
        // give its expander a distinct, muted look.
        const expanderClass =
            node instanceof FolderNode
                ? style.expanderIcon
                : `${style.expanderIcon} ${style.toolExpanderIcon}`;
        this.expanderIcon = svg({
            icon: this.getExpanderIcon(),
            className: expanderClass,
            onclick: this.handleExpanderClick,
        });
        this.header = div(
            { className: `${style.row} ${style.header}` },
            this.expanderIcon,
            this.name,
            this.visibleIcon,
        );
        if (isFeatureListNode(node) && node.referencedNodes !== undefined) {
            this.refItems = div({ className: `${style.container} ${style.left16px}` });
        }
        super.append(
            div(
                { className: style.container },
                this.header,
                ...(this.refItems ? [this.refItems] : []),
                this.items,
            ),
        );
        this.refreshReferences();
        this.refreshExpander();
    }

    /** Folders always show the expander; a body shows it only with tools or references inside. */
    refreshExpander() {
        const hide =
            !(this.node instanceof FolderNode) &&
            (this.node as INodeLinkedList).firstChild === undefined &&
            this.referenceRows.length === 0;
        this.expanderIcon.classList.toggle(style.hide, hide);
    }

    /** Rebuilds the reference rows when the referenced node id list changed. */
    refreshReferences() {
        if (this.refItems === undefined) return;
        const node = this.node;
        const refs = isFeatureListNode(node) ? (node.referencedNodes?.() ?? []) : [];
        const current = this.referenceRows.map((row) => row.node.id);
        if (refs.length === current.length && refs.every((ref, i) => ref.id === current[i])) return;

        this.referenceRows.forEach((row) => row.dispose());
        this.referenceRows = refs.map((ref) => new TreeItemReference(this.document, ref));
        this.refItems.replaceChildren(...this.referenceRows);
        this.refItems.classList.toggle(style.hide, !this._isExpanded);
        this.refreshExpander();
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.node.onPropertyChanged(this.handleReferencesChanged);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.node.removePropertyChanged(this.handleReferencesChanged);
    }

    // Feature edits (add/remove/re-reference) surface as property changes on the body.
    private readonly handleReferencesChanged = () => this.refreshReferences();

    get isExpanded(): boolean {
        return this._isExpanded;
    }

    set isExpanded(value: boolean) {
        this._isExpanded = value;
        setSVGIcon(this.expanderIcon, this.getExpanderIcon());
        this.items.classList.toggle(style.hide, !this._isExpanded);
        this.refItems?.classList.toggle(style.hide, !this._isExpanded);
    }

    mainElement(): HTMLElement {
        return this.header;
    }

    override dispose() {
        super.dispose();
        this.referenceRows.forEach((row) => row.dispose());
        this.referenceRows = [];
        this.header.remove();
        this.expanderIcon.removeEventListener("click", this.handleExpanderClick);
    }

    private readonly handleExpanderClick = (e: MouseEvent) => {
        e.stopPropagation();
        this.isExpanded = !this._isExpanded;
    };

    private getExpanderIcon() {
        return this._isExpanded ? "icon-angle-down" : "icon-angle-right";
    }

    override appendChild<T extends Node>(node: T): T {
        this.items.appendChild(node);
        return node;
    }

    override append(...nodes: Node[]): void {
        this.items.append(...nodes);
    }

    override removeChild<T extends Node>(child: T): T {
        if (child.parentNode === this.items) this.items.removeChild(child);
        return child;
    }

    addItem(...items: Node[]) {
        this.items.append(...items);
        return this;
    }

    insertAfter(item: TreeItem, child: TreeItem | null): void {
        const referenceNode = child ? child.nextSibling : this.items.firstChild;
        this.items.insertBefore(item, referenceNode);
    }
}

customElements.define("tree-group", TreeGroup);
