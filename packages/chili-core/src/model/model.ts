// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger, Result, Serializer } from "../base";
import { IDocument } from "../document";
import { ICompound, IShape } from "../geometry";
import { Id } from "../id";
import { Matrix4 } from "../math";
import { Body } from "./body";
import { Entity } from "./entity";
import { Feature } from "./feature";
import { IModel, IModelGroup, Node } from "./node";

export abstract class Model<T extends IShape = IShape> extends Node implements IModel {
    @Serializer.property("constructor")
    readonly body: Body;

    protected _shape: T | undefined;

    shape(): T | undefined {
        return this._shape;
    }

    protected _matrix: Matrix4 = Matrix4.identity();

    @Serializer.property()
    get matrix(): Matrix4 {
        return this._matrix;
    }

    set matrix(value: Matrix4) {
        this.setProperty(
            "matrix",
            value,
            () => {
                this._shape?.setMatrix(value);
            },
            {
                equals: (left, right) => left.equals(right),
            }
        );
    }

    constructor(document: IDocument, name: string, body: Body, id: string = Id.new()) {
        super(document, name, id);
        this.body = body;
    }
}

export class GeometryModel extends Model {
    private readonly _features: Feature[] = [];

    private _error: string | undefined;
    error() {
        return this._error;
    }

    constructor(document: IDocument, name: string, body: Body, id: string = Id.new()) {
        super(document, name, body, id);
        this.drawShape();
        body.onShapeChanged(this.onShapeChanged);
    }

    @Serializer.deserializer()
    static from({
        document,
        name,
        body,
        id,
    }: {
        document: IDocument;
        name: string;
        body: Body;
        id?: string;
    }) {
        return new GeometryModel(document, name, body, id ?? Id.new());
    }

    private onShapeChanged = (entity: Entity) => {
        if (entity === this.body) {
            this.drawShape();
        } else {
            let editor = entity as Feature;
            let i = this._features.indexOf(editor);
            this.applyFeatures(i);
        }
        this.redrawModel();
    };

    drawShape() {
        if (!this.body.generate()) {
            Logger.error(`Body of ${this.name} is null: ${this.body.shape.error}`);
            return;
        }
        this._shape = this.body.shape.value;
        this.applyFeatures(0);
    }

    protected onVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    protected onParentVisibleChanged(): void {
        this.document.visual.context.setVisible(this, this.visible && this.parentVisible);
    }

    private redrawModel() {
        this.document.visual.context.redrawModel([this]);
        Logger.debug(`model ${this.name} redraw`);
    }

    private applyFeatures(startIndex: number) {
        if (startIndex < 0) return;
        for (let i = startIndex; i < this._features.length; i++) {
            this._features[i].generate();
            if (this._features[i].shape.hasError()) {
                this._error = this._features[i].shape.error;
                return;
            }
            this._shape = this._features[i].shape.value;
        }
        this._shape?.setMatrix(this._matrix);
    }

    removeFeature(feature: Feature) {
        const index = this._features.indexOf(feature, 0);
        if (index > -1) {
            this._features.splice(index, 1);
            feature.removeShapeChanged(this.onShapeChanged);
            this._features[index].origin =
                index === 0 ? this.body.shape.value : this._features[index - 1].shape.value;
            this.applyFeatures(index);
            this.redrawModel();
        }
    }

    addFeature(feature: Feature) {
        if (this._features.indexOf(feature) > -1) return;
        this._features.push(feature);
        feature.onShapeChanged(this.onShapeChanged);
        if (this._shape !== undefined) {
            feature.origin = this._shape;
            this.applyFeatures(this._features.length - 1);
            this.redrawModel();
        }
    }

    getFeature(index: number) {
        if (index < this._features.length) {
            return this._features[index];
        }
        return undefined;
    }

    features() {
        return [...this._features];
    }
}

export class ModelGroup extends Model<ICompound> implements IModelGroup {
    private readonly _children: IModel[] = [];

    get children(): ReadonlyArray<IModel> {
        return this._children;
    }

    protected onVisibleChanged(): void {
        this._children.forEach((x) => (x.parentVisible = this.visible && this.parentVisible));
    }

    protected onParentVisibleChanged(): void {
        this._children.forEach((x) => (x.parentVisible = this.visible && this.parentVisible));
    }

    override clone(): this {
        // todo
        return this;
    }
}
