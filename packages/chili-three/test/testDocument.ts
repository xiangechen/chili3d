// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    History,
    IDocument,
    INode,
    INodeLinkedList,
    ISelection,
    IView,
    PropertyChangedHandler,
} from "chili-core";
import { ThreeVisual } from "../src/threeVisual";

export class TestDocument implements IDocument {
    name: string;
    currentNode: INodeLinkedList | undefined;
    id: string;
    history: History;
    selection: ISelection;
    visual: ThreeVisual;
    rootNode: INodeLinkedList;
    activeView: IView | undefined;
    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void {
        throw new Error("Method not implemented.");
    }
    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void {
        throw new Error("Method not implemented.");
    }
    dispose(): void | Promise<void> {
        throw new Error("Method not implemented.");
    }

    constructor() {
        this.name = "test";
        this.id = "test";
        this.visual = new ThreeVisual(this);
        this.history = {} as any;
        this.selection = {} as any;
        this.rootNode = {} as any;
    }
    addNode(...nodes: INode[]): void {
        throw new Error("Method not implemented.");
    }
    save() {}
}
