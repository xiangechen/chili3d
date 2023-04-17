// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, ICommand, IDocument, INode, NodeLinkedList } from "chili-core";

let index: number = 1;

@command({
    name: "NewFolder",
    display: "command.newFolder",
    icon: "icon-folder-plus",
})
export class NewFolder implements ICommand {
    async excute(document: IDocument): Promise<void> {
        let folder = new NodeLinkedList(document, `Folder${index++}`);
        document.nodes.add(folder);
        let node = document.currentNode ?? document.rootNode;
        if (INode.isCollectionNode(node)) {
            node.add(folder);
        } else {
            node.parent?.add(folder);
        }
    }
}
