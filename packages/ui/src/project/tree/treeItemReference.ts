// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode } from "@chili3d/core";
import { TreeItem } from "./treeItem";
import style from "./treeItemGroup.module.css";

/**
 * Mirror row of a node referenced by a parametric body's features (e.g. a sketch).
 * The real node keeps its own row elsewhere in the tree — this one selects and
 * double-click-edits it through the shared tree handlers, but cannot be dragged.
 */
export class TreeItemReference extends TreeItem {
    constructor(document: IDocument, node: INode) {
        super(document, node);
        this.draggable = false;
        this.append(this.name, this.visibleIcon, this.warningBadge);
        this.classList.add(style.reference);
    }

    mainElement(): HTMLElement {
        return this;
    }
}

customElements.define("tree-reference", TreeItemReference);
