// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { Color, Colors, Logger } from "../foundation";
import { Id } from "../foundation/id";
import { ICompound, IShape } from "../geometry";
import { Matrix4 } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { Body } from "./body";
import { Entity } from "./entity";
import { Feature } from "./feature";
import { IModel, IModelGroup, Node } from "./node";

export abstract class Model<T extends IShape = IShape> extends Node implements IModel {
    @Serializer.serialze()
    readonly body: Body;

    protected _shape: T | undefined;

    shape(): T | undefined {
        return this._shape;
    }

    protected _matrix: Matrix4 = Matrix4.identity();

    @Serializer.serialze()
    get matrix(): Matrix4 {
        return this._matrix;
    }

    set matrix(value: Matrix4) {
        this.setProperty(
            "matrix",
            value,
            () => {
                if (this._shape) {
                    this._shape.matrix = value;
                }
            },
            {
                equals: (left, right) => left.equals(right),
            },
        );
    }

    private _color: Color = Colors.Gray;

    @Serializer.serialze()
    @Property.define("common.color")
    get color() {
        return this._color;
    }
    set color(value: Color) {
        this.setProperty("color", value);
    }

    private _opacity: number = 1;

    @Serializer.serialze()
    @Property.define("common.opacity")
    get opacity() {
        return this._opacity;
    }
    set opacity(value: number) {
        this.setProperty("opacity", value);
    }

    constructor(document: IDocument, name: string, body: Body, id: string = Id.new()) {
        super(document, name, id);
        this.body = body;
    }
}

@Serializer.register("GeometryModel", ["document", "name", "body", "id"])
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
        this._shape = this.body.shape.getValue();
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
            let shape = this._features[i].shape;
            if (!shape.success) {
                this._error = shape.error;
                return;
            }
            this._shape = shape.value;
        }
        if (this._shape) {
            this._shape.matrix = this._matrix;
        }
    }

    removeFeature(feature: Feature) {
        const index = this._features.indexOf(feature, 0);
        if (index > -1) {
            this._features.splice(index, 1);
            feature.removeShapeChanged(this.onShapeChanged);
            this._features[index].origin =
                index === 0 ? this.body.shape.unwrap() : this._features[index - 1].shape.unwrap(); // todo
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
