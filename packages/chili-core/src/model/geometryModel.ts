// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { HistoryRecord } from "../history";
import { Id } from "../id";
import { Logger } from "../logger";
import { PubSub } from "../pubsub";
import { Result } from "../result";
import { Entity } from "./entity";
import { Feature } from "./feature";
import { Model } from "./model";
import { IUpdater } from "./updater";

export class GeometryModel extends Model {
    private readonly _editors: Feature[] = [];
    private _shape: IShape | undefined;
    private _error: string | undefined;

    constructor(name: string, readonly body: Entity, id: string = Id.new()) {
        super(name, id);
        this.body = body;
        this.generate();
        body.updater = this.updateHandler;
        this.update();
    }

    private updateHandler = (updater: IUpdater) => {
        if (updater === this.body) {
            this.generate();
        } else {
            let editor = updater as Feature;
            let i = this._editors.indexOf(editor);
            this.applyFeatures(i);
        }
        this.update();
    };

    override setHistoryHandler(handler: ((record: HistoryRecord) => void) | undefined) {
        this._historyHandler = handler;
        this.body.setHistoryHandler(handler);
        this._editors.forEach((x) => x.setHistoryHandler(handler));
    }

    generate() {
        if (!this.body.generate()) {
            Logger.error(`Body of ${this.name} is null: ${this.body.shape.err}`);
            return;
        }
        this._shape = this.body.shape.value;
        this.applyFeatures(0);
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

    shape(): IShape | undefined {
        return this._shape;
    }

    error() {
        return this._error;
    }

    removeEditor(editor: Feature) {
        const index = this._editors.indexOf(editor, 0);
        if (index > -1) {
            this._editors.splice(index, 1);
            this.applyFeatures(index);
            editor.setHistoryHandler(undefined);
            this.update();
        }
    }

    addEditor(editor: Feature) {
        if (this._editors.indexOf(editor) > -1) return;
        editor.setHistoryHandler(this._historyHandler);
        this._editors.push(editor);
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

    protected handlePositionChanged() {
        this.generate();
    }

    protected handleRotateChanged() {
        this.generate();
    }
}
