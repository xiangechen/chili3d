// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModelObject } from "chili-geo";
import { i18n, ObservableBase, Quaternion, XYZ, XYZConverter } from "chili-shared";
import { parameter } from "chili-core";
import { IDocument } from "../interfaces";
import { PubSub } from "../pubsub";

export abstract class ModelBase extends ObservableBase {
    private _name: string;
    private _position: XYZ;
    private _rotate: Quaternion;
    private _visible: boolean;
    private _parentId: string | undefined;
    readonly createdTime: number;

    constructor(readonly document: IDocument, readonly id: string, name: string) {
        super();
        this._name = name;
        this._visible = true;
        this._position = XYZ.zero;
        this._rotate = { x: 0, y: 0, z: 0, w: 1 };
        this.createdTime = Date.now();
    }

    @parameter("category.default", "name")
    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    @parameter("category.default", "body.position")
    get position() {
        return this._position;
    }

    set position(value: XYZ) {
        if (this.setProperty("position", value)) this.handlePositionChanged();
    }

    @parameter("category.default", "body.rotate")
    get rotate() {
        return this._rotate;
    }

    set rotate(value: Quaternion) {
        if (this.setProperty("rotate", value)) this.handleRotateChanged();
    }

    @parameter("category.default", "body.visible")
    get visible() {
        return this._visible;
    }

    set visible(value: boolean) {
        if (this.setProperty("visible", value)) {
            let shape = this.document.visualization.context.getShape(this);
            if (shape === undefined || shape.visible === value) return;
            shape.visible = value;
        }
    }

    getParent() {
        if (this._parentId === undefined) return undefined;
        return this.document.getModel(this._parentId);
    }

    get parentId() {
        return this._parentId;
    }

    set parentId(value: string | undefined) {
        let oldParent = this._parentId;
        if (this.setProperty("parentId", value)) {
            PubSub.default.pub("parentChanged", this, oldParent, value);
        }
    }

    protected abstract handlePositionChanged(): void;
    protected abstract handleRotateChanged(): void;
}
