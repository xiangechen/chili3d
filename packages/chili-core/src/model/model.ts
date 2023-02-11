// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { HistoryRecord } from "../history";
import { Logger } from "../logger";
import { PubSub } from "../pubsub";
import { Result } from "../result";
import { Entity } from "./entity";
import { Editor } from "./editor";
import { ModelObject } from "./modelObject";
import { IUpdateHandler } from "./updateHandler";

export class Model extends ModelObject {
    private readonly _editors: Editor[] = [];
    private _shape: Result<IShape>;

    constructor(name: string, id: string, readonly body: Entity) {
        super(id, name);
        this.body = body;
        this._shape = this.generate();
        body.updateHandler = this.updateHandler;
    }

    private updateHandler = (updater: IUpdateHandler) => {
        if (updater === this.body) {
            this.generate();
        } else {
            let editor = updater as Editor;
            let i = this._editors.indexOf(editor);
            this.applyFeatures(i);
        }
    };

    override setHistoryHandler(handler: ((record: HistoryRecord) => void) | undefined) {
        this._historyHandler = handler;
        this.body.setHistoryHandler(handler);
        this._editors.forEach((x) => x.setHistoryHandler(handler));
    }

    generate(): Result<IShape> {
        if (!this.body.generate()) {
            Logger.error(`Body of ${this.name} is null: ${this._shape.err}`);
            return this._shape;
        }
        this._shape = this.body.shape;
        if (!this.applyFeatures(0)) return this._shape;
        PubSub.default.pub("modelUpdate", this);
        return this._shape;
    }

    private applyFeatures(startIndex: number): boolean {
        if (startIndex >= this._editors.length) return false;
        this._shape = startIndex === 0 ? this.body.shape! : this._editors[startIndex - 1].shape;
        for (let i = startIndex; i < this._editors.length; i++) {
            this._editors[i].origin = this._shape.value;
            this._shape = this._editors[i].generate();
            if (this._shape.isErr()) return false;
        }
        return true;
    }

    getShape(): Result<IShape> {
        return this._shape;
    }

    removeEditor(editor: Editor) {
        const index = this._editors.indexOf(editor, 0);
        if (index > -1) {
            this._editors.splice(index, 1);
            this.generate();
            editor.setHistoryHandler(undefined);
        }
    }

    addEditor(editor: Editor) {
        if (this._editors.indexOf(editor) > -1) return;
        editor.setHistoryHandler(this._historyHandler);
        this._editors.push(editor);
        if (this._shape.isOk()) {
            editor.origin = this._shape.value;
            this._shape = editor.generate();
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

    protected handlePositionChanged() {
        this.generate();
    }

    protected handleRotateChanged() {
        this.generate();
    }
}
