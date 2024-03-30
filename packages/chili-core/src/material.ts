// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "./document";
import { HistoryObservable, Id } from "./foundation";
import { Property } from "./property";
import { Serializer } from "./serialize";

@Serializer.register("Material", ["document", "name", "color", "id"])
export class Material extends HistoryObservable {
    @Serializer.serialze()
    readonly id: string;

    private _name: string;
    @Serializer.serialze()
    @Property.define("common.name")
    get name(): string {
        return this._name;
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    private _color: number;
    @Serializer.serialze()
    @Property.define("common.color", undefined, undefined, "color")
    get color(): number {
        return this._color;
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    private _opacity: number = 1;
    @Serializer.serialze()
    @Property.define("common.opacity")
    get opacity(): number {
        return this._opacity;
    }
    set opacity(value: number) {
        this.setProperty("opacity", value);
    }

    private _texture: string = "";
    @Serializer.serialze()
    @Property.define("material.texture")
    get texture() {
        return this._texture;
    }
    set texture(value: string) {
        this.setProperty("texture", value);
    }

    private _angle: number = 0;
    @Serializer.serialze()
    @Property.define("common.angle")
    get angle(): number {
        return this._angle;
    }
    set angle(value: number) {
        this.setProperty("angle", value);
    }

    private _repeatU: number = 1;
    @Serializer.serialze()
    @Property.define("material.repeatU")
    get repeatU(): number {
        return this._repeatU;
    }
    set repeatU(value: number) {
        this.setProperty("repeatU", value);
    }

    private _repeatV: number = 1;
    @Serializer.serialze()
    @Property.define("material.repeatV")
    get repeatV(): number {
        return this._repeatV;
    }
    set repeatV(value: number) {
        this.setProperty("repeatV", value);
    }

    constructor(document: IDocument, name: string, color: number, id: string = Id.generate()) {
        super(document);
        this.id = id;
        this._name = name;
        this._color = color;
    }

    clone(): Material {
        let material = new Material(this.document, `${this.name} clone`, this.color);
        material._texture = this._texture;
        material._angle = this._angle;
        material._repeatU = this._repeatU;
        material._repeatV = this._repeatV;

        return material;
    }
}
