// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, PubSub } from "../base";
import { property } from "../decorators";
import { Quaternion, Transform, XYZ } from "../math";
import { GeometryModel } from "./geometryModel";
import { GroupModel } from "./groupModel";

export abstract class Model extends HistoryObservable {
    private _name: string;
    private _transform: Transform;
    private _translation: XYZ;
    private _rotation: Quaternion;
    private _scaling: XYZ;
    private _visible: boolean;
    private _parent: GroupModel | undefined;
    readonly createdTime: number;

    constructor(name: string, readonly id: string) {
        super();
        this._name = name;
        this._visible = true;
        this._translation = XYZ.zero;
        this._scaling = XYZ.one;
        this._rotation = new Quaternion(0, 0, 0, 0);
        this._transform = this.composeTransform();
        this.createdTime = Date.now();
    }

    @property("name")
    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    get transform(): Transform {
        return this._transform;
    }

    private composeTransform() {
        return Transform.compose(this._translation, this._rotation, this._scaling);
    }

    @property("model.location")
    get translation() {
        return this._translation;
    }

    set translation(value: XYZ) {
        this.setProperty("translation", value, () => {
            this._transform = this._transform.translation(value);
            this.handleTransformChanged();
        });
    }

    @property("model.rotate")
    get rotation() {
        return this._rotation;
    }

    set rotation(value: Quaternion) {
        this.setProperty("rotation", value, () => {
            this._transform = this.composeTransform();
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
