// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody, IEditedResult, IEditor, IModel, IShape } from "chili-geo";
import { IDocument } from "../interfaces";
import { ModelBase } from "./modelBase";

export class Model extends ModelBase implements IModel {
    private readonly _body: IBody;
    private readonly _editors: IEditor[];
    private _shape?: IShape;
    private _status: IEditedResult;

    constructor(document: IDocument, name: string, id: string, body: IBody) {
        super(document, id, name);
        this._body = body;

        this._editors = new Array<IEditor>();
        this._status = { success: false };
        this.generate();

        document.addModel(this);
    }

    generate(): boolean {
        this._shape = this._body?.body();
        if (this._shape === undefined) {
            this.status = { success: false };
            return false;
        }
        for (const editor of this._editors) {
            this.status = editor.edit(this._shape!);
            this._shape = editor.shape();
            if (!this._status.success) {
                return false;
            }
        }
        this.status = { success: true };
        return true;
    }

    get status(): IEditedResult {
        return this._status;
    }

    set status(status: IEditedResult) {
        this.setProperty("status", status);
    }

    get body() {
        return this._body;
    }

    getShape(): IShape | undefined {
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
        if (this._shape !== undefined) this.status = editor.edit(this._shape);
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
