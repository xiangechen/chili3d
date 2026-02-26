// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "./document";
import { HistoryObservable, Id } from "./foundation";
import { XY } from "./math";
import { property } from "./property";
import { serializable, serialze } from "./serialize";

@serializable(["document"])
export class Texture extends HistoryObservable {
    @serialze()
    @property("material.texture.image")
    get image(): string {
        return this.getPrivateValue("image", "");
    }
    set image(value: string) {
        this.setProperty("image", value);
    }

    @serialze()
    get wrapS(): number {
        return this.getPrivateValue("wrapS", 1000);
    }
    set wrapS(value: number) {
        this.setProperty("wrapS", value);
    }

    @serialze()
    get wrapT(): number {
        return this.getPrivateValue("wrapT", 1000);
    }
    set wrapT(value: number) {
        this.setProperty("wrapT", value);
    }

    @serialze()
    @property("material.texture.rotation")
    get rotation(): number {
        return this.getPrivateValue("rotation", 0);
    }
    set rotation(value: number) {
        this.setProperty("rotation", value);
    }

    @serialze()
    @property("material.texture.offset")
    get offset(): XY {
        return this.getPrivateValue("offset", new XY(0, 0));
    }
    set offset(value: XY) {
        this.setProperty("offset", value);
    }

    @serialze()
    @property("material.texture.repeat")
    get repeat(): XY {
        return this.getPrivateValue("repeat", new XY(1, 1));
    }
    set repeat(value: XY) {
        this.setProperty("repeat", value);
    }

    @serialze()
    center: XY = new XY(0.5, 0.5);
}

@serializable(["document", "name", "color", "id"])
export class Material extends HistoryObservable {
    @serialze()
    vertexColors = false;

    @serialze()
    transparent = true;

    @serialze()
    readonly id: string;

    @serialze()
    @property("common.name")
    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @serialze()
    @property("common.color", { type: "color" })
    get color(): number | string {
        return this.getPrivateValue("color");
    }
    set color(value: number | string) {
        this.setProperty("color", value);
    }

    @serialze()
    @property("common.opacity")
    get opacity(): number {
        return this.getPrivateValue("opacity", 1);
    }
    set opacity(value: number) {
        this.setProperty("opacity", value);
    }

    @serialze()
    @property("material.map")
    get map(): Texture {
        return this.getPrivateValue("map", new Texture(this.document));
    }
    set map(value: Texture) {
        this.setProperty("map", value);
    }

    constructor(document: IDocument, name: string, color: number | string, id: string = Id.generate()) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name?.length > 0 ? name : "unnamed");
        this.setPrivateValue("color", color);
    }

    clone(): Material {
        const material = new Material(this.document, `${this.name} clone`, this.color);
        material.setPrivateValue("map", this.map);

        return material;
    }
}

@serializable(["document", "name", "color", "id"])
export class PhongMaterial extends Material {
    @serialze()
    @property("material.specular", { type: "color" })
    get specular(): number | string {
        return this.getPrivateValue("specular", 0x111111);
    }
    set specular(value: number | string) {
        this.setProperty("specular", value);
    }

    @serialze()
    @property("material.shininess")
    get shininess(): number {
        return this.getPrivateValue("shininess", 30);
    }
    set shininess(value: number) {
        this.setProperty("shininess", value);
    }

    @serialze()
    @property("material.emissive", { type: "color" })
    get emissive(): number | string {
        return this.getPrivateValue("emissive", 0x000000);
    }
    set emissive(value: number | string) {
        this.setProperty("emissive", value);
    }

    @serialze()
    @property("material.specularMap")
    get specularMap(): Texture {
        return this.getPrivateValue("specularMap", new Texture(this.document));
    }
    set specularMap(value: Texture) {
        this.setProperty("specularMap", value);
    }

    @serialze()
    @property("material.bumpMap")
    get bumpMap(): Texture {
        return this.getPrivateValue("bumpMap", new Texture(this.document));
    }
    set bumpMap(value: Texture) {
        this.setProperty("bumpMap", value);
    }

    @serialze()
    @property("material.normalMap")
    get normalMap(): Texture {
        return this.getPrivateValue("normalMap", new Texture(this.document));
    }
    set normalMap(value: Texture) {
        this.setProperty("normalMap", value);
    }

    @serialze()
    @property("material.emissiveMap")
    get emissiveMap(): Texture {
        return this.getPrivateValue("emissiveMap", new Texture(this.document));
    }
    set emissiveMap(value: Texture) {
        this.setProperty("emissiveMap", value);
    }
}

@serializable(["document", "name", "color", "id"])
export class PhysicalMaterial extends Material {
    @serialze()
    @property("material.metalness")
    get metalness(): number {
        return this.getPrivateValue("metalness", 0);
    }
    set metalness(value: number) {
        this.setProperty("metalness", value);
    }

    @serialze()
    @property("material.metalnessMap")
    get metalnessMap(): Texture {
        return this.getPrivateValue("metalnessMap", new Texture(this.document));
    }
    set metalnessMap(value: Texture) {
        this.setProperty("metalnessMap", value);
    }

    @serialze()
    @property("material.roughness")
    get roughness(): number {
        return this.getPrivateValue("roughness", 1);
    }
    set roughness(value: number) {
        this.setProperty("roughness", value);
    }

    @serialze()
    @property("material.roughnessMap")
    get roughnessMap(): Texture {
        return this.getPrivateValue("roughnessMap", new Texture(this.document));
    }
    set roughnessMap(value: Texture) {
        this.setProperty("roughnessMap", value);
    }

    @serialze()
    @property("material.emissive", { type: "color" })
    get emissive(): number | string {
        return this.getPrivateValue("emissive", 0x000000);
    }
    set emissive(value: number | string) {
        this.setProperty("emissive", value);
    }

    @serialze()
    @property("material.bumpMap")
    get bumpMap(): Texture {
        return this.getPrivateValue("bumpMap", new Texture(this.document));
    }
    set bumpMap(value: Texture) {
        this.setProperty("bumpMap", value);
    }

    @serialze()
    @property("material.normalMap")
    get normalMap(): Texture {
        return this.getPrivateValue("normalMap", new Texture(this.document));
    }
    set normalMap(value: Texture) {
        this.setProperty("normalMap", value);
    }

    @serialze()
    @property("material.emissiveMap")
    get emissiveMap(): Texture {
        return this.getPrivateValue("emissiveMap", new Texture(this.document));
    }
    set emissiveMap(value: Texture) {
        this.setProperty("emissiveMap", value);
    }
}
