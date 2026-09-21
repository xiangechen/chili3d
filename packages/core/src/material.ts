// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "./document";
import { HistoryObservable, Id } from "./foundation";
import { XY } from "./math";
import { PropertyUtils, property } from "./property";
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

/**
 * A surface a new material can start from. A CAD user picks what the surface *is* — satin plastic,
 * polished metal — rather than dialling a neutral shader into shape: Fusion 360 and Onshape both
 * ship appearance libraries and keep their defaults inside those assets, and FreeCAD's cards store
 * a whole named material. These are the same idea with the values written down.
 */
export interface MaterialPreset {
    /** Names the preset in the picker and the material it creates. English, like the rest of a
     *  document's materials, and like the appearance names in Fusion's library. */
    readonly name: string;
    readonly color: number;
    readonly roughness: number;
    readonly metalness: number;
    readonly opacity?: number;
}

export const MaterialPresets: readonly MaterialPreset[] = [
    { name: "Matte Plastic", color: 0xdedede, roughness: 0.85, metalness: 0 },
    { name: "Satin Plastic", color: 0xdedede, roughness: 0.45, metalness: 0 },
    // A mirror-smooth metal has only the room to reflect and comes out nearly black against it,
    // so this is brushed enough to gather light from every direction and still read as metal.
    { name: "Metal", color: 0xffffff, roughness: 0.35, metalness: 1 },
    // As close to glass as this material model reaches: shiny and see-through by opacity. There is
    // no transmission or IOR, so it reads as tinted glass rather than refracting like it.
    { name: "Glass", color: 0xeaf4f7, roughness: 0.05, metalness: 0, opacity: 0.3 },
];
/**
 * The document's one material — a physically based (metalness/roughness) surface, mirroring
 * the core of three.js `MeshPhysicalMaterial`. Every node and every face references one by id,
 * and each property maps onto the same-named three.js one; the ones with a `Map` companion take
 * a `Texture` slot. Properties three.js needs but a document has no source for (iridescence,
 * sheen, transmission, …) are deliberately absent, and so is `envMapIntensity`: the environment
 * is the scene's, and three overwrites a material's own intensity with the scene's while the
 * environment comes from there, so the control would do nothing.
 */
@serializable()
export class Material extends HistoryObservable {
    /** What a surface starts out as when nothing says otherwise — a half-rough dielectric, the
     *  neutral plastic the CG side settled on (three.js defaults to fully rough, Blender to 0.5). */
    static readonly DefaultRoughness = 0.5;
    static readonly DefaultMetalness = 0;

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

    @serialize()
    @property("material.roughness")
    get roughness(): number {
        return this.getPrivateValue("roughness", Material.DefaultRoughness);
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
    @property("material.metalness")
    get metalness(): number {
        return this.getPrivateValue("metalness", Material.DefaultMetalness);
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
    @property("material.normalMap")
    get normalMap(): Texture {
        return this.getPrivateValue("normalMap", new Texture({ document: this.document }));
    }
    set normalMap(value: Texture) {
        this.setProperty("normalMap", value);
    }

    @serialize()
    @property("material.normalScale")
    get normalScale(): XY {
        return this.getPrivateValue("normalScale", new XY({ x: 1, y: 1 }));
    }
    set normalScale(value: XY) {
        this.setProperty("normalScale", value);
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
    @property("material.bumpScale")
    get bumpScale(): number {
        return this.getPrivateValue("bumpScale", 1);
    }
    set bumpScale(value: number) {
        this.setProperty("bumpScale", value);
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
    @property("material.emissiveIntensity")
    get emissiveIntensity(): number {
        return this.getPrivateValue("emissiveIntensity", 1);
    }
    set emissiveIntensity(value: number) {
        this.setProperty("emissiveIntensity", value);
    }

    @serialize()
    @property("material.emissiveMap")
    get emissiveMap(): Texture {
        return this.getPrivateValue("emissiveMap", new Texture({ document: this.document }));
    }
    set emissiveMap(value: Texture) {
        this.setProperty("emissiveMap", value);
    }

    constructor(options: MaterialOptions) {
        super(options.document);
        this.id = options.id ?? Id.generate();
        this.setPrivateValue("name", options.name?.length > 0 ? options.name : "unnamed");
        this.setPrivateValue("color", options.color);
    }

    /** A material wearing a preset's surface, named after it. */
    static fromPreset(document: IDocument, preset: MaterialPreset): Material {
        const material = new Material({
            document,
            name: preset.name,
            color: preset.color,
        });
        material.roughness = preset.roughness;
        material.metalness = preset.metalness;
        if (preset.opacity !== undefined) material.opacity = preset.opacity;

        return material;
    }

    /** Copies every property the panel shows, leaving `id` fresh and sharing the textures. */
    clone(): Material {
        const material = new Material({
            document: this.document,
            name: `${this.name} clone`,
            color: this.color,
        });
        const source = this as unknown as Record<string, unknown>;
        const target = material as unknown as Record<string, unknown>;
        for (const prop of PropertyUtils.getProperties(this)) {
            if (prop.name === "name" || prop.name === "color") continue;
            target[prop.name] = source[prop.name];
        }

        return material;
    }
}
