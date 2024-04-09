// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { Id } from "../foundation";
import { Serializer } from "../serialize";
import { GeometryEntity } from "./geometryEntity";
import { IModel, IModelGroup, Node } from "./node";

export abstract class Model extends Node implements IModel {
    @Serializer.serialze()
    readonly geometry: GeometryEntity;

    constructor(document: IDocument, name: string, body: GeometryEntity, id: string = Id.generate()) {
        super(document, name, id);
        this.geometry = body;
    }
}

@Serializer.register("GeometryModel", ["document", "name", "geometry", "id"])
export class GeometryModel extends Model {
    constructor(document: IDocument, name: string, geometry: GeometryEntity, id: string = Id.generate()) {
        super(document, name, geometry, id);
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }
}

export class ModelGroup extends Model implements IModelGroup {
    private readonly _children: IModel[] = [];

    get children(): ReadonlyArray<IModel> {
        return this._children;
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    override clone(): this {
        // todo
        return this;
    }
}
