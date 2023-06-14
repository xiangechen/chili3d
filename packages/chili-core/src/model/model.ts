// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger, Result, Serialize } from "../base";
import { IDocument } from "../document";
import { ICompound, IShape } from "../geometry";
import { Id } from "../id";
import { Matrix4 } from "../math";
import { Entity } from "./entity";
import { Feature } from "./feature";
import { IModel, IModelGroup, Node } from "./node";
import { Body } from "./body";

export abstract class Model<T extends IShape = IShape> extends Node implements IModel {
    @Serialize.enable()
    readonly body: Body;

    protected _shape: T | undefined;

    shape(): T | undefined {
        return this._shape;
    }

    protected _matrix: Matrix4 = Matrix4.identity();

    @Serialize.enable()
    get matrix(): Matrix4 {
        return this._matrix;
    }

    set matrix(value: Matrix4) {
        this.setProperty(
            "matrix",
            value,
            () => {
                this._shape?.setMatrix(value);
                this.body.setMatrix(value);
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
    private readonly _editors: Feature[] = [];

    private _error: string | undefined;
    error() {
        return this._error;
    }

    constructor(document: IDocument, name: string, body: Body, id: string = Id.new()) {
        super(document, name, body, id);
        this.generate();
        body.onShapeChanged(this.onShapeChanged);
    }

    @Serialize.deserialize()
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
            this.generate();
        } else {
            let editor = entity as Feature;
            let i = this._editors.indexOf(editor);
            this.applyFeatures(i);
        }
        this.redraw();
    };

    generate() {
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

    private redraw() {
        this.document.visual.context.redrawModel([this]);
        Logger.debug(`model ${this.name} redraw`);
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
            if (this._editors[i].shape.hasError()) {
                this._error = this._editors[i].shape.error;
                return;
            }
            this._shape = this._editors[i].shape.value;
        }
    }

    private setShape(shape: Result<IShape>) {
        this._shape = shape.value;
        this._error = shape.error;
    }

    removeEditor(editor: Feature) {
        const index = this._editors.indexOf(editor, 0);
        if (index > -1) {
            this._editors.splice(index, 1);
            editor.removeShapeChanged(this.onShapeChanged);
            this.applyFeatures(index);
            this.redraw();
        }
    }

    addEditor(editor: Feature) {
        if (this._editors.indexOf(editor) > -1) return;
        this._editors.push(editor);
        editor.onShapeChanged(this.onShapeChanged);
        if (this._shape !== undefined) {
            editor.origin = this._shape;
            editor.generate();
            this._error = editor.shape.error;
            if (this._error === undefined) {
                this._shape = editor.shape.value;
            }
            this.redraw();
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

    protected handleTransformChanged() {}
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
