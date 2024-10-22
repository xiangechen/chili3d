// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "./document";
import { HistoryObservable, Id } from "./foundation";
import { Property } from "./property";
import { Serializer } from "./serialize";

@Serializer.register(["document", "name", "color", "id"])
export class Material extends HistoryObservable {
    @Serializer.serialze()
    readonly id: string;

    @Serializer.serialze()
    @Property.define("common.name")
    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @Serializer.serialze()
    @Property.define("common.color", { type: "color" })
    get color(): number {
        return this.getPrivateValue("color");
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    @Serializer.serialze()
    @Property.define("common.opacity")
    get opacity(): number {
        return this.getPrivateValue("opacity", 1);
    }
    set opacity(value: number) {
        this.setProperty("opacity", value);
    }

    @Serializer.serialze()
    @Property.define("material.texture")
    get texture() {
        return this.getPrivateValue("texture", "");
    }
    set texture(value: string) {
        this.setProperty("texture", value);
    }

    @Serializer.serialze()
    @Property.define("common.angle")
    get angle(): number {
        return this.getPrivateValue("angle", 0);
    }
    set angle(value: number) {
        this.setProperty("angle", value);
    }

    @Serializer.serialze()
    @Property.define("material.repeatU")
    get repeatU(): number {
        return this.getPrivateValue("repeatU", 1);
    }
    set repeatU(value: number) {
        this.setProperty("repeatU", value);
    }

    @Serializer.serialze()
    @Property.define("material.repeatV")
    get repeatV(): number {
        return this.getPrivateValue("repeatV", 1);
    }
    set repeatV(value: number) {
        this.setProperty("repeatV", value);
    }

    constructor(document: IDocument, name: string, color: number, id: string = Id.generate()) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name);
        this.setPrivateValue("color", color);
    }

    clone(): Material {
        let material = new Material(this.document, `${this.name} clone`, this.color);
        material.setPrivateValue("texture", this.texture);
        material.setPrivateValue("angle", this.angle);
        material.setPrivateValue("repeatU", this.repeatU);
        material.setPrivateValue("repeatV", this.repeatV);

        return material;
    }
}
