// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, PubSub } from "../base";
import { property } from "../decorators";
import { Quaternion, Transform, XYZ } from "../math";
import { GeometryModel } from "./geometryModel";
import { GroupModel } from "./groupModel";

export abstract class Model extends HistoryObservable {
    private _name: string;
    private _position: XYZ;
    private _rotation: Quaternion;
    private _scale: XYZ;
    private _visible: boolean;
    private _parent: GroupModel | undefined;
    readonly createdTime: number;

    constructor(name: string, readonly id: string) {
        super();
        this._name = name;
        this._visible = true;
        this._position = XYZ.zero;
        this._scale = XYZ.one;
        this._rotation = new Quaternion(0, 0, 0, 0);
        this.createdTime = Date.now();
    }

    @property("name")
    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    transform(): Transform {
        return Transform.compose(this._position, this._rotation, this._scale);
    }

    @property("model.position")
    get position() {
        return this._position;
    }

    set position(value: XYZ) {
        this.setProperty("position", value, () => {
            this.handleTransformChanged();
        });
    }

    @property("model.rotation")
    get rotation() {
        return this._rotation;
    }

    set rotation(value: Quaternion) {
        this.setProperty("rotation", value, () => {
            this.handleTransformChanged();
        });
    }

    @property("model.scale")
    get scale() {
        return this._scale;
    }

    set scale(value: XYZ) {
        this.setProperty("scale", value, () => {
            this.handleTransformChanged();
        });
    }

    get visible() {
        return this._visible;
    }

    set visible(value: boolean) {
        if (this.setProperty("visible", value)) {
            PubSub.default.pub("visibleChanged", this);
        }
    }

    get parent() {
        return this._parent;
    }

    set parent(value: GroupModel | undefined) {
        if (this._parent === value) return;
        this._parent?.removeChild(this);
        value?.addChild(this);
        let oldParent = this._parent;
        this.setProperty("parent", value);
        PubSub.default.pub("parentChanged", this, oldParent, value);
    }

    protected abstract handleTransformChanged(): void;
}

export namespace Model {
    export function isGroup(model: Model): model is GroupModel {
        return (model as GroupModel).children !== undefined;
    }
    export function isGeometry(model: Model): model is GeometryModel {
        return (model as GeometryModel).body !== undefined;
    }
}
