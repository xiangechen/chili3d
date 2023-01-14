// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IEditor, IModel, IShape } from "chili-geo";
import { Result } from "chili-shared";
import { ModelBase } from "./modelBase";

export class Model extends ModelBase implements IModel {
    private readonly _editors: IEditor[];
    private _shape: Result<IShape>;

    constructor(name: string, id: string, readonly body: IBody) {
        super(id, name);
        this.body = body;
        this._editors = new Array<IEditor>();
        this._shape = this.generate();
    }

    generate(): Result<IShape> {
        let shape = this.body.body();
        if (shape.isErr()) return shape;
        for (const editor of this._editors) {
            shape = editor.edit(shape.ok()!);
            if (shape.isErr()) break;
        }
        return shape;
    }

    getShape(): Result<IShape> {
        return this._shape;
    }

    removeEditor(editor: IEditor) {
        const index = this._editors.indexOf(editor, 0);
        if (index > -1) {
            this._editors.splice(index, 1);
            this.generate();
        }
    }

    addEditor(editor: IEditor) {
        this._editors.push(editor);
        if (this._shape.isOk()) this._shape = editor.edit(this._shape.ok()!);
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

    protected handlePositionChanged() {
        this.generate();
    }

    protected handleRotateChanged() {
        this.generate();
    }
}
