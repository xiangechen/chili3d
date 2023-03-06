// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { FlolderEntry, Id, IDocument, IHistory, IModelManager, IViewer, IVisualization, Observable } from "chili-core";
import { IVisualizationFactory } from "chili-vis";
import { Application } from "./application";

import { History } from "./history";
import { ModelManager } from "./modelManager";
import { Viewer } from "./viewer";

export class Document extends Observable implements IDocument {
    private static readonly _documentMap: Map<string, IDocument> = new Map();

    readonly models: IModelManager;
    readonly viewer: IViewer;
    readonly visualization: IVisualization;
    readonly history: IHistory;
    readonly folder: FlolderEntry;

    private constructor(name: string, factory: IVisualizationFactory, readonly id: string = Id.new()) {
        super();
        this._name = name;
        this.models = new ModelManager(this);
        this.history = new History();
        this.viewer = new Viewer(this);
        this.folder = new FlolderEntry(undefined, "root");
        this.visualization = factory.create(this);
    }

    static create(name: string) {
        let doc = new Document(name, Application.instance.visualizationFactory);
        this.cacheDocument(doc);
        Application.instance.activeDocument = doc;
        return doc;
    }

    static get(id: string): IDocument | undefined {
        return this._documentMap.get(id);
    }

    private static cacheDocument(document: IDocument) {
        if (this._documentMap.has(document.id)) return;
        this._documentMap.set(document.id, document);
    }

    private _name: string;

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this.setProperty("name", name);
    }

    toJson() {
        return {
            id: this.id,
            name: this._name,
        };
    }

    static fromJson(data: any) {
        let document = new Document(data.name, data.id);
        // data.models.forEach(x => document.addModel(x))
        return document;
    }
}
