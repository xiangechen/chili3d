// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { HistoryObservable, PubSub } from "../base";
import { property } from "../decorators";
import { Quaternion, Transform, XYZ } from "../math";
import { GeometryModel } from "./geometryModel";
import { GroupModel } from "./groupModel";

export abstract class Model extends HistoryObservable {
    private _name: string;
    protected _transform: Transform;
    private _visible: boolean;
    private _parent: GroupModel | undefined;
    readonly createdTime: number;

    constructor(name: string, readonly id: string) {
        super();
        this._name = name;
        this._visible = true;
        this._transform = Transform.identity();
        this.createdTime = Date.now();
    }

    @property("name")
    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    get transform() {
        return this._transform;
    }

    set transform(transform: Transform) {
        if (this.setProperty("transform", transform)) this.handleTransformChanged();
    }

    @property("model.location")
    get location() {
        return this._transform.getTranslation();
    }

    set location(value: XYZ) {
        let vector = value.sub(this.location);
        if (vector.isEqualTo(XYZ.zero)) return;
        let transform = Transform.translationTransform(vector.x, vector.y, vector.z);
        this.transform = this._transform.multiply(transform);
    }

    @property("model.rotate")
    get rotate() {
        return this._transform.getRotation();
    }

    set rotate(value: Quaternion) {
        // todo
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
