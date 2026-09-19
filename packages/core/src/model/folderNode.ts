// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import { serializable } from "../serialize";
import { NodeChildList } from "./childList";
import { type INode, type INodeLinkedList, Node } from "./node";

export interface FolderNodeOptions {
    document: IDocument;
    name: string;
    id?: string;
}

@serializable()
export class FolderNode extends Node implements INodeLinkedList {
    /** `INodeIcon`: the folder glyph, so a group reads apart from the shapes it holds. */
    get icon(): string {
        return "icon-folder";
    }

    private readonly _children: NodeChildList = new NodeChildList(
        this,
        () => this.visible && this.parentVisible,
    );

    get firstChild() {
        return this._children.firstChild;
    }
    get lastChild() {
        return this._children.lastChild;
    }
    get count() {
        return this._children.count;
    }
    size(): number {
        return this._children.count;
    }

    constructor(options: FolderNodeOptions) {
        super(options.document, options.name, options.id ?? Id.generate());
    }

    add(...items: INode[]): void {
        this._children.add(...items);
    }

    remove(...items: INode[]): void {
        this._children.remove(...items);
    }

    transfer(...items: INode[]): void {
        this._children.transfer(...items);
    }

    insertBefore(target: INode | undefined, node: INode): void {
        this._children.insertBefore(target, node);
    }

    insertAfter(target: INode | undefined, node: INode): void {
        this._children.insertAfter(target, node);
    }

    move(child: INode, newParent: FolderNode, previousSibling?: INode): void {
        this._children.move(child, newParent, previousSibling);
    }

    children(): INode[] {
        return this._children.children();
    }

    override disposeInternal(): void {
        this._children.dispose();
        super.disposeInternal();
    }

    protected onVisibleChanged() {
        this._children.setChildrenParentVisible();
    }

    protected onParentVisibleChanged() {
        this._children.setChildrenParentVisible();
    }
}

/**
 * True for children of a non-folder parent — consumed boolean tools owned by a
 * parametric body. They are hidden from the scene and edited through the owning
 * body's feature list, so copy/move/delete must not treat them as free nodes.
 */
export function isConsumedTool(node: INode): boolean {
    return node.parent !== undefined && !(node.parent instanceof FolderNode);
}
