// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "./document";
import { HistoryObservable, Id } from "./foundation";
import { XY } from "./math";
import { property } from "./property";
import { serializable, serialize } from "./serialize";

export interface TextureOptions {
    document: IDocument;
}

@serializable()
export class Texture extends HistoryObservable {
    constructor(options: TextureOptions) {
        super(options.document);
    }
    @serialize()
    @property("material.texture.image")
    get image(): string {
        return this.getPrivateValue("image", "");
    }
    set image(value: string) {
        this.setProperty("image", value);
    }

    @serialize()
    get wrapS(): number {
        return this.getPrivateValue("wrapS", 1000);
    }
    set wrapS(value: number) {
        this.setProperty("wrapS", value);
    }

    @serialize()
    get wrapT(): number {
        return this.getPrivateValue("wrapT", 1000);
    }
    set wrapT(value: number) {
        this.setProperty("wrapT", value);
    }

    @serialize()
    @property("material.texture.rotation")
    get rotation(): number {
        return this.getPrivateValue("rotation", 0);
    }
    set rotation(value: number) {
        this.setProperty("rotation", value);
    }

    @serialize()
    @property("material.texture.offset")
    get offset(): XY {
        return this.getPrivateValue("offset", new XY({ x: 0, y: 0 }));
    }
    set offset(value: XY) {
        this.setProperty("offset", value);
    }

    @serialize()
    @property("material.texture.repeat")
    get repeat(): XY {
        return this.getPrivateValue("repeat", new XY({ x: 1, y: 1 }));
    }
    set repeat(value: XY) {
        this.setProperty("repeat", value);
    }

    @serialize()
    get center(): XY {
        return this.getPrivateValue("center", new XY({ x: 0.5, y: 0.5 }));
    }
    set center(value: XY) {
        this.setProperty("center", value);
    }
}

export interface MaterialOptions {
    document: IDocument;
    name: string;
    color: number | string;
    id?: string;
}

@serializable()
export class Material extends HistoryObservable {
    @serialize()
    vertexColors = false;

    @serialize()
    transparent = true;

    @serialize()
    readonly id: string;

    @serialize()
    @property("common.name")
    get name(): string {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @serialize()
    @property("common.color", { type: "color" })
    get color(): number | string {
        return this.getPrivateValue("color");
    }
    set color(value: number | string) {
        this.setProperty("color", value);
    }

    @serialize()
    @property("common.opacity")
    get opacity(): number {
        return this.getPrivateValue("opacity", 1);
    }
    set opacity(value: number) {
        this.setProperty("opacity", value);
    }

    @serialize()
    @property("material.map")
    get map(): Texture {
        return this.getPrivateValue("map", new Texture({ document: this.document }));
    }
    set map(value: Texture) {
        this.setProperty("map", value);
    }

    constructor(options: MaterialOptions) {
        super(options.document);
        this.id = options.id ?? Id.generate();
        this.setPrivateValue("name", options.name?.length > 0 ? options.name : "unnamed");
        this.setPrivateValue("color", options.color);
    }

    clone(): Material {
        const material = new Material({
            document: this.document,
            name: `${this.name} clone`,
            color: this.color,
        });
        material.setPrivateValue("map", this.map);

        return material;
    }
}

export interface PhongMaterialOptions extends MaterialOptions {}

@serializable()
export class PhongMaterial extends Material {
    constructor(options: PhongMaterialOptions) {
        super(options);
    }

    @serialize()
    @property("material.specular", { type: "color" })
    get specular(): number | string {
        return this.getPrivateValue("specular", 0x111111);
    }
    set specular(value: number | string) {
        this.setProperty("specular", value);
    }

    @serialize()
    @property("material.shininess")
    get shininess(): number {
        return this.getPrivateValue("shininess", 30);
    }
    set shininess(value: number) {
        this.setProperty("shininess", value);
    }

    @serialize()
    @property("material.emissive", { type: "color" })
    get emissive(): number | string {
        return this.getPrivateValue("emissive", 0x000000);
    }
    set emissive(value: number | string) {
        this.setProperty("emissive", value);
    }

    @serialize()
    @property("material.specularMap")
    get specularMap(): Texture {
        return this.getPrivateValue("specularMap", new Texture({ document: this.document }));
    }
    set specularMap(value: Texture) {
        this.setProperty("specularMap", value);
    }

    @serialize()
    @property("material.bumpMap")
    get bumpMap(): Texture {
        return this.getPrivateValue("bumpMap", new Texture({ document: this.document }));
    }
    set bumpMap(value: Texture) {
        this.setProperty("bumpMap", value);
    }

    @serialize()
    @property("material.normalMap")
    get normalMap(): Texture {
        return this.getPrivateValue("normalMap", new Texture({ document: this.document }));
    }
    set normalMap(value: Texture) {
        this.setProperty("normalMap", value);
    }

    @serialize()
    @property("material.emissiveMap")
    get emissiveMap(): Texture {
        return this.getPrivateValue("emissiveMap", new Texture({ document: this.document }));
    }
    set emissiveMap(value: Texture) {
        this.setProperty("emissiveMap", value);
    }
}

export interface PhysicalMaterialOptions extends MaterialOptions {}

@serializable()
export class PhysicalMaterial extends Material {
    constructor(options: PhysicalMaterialOptions) {
        super(options);
    }

    @serialize()
    @property("material.metalness")
    get metalness(): number {
        return this.getPrivateValue("metalness", 0);
    }
    set metalness(value: number) {
        this.setProperty("metalness", value);
    }

    @serialize()
    @property("material.metalnessMap")
    get metalnessMap(): Texture {
        return this.getPrivateValue("metalnessMap", new Texture({ document: this.document }));
    }
    set metalnessMap(value: Texture) {
        this.setProperty("metalnessMap", value);
    }

    @serialize()
    @property("material.roughness")
    get roughness(): number {
        return this.getPrivateValue("roughness", 1);
    }
    set roughness(value: number) {
        this.setProperty("roughness", value);
    }

    @serialize()
    @property("material.roughnessMap")
    get roughnessMap(): Texture {
        return this.getPrivateValue("roughnessMap", new Texture({ document: this.document }));
    }
    set roughnessMap(value: Texture) {
        this.setProperty("roughnessMap", value);
    }

    @serialize()
    @property("material.emissive", { type: "color" })
    get emissive(): number | string {
        return this.getPrivateValue("emissive", 0x000000);
    }
    set emissive(value: number | string) {
        this.setProperty("emissive", value);
    }

    @serialize()
    @property("material.bumpMap")
    get bumpMap(): Texture {
        return this.getPrivateValue("bumpMap", new Texture({ document: this.document }));
    }
    set bumpMap(value: Texture) {
        this.setProperty("bumpMap", value);
    }

    @serialize()
    @property("material.normalMap")
    get normalMap(): Texture {
        return this.getPrivateValue("normalMap", new Texture({ document: this.document }));
    }
    set normalMap(value: Texture) {
        this.setProperty("normalMap", value);
    }

    @serialize()
    @property("material.emissiveMap")
    get emissiveMap(): Texture {
        return this.getPrivateValue("emissiveMap", new Texture({ document: this.document }));
    }
    set emissiveMap(value: Texture) {
        this.setProperty("emissiveMap", value);
    }
}
