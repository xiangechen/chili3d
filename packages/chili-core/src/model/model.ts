// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { property } from "../decorators";
import { IDocument } from "../document";
import { Quaternion, Transform, XYZ } from "../math";
import { IModel, IModelGroup, INode, Node } from "./node";
import { ICompound, IShape } from "../geometry";
import { Id } from "../id";
import { Feature } from "./feature";
import { Entity } from "./entity";
import { Logger, PubSub, Result } from "../base";

export abstract class Model<T extends IShape = IShape> extends Node implements IModel<T> {
    private _translation: XYZ;
    private _rotation: Quaternion;
    private _scale: XYZ;
    protected _shape: T | undefined;

    constructor(document: IDocument, name: string, readonly body: Entity, id: string = Id.new()) {
        super(document, name, id);
        this._translation = XYZ.zero;
        this._scale = XYZ.one;
        this._rotation = new Quaternion(0, 0, 0, 0);
    }

    shape(): T | undefined {
        return this._shape;
    }

    transform(): Transform {
        return Transform.compose(this._translation, this._rotation, this._scale);
    }

    @property("model.translation")
    get translation() {
        return this._translation;
    }

    set translation(value: XYZ) {
        this.setProperty("translation", value, () => this._shape?.setTranslation(value));
    }

    @property("model.rotation")
    get rotation() {
        return this._rotation;
    }

    set rotation(value: Quaternion) {
        this.setProperty("rotation", value, () => this._shape?.setRotation(value));
    }

    @property("model.scale")
    get scale() {
        return this._scale;
    }

    set scale(value: XYZ) {
        this.setProperty("scale", value);
    }
}

export class GeometryModel extends Model {
    private readonly _editors: Feature[] = [];
    private _error: string | undefined;

    static create(document: IDocument, name: string, body: Entity) {
        let model = new GeometryModel(document, name, body);
        document.nodes.add(model);
        let node = document.currentNode ?? document.rootNode;
        if (INode.isCollectionNode(node)) {
            node.add(model);
        } else {
            node.parent?.add(model);
        }
        return model;
    }

    constructor(document: IDocument, name: string, body: Entity, id: string = Id.new()) {
        super(document, name, body, id);
        this.generate();
        this.update();
        body.onShapeChanged(this.onShapeChanged);
    }

    private onShapeChanged = (entity: Entity) => {
        if (entity === this.body) {
            this.generate();
        } else {
            let editor = entity as Feature;
            let i = this._editors.indexOf(editor);
            this.applyFeatures(i);
        }
        this.update();
    };

    generate() {
        if (!this.body.generate()) {
            Logger.error(`Body of ${this.name} is null: ${this.body.shape.err}`);
            return;
        }
        this._shape = this.body.shape.value;
        this.applyFeatures(0);
    }

    protected onVisibleChanged(): void {
        PubSub.default.pub("visibleChanged", this);
    }

    protected onParentVisibleChanged(): void {
        PubSub.default.pub("parentVisibleChanged", this);
    }

    private update() {
        PubSub.default.pub("modelUpdate", this);
    }

    private applyFeatures(startIndex: number) {
        if (this._editors.length === 0 || startIndex < 0) return;
        let shape: Result<IShape>;
        if (startIndex >= this._editors.length) {
            shape = this._editors.at(-1)!.shape;
        } else {
            shape = startIndex === 0 ? this.body.shape : this._editors[startIndex - 1].shape;
        }
        this.setShape(shape);

        if (this._shape === undefined) return;
        for (let i = startIndex; i < this._editors.length; i++) {
            this._editors[i].origin = this._shape;
            this._editors[i].generate();
            if (this._editors[i].shape.isErr()) {
                this._error = this._editors[i].shape.err;
                return;
            }
            this._shape = this._editors[i].shape.value;
        }
    }

    private setShape(shape: Result<IShape>) {
        this._shape = shape.value;
        this._error = shape.err;
    }

    error() {
        return this._error;
    }

    removeEditor(editor: Feature) {
        const index = this._editors.indexOf(editor, 0);
        if (index > -1) {
            this._editors.splice(index, 1);
            editor.removeShapeChanged(this.onShapeChanged);
            this.applyFeatures(index);
            this.update();
        }
    }

    addEditor(editor: Feature) {
        if (this._editors.indexOf(editor) > -1) return;
        this._editors.push(editor);
        editor.onShapeChanged(this.onShapeChanged);
        if (this._shape !== undefined) {
            editor.origin = this._shape;
            editor.generate();
            this._error = editor.shape.err;
            if (this._error === undefined) {
                this._shape = editor.shape.value;
            }
            this.update();
        }
    }

    getEditor(index: number) {
        if (index < this._editors.length) {
            return this._editors[index];
        }
        return undefined;
    }

    editors() {
        return [...this._editors];
    }

    protected handleTransformChanged() {
        // this.generate();
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
}
