// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { InternalClassName, Material, MaterialPresets, PropertyUtils, Serializer, Texture, XY } from "../src";
import { TestDocument } from "../test-utils";

describe("Material classes", () => {
    let document: TestDocument;

    beforeEach(() => {
        document = new TestDocument();
    });

    describe("Texture", () => {
        let texture: Texture;

        beforeEach(() => {
            texture = new Texture({ document });
        });

        describe("image property", () => {
            test("should set and get image value", () => {
                texture.image = "test-image.png";
                expect(texture.image).toBe("test-image.png");
            });

            test("should handle empty string", () => {
                texture.image = "";
                expect(texture.image).toBe("");
            });
        });

        describe("wrapS property", () => {
            test("should set and get wrapS value", () => {
                texture.wrapS = 3301; // REPEAT wrapping
                expect(texture.wrapS).toBe(3301);
            });
        });

        describe("wrapT property", () => {
            test("should set and get wrapT value", () => {
                texture.wrapT = 33648; // MIRRORED repeat wrapping
                expect(texture.wrapT).toBe(33648);
            });
        });

        describe("rotation property", () => {
            test("should set and get rotation value", () => {
                texture.rotation = Math.PI / 4;
                expect(texture.rotation).toBe(Math.PI / 4);
            });

            test("should handle negative rotation", () => {
                texture.rotation = -Math.PI / 2;
                expect(texture.rotation).toBe(-Math.PI / 2);
            });
        });

        describe("offset property", () => {
            test("should set and get offset value", () => {
                const offset = new XY({ x: 0.5, y: 0.25 });
                texture.offset = offset;
                expect(texture.offset).toEqual(offset);
            });
        });

        describe("repeat property", () => {
            test("should set and get repeat value", () => {
                const repeat = new XY({ x: 2, y: 3 });
                texture.repeat = repeat;
                expect(texture.repeat).toEqual(repeat);
            });
        });
    });

    describe("Material", () => {
        let material: Material;

        beforeEach(() => {
            material = new Material({ document, name: "TestMaterial", color: 0xff0000, id: "test-id" });
        });

        describe("constructor", () => {
            test("should create material with provided values", () => {
                expect(material.name).toBe("TestMaterial");
                expect(material.color).toBe(0xff0000);
                expect(material.id).toBe("test-id");
            });

            test("should generate default id when not provided", () => {
                const mat = new Material({ document, name: "TestMaterial", color: 0xff0000 });
                expect(mat.id).not.toBeNull();
                expect(mat.id.length).toBeGreaterThan(0);
            });

            test("should use 'unnamed' when empty name provided", () => {
                const mat = new Material({ document, name: "", color: 0xff0000 });
                expect(mat.name).toBe("unnamed");
            });

            test("should use 'unnamed' when null name provided", () => {
                const mat = new Material({ document, name: null as any, color: 0xff0000 });
                expect(mat.name).toBe("unnamed");
            });

            test("should set default property values", () => {
                expect(material.opacity).toBe(1);
                expect(material.roughness).toBe(0.5);
                expect(material.metalness).toBe(0);
                expect(material.normalScale.x).toBe(1);
                expect(material.normalScale.y).toBe(1);
                expect(material.bumpScale).toBe(1);
                expect(material.emissive).toBe(0x000000);
                expect(material.emissiveIntensity).toBe(1);
            });
        });

        describe("property set", () => {
            test("should expose exactly the physically based properties to the property panel", () => {
                const names = PropertyUtils.getProperties(material).map((x) => x.name);
                expect(names).toEqual([
                    "name",
                    "color",
                    "opacity",
                    "map",
                    "roughness",
                    "roughnessMap",
                    "metalness",
                    "metalnessMap",
                    "normalMap",
                    "normalScale",
                    "bumpMap",
                    "bumpScale",
                    "emissive",
                    "emissiveIntensity",
                    "emissiveMap",
                ]);
            });
        });

        describe("scalar properties", () => {
            test.each([
                { name: "roughness", value: 0.3 },
                { name: "metalness", value: 0.8 },
                { name: "bumpScale", value: 2 },
                { name: "emissiveIntensity", value: 4 },
            ] as const)("should set and get $name", ({ name, value }) => {
                material[name] = value;
                expect(material[name]).toBe(value);
            });

            test("should set and get normalScale", () => {
                material.normalScale = new XY({ x: 2, y: 3 });
                expect(material.normalScale.x).toBe(2);
                expect(material.normalScale.y).toBe(3);
            });

            test("should set and get emissive as string", () => {
                material.emissive = "#00ff00";
                expect(material.emissive).toBe("#00ff00");
            });
        });

        describe("name property", () => {
            test("should set and get name value", () => {
                material.name = "NewName";
                expect(material.name).toBe("NewName");
            });
        });

        describe("color property", () => {
            test("should set and get color as number", () => {
                material.color = 0x00ff00;
                expect(material.color).toBe(0x00ff00);
            });

            test("should set and get color as string", () => {
                material.color = "#ff0000";
                expect(material.color).toBe("#ff0000");
            });
        });

        describe("opacity property", () => {
            test("should set and get opacity value", () => {
                material.opacity = 0.5;
                expect(material.opacity).toBe(0.5);
            });

            test("should handle opacity boundary values", () => {
                material.opacity = 0;
                expect(material.opacity).toBe(0);

                material.opacity = 1;
                expect(material.opacity).toBe(1);
            });
        });

        describe("texture maps", () => {
            test.each([
                "map",
                "roughnessMap",
                "metalnessMap",
                "normalMap",
                "bumpMap",
                "emissiveMap",
            ] as const)("should set and get %s", (name) => {
                const texture = new Texture({ document });
                material[name] = texture;
                expect(material[name]).toBe(texture);
            });

            test("should have default texture maps", () => {
                expect(material.map).toBeInstanceOf(Texture);
                expect(material.roughnessMap).toBeInstanceOf(Texture);
                expect(material.metalnessMap).toBeInstanceOf(Texture);
                expect(material.normalMap).toBeInstanceOf(Texture);
                expect(material.bumpMap).toBeInstanceOf(Texture);
                expect(material.emissiveMap).toBeInstanceOf(Texture);
            });
        });

        describe("clone", () => {
            test("should copy every shown property, sharing textures and taking a new id", () => {
                material.name = "Original";
                material.color = 0x123456;
                material.roughness = 0.25;
                material.metalness = 0.75;
                material.emissive = 0x00ff00;
                material.normalScale = new XY({ x: 2, y: 3 });
                const texture = new Texture({ document });
                material.map = texture;

                const clone = material.clone();

                expect(clone).toBeInstanceOf(Material);
                expect(clone.name).toBe("Original clone");
                expect(clone.color).toBe(0x123456);
                expect(clone.roughness).toBe(0.25);
                expect(clone.metalness).toBe(0.75);
                expect(clone.emissive).toBe(0x00ff00);
                expect(clone.normalScale.x).toBe(2);
                expect(clone.normalScale.y).toBe(3);
                expect(clone.map).toBe(texture);
                expect(clone.id).not.toBe(material.id);
            });
        });

        describe("serialization", () => {
            test("should persist under the Material class marker and come back whole", () => {
                material.roughness = 0.25;
                material.metalness = 0.75;
                material.emissive = 0x00ff00;
                material.emissiveIntensity = 3;
                material.normalScale = new XY({ x: 2, y: 3 });
                material.map.image = "data:image/png;base64,AAAA";

                const serialized = Serializer.serializeObject(material);
                expect(serialized[InternalClassName]).toBe("Material");

                const restored = Serializer.deserializeObject(document, serialized) as Material;
                expect(restored).toBeInstanceOf(Material);
                expect(restored.id).toBe(material.id);
                expect(restored.roughness).toBe(0.25);
                expect(restored.metalness).toBe(0.75);
                expect(restored.emissive).toBe(0x00ff00);
                expect(restored.emissiveIntensity).toBe(3);
                expect(restored.normalScale.x).toBe(2);
                expect(restored.normalScale.y).toBe(3);
                expect(restored.map.image).toBe("data:image/png;base64,AAAA");
            });
        });
    });

    describe("MaterialPresets", () => {
        test("should cover a matte plastic, a satin plastic, a metal and a glass", () => {
            expect(MaterialPresets.map((x) => x.name)).toEqual([
                "Matte Plastic",
                "Satin Plastic",
                "Metal",
                "Glass",
            ]);
            // The metal is the only metallic one, the glass the only one that is not opaque.
            expect(MaterialPresets.filter((x) => x.metalness > 0).map((x) => x.name)).toEqual(["Metal"]);
            expect(MaterialPresets.filter((x) => (x.opacity ?? 1) < 1).map((x) => x.name)).toEqual(["Glass"]);
        });
    });

    describe("Material.fromPreset", () => {
        test.each([...MaterialPresets])("should build $name from its values", (preset) => {
            const material = Material.fromPreset(document, preset);

            expect(material).toBeInstanceOf(Material);
            expect(material.name).toBe(preset.name);
            expect(material.color).toBe(preset.color);
            expect(material.roughness).toBe(preset.roughness);
            expect(material.metalness).toBe(preset.metalness);
            expect(material.opacity).toBe(preset.opacity ?? 1);
        });
    });
});
