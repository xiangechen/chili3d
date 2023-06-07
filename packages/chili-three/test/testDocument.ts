// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    ICollectionNode,
    IDocument,
    History,
    INode,
    INodeCollection,
    ISelection,
    IView,
    IVisual,
    PropertyChangedHandler,
} from "chili-core";
import { ThreeVisual } from "../src/threeVisual";

export class TestDocument implements IDocument {
    name: string;
    currentNode?: INode | undefined;
    id: string;
    history: History;
    selection: ISelection;
    visual: ThreeVisual;
    nodes: INodeCollection;
    rootNode: ICollectionNode;
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
        this.nodes = {} as any;
        this.rootNode = {} as any;
    }
}
