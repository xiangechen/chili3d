// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IBody } from "../body";
import { IDocument } from "../document";
import { IEditor } from "../editor";
import { PubSub } from "../pubsub";
import { ModelObject } from "./modelObject";
import { IShape } from "../geometry";
import { Result } from "../result";
import { Logger } from "../logger";

export class Model extends ModelObject {
    private readonly _editors: IEditor[];
    private _shape: Result<IShape>;

    constructor(name: string, id: string, readonly body: IBody) {
        super(id, name);
        this.body = body;
        this._editors = new Array<IEditor>();
        this._shape = this.generate();
        body.onUpdate(this.onUpdate);
    }

    override setDocument(document?: IDocument | undefined): void {
        super.setDocument(document);
        this.body?.setDocument(document);
    }

    private onUpdate = () => {
        this.generate();
    };

    generate(): Result<IShape> {
        this._shape = this.body.body;
        if (this._shape.isErr()) {
            Logger.error(`Body of ${this.name} is null: ${this._shape.err}`);
            return this._shape;
        }
        for (const editor of this._editors) {
            this._shape = editor.edit(this._shape.value!);
            if (this._shape.isErr()) break;
        }
        PubSub.default.pub("modelUpdate", this);
        return this._shape;
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
        if (this._shape.isOk()) this._shape = editor.edit(this._shape.value!);
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
