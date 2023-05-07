// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    ICollectionNode,
    IDocument,
    IHistory,
    INode,
    INodeCollection,
    ISelection,
    IVisualization,
    PropertyChangedHandler,
} from "chili-core";
import { ThreeVisulization } from "../src/threeVisualization";

export class TestDocument implements IDocument {
    name: string;
    currentNode?: INode | undefined;
    id: string;
    history: IHistory;
    selection: ISelection;
    visualization: ThreeVisulization;
    nodes: INodeCollection;
    rootNode: ICollectionNode;
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
        this.visualization = new ThreeVisulization(this);
        this.history = {} as any;
        this.selection = {} as any;
        this.nodes = {} as any;
        this.rootNode = {} as any;
    }
}
