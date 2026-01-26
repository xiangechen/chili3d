// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XY } from "chili-core";
import { Material, PhongMaterial, PhysicalMaterial, Texture } from "../src";
import { TestDocument } from "./testDocument";

describe("Material classes", () => {
    let document: TestDocument;

    beforeEach(() => {
        document = new TestDocument();
    });

    describe("Texture", () => {
        let texture: Texture;

        beforeEach(() => {
            texture = new Texture(document);
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
                const offset = new XY(0.5, 0.25);
                texture.offset = offset;
                expect(texture.offset).toEqual(offset);
            });
        });

        describe("repeat property", () => {
            test("should set and get repeat value", () => {
                const repeat = new XY(2, 3);
                texture.repeat = repeat;
                expect(texture.repeat).toEqual(repeat);
            });
        });
    });

    describe("Material", () => {
        let material: Material;

        beforeEach(() => {
            material = new Material(document, "TestMaterial", 0xff0000, "test-id");
        });

        describe("constructor", () => {
            test("should create material with provided values", () => {
                expect(material.name).toBe("TestMaterial");
                expect(material.color).toBe(0xff0000);
                expect(material.id).toBe("test-id");
            });

            test("should generate default id when not provided", () => {
                const mat = new Material(document, "TestMaterial", 0xff0000);
                expect(mat.id).toBeDefined();
                expect(mat.id.length).toBeGreaterThan(0);
            });

            test("should use 'unnamed' when empty name provided", () => {
                const mat = new Material(document, "", 0xff0000);
                expect(mat.name).toBe("unnamed");
            });

            test("should use 'unnamed' when null name provided", () => {
                const mat = new Material(document, null as any, 0xff0000);
                expect(mat.name).toBe("unnamed");
            });

            test("should set default property values", () => {
                expect(material.vertexColors).toBe(false);
                expect(material.transparent).toBe(true);
                expect(material.opacity).toBe(1);
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

        describe("map property", () => {
            test("should set and get map texture", () => {
                const texture = new Texture(document);
                material.map = texture;
                expect(material.map).toBe(texture);
            });

            test("should have default map texture", () => {
                expect(material.map).toBeInstanceOf(Texture);
            });
        });

        describe("clone", () => {
            test("should create a clone with correct properties", () => {
                material.name = "Original";
                material.color = 0x123456;
                const texture = new Texture(document);
                material.map = texture;

                const clone = material.clone();

                expect(clone).toBeInstanceOf(Material);
                expect(clone.name).toBe("Original clone");
                expect(clone.color).toBe(0x123456);
                expect(clone.map).toBe(texture);
                expect(clone.id).not.toBe(material.id);
            });
        });
    });

    describe("PhongMaterial", () => {
        let phongMaterial: PhongMaterial;

        beforeEach(() => {
            phongMaterial = new PhongMaterial(document, "PhongMaterial", 0xff0000, "phong-id");
        });

        describe("constructor", () => {
            test("should create phong material with default values", () => {
                expect(phongMaterial.name).toBe("PhongMaterial");
                expect(phongMaterial.color).toBe(0xff0000);
                expect(phongMaterial.id).toBe("phong-id");
            });
        });

        describe("specular property", () => {
            test("should set and get specular as number", () => {
                phongMaterial.specular = 0xffffff;
                expect(phongMaterial.specular).toBe(0xffffff);
            });

            test("should set and get specular as string", () => {
                phongMaterial.specular = "#ffffff";
                expect(phongMaterial.specular).toBe("#ffffff");
            });
        });

        describe("shininess property", () => {
            test("should set and get shininess value", () => {
                phongMaterial.shininess = 100;
                expect(phongMaterial.shininess).toBe(100);
            });
        });

        describe("emissive property", () => {
            test("should set and get emissive as number", () => {
                phongMaterial.emissive = 0x00ff00;
                expect(phongMaterial.emissive).toBe(0x00ff00);
            });

            test("should set and get emissive as string", () => {
                phongMaterial.emissive = "#00ff00";
                expect(phongMaterial.emissive).toBe("#00ff00");
            });
        });

        describe("texture maps", () => {
            test("should set and get specularMap", () => {
                const texture = new Texture(document);
                phongMaterial.specularMap = texture;
                expect(phongMaterial.specularMap).toBe(texture);
            });

            test("should set and get bumpMap", () => {
                const texture = new Texture(document);
                phongMaterial.bumpMap = texture;
                expect(phongMaterial.bumpMap).toBe(texture);
            });

            test("should set and get normalMap", () => {
                const texture = new Texture(document);
                phongMaterial.normalMap = texture;
                expect(phongMaterial.normalMap).toBe(texture);
            });

            test("should set and get emissiveMap", () => {
                const texture = new Texture(document);
                phongMaterial.emissiveMap = texture;
                expect(phongMaterial.emissiveMap).toBe(texture);
            });

            test("should have default texture maps", () => {
                expect(phongMaterial.specularMap).toBeInstanceOf(Texture);
                expect(phongMaterial.bumpMap).toBeInstanceOf(Texture);
                expect(phongMaterial.normalMap).toBeInstanceOf(Texture);
                expect(phongMaterial.emissiveMap).toBeInstanceOf(Texture);
            });
        });
    });

    describe("PhysicalMaterial", () => {
        let physicalMaterial: PhysicalMaterial;

        beforeEach(() => {
            physicalMaterial = new PhysicalMaterial(document, "PhysicalMaterial", 0xff0000, "physical-id");
        });

        describe("constructor", () => {
            test("should create physical material with default values", () => {
                expect(physicalMaterial.name).toBe("PhysicalMaterial");
                expect(physicalMaterial.color).toBe(0xff0000);
                expect(physicalMaterial.id).toBe("physical-id");
            });
        });

        describe("metalness property", () => {
            test("should set and get metalness value", () => {
                physicalMaterial.metalness = 0.8;
                expect(physicalMaterial.metalness).toBe(0.8);
            });

            test("should handle metalness boundary values", () => {
                physicalMaterial.metalness = 0;
                expect(physicalMaterial.metalness).toBe(0);

                physicalMaterial.metalness = 1;
                expect(physicalMaterial.metalness).toBe(1);
            });
        });

        describe("roughness property", () => {
            test("should set and get roughness value", () => {
                physicalMaterial.roughness = 0.3;
                expect(physicalMaterial.roughness).toBe(0.3);
            });

            test("should handle roughness boundary values", () => {
                physicalMaterial.roughness = 0;
                expect(physicalMaterial.roughness).toBe(0);

                physicalMaterial.roughness = 1;
                expect(physicalMaterial.roughness).toBe(1);
            });
        });

        describe("emissive property", () => {
            test("should set and get emissive as number", () => {
                physicalMaterial.emissive = 0x00ff00;
                expect(physicalMaterial.emissive).toBe(0x00ff00);
            });

            test("should set and get emissive as string", () => {
                physicalMaterial.emissive = "#00ff00";
                expect(physicalMaterial.emissive).toBe("#00ff00");
            });
        });

        describe("texture maps", () => {
            test("should set and get metalnessMap", () => {
                const texture = new Texture(document);
                physicalMaterial.metalnessMap = texture;
                expect(physicalMaterial.metalnessMap).toBe(texture);
            });

            test("should set and get roughnessMap", () => {
                const texture = new Texture(document);
                physicalMaterial.roughnessMap = texture;
                expect(physicalMaterial.roughnessMap).toBe(texture);
            });

            test("should set and get bumpMap", () => {
                const texture = new Texture(document);
                physicalMaterial.bumpMap = texture;
                expect(physicalMaterial.bumpMap).toBe(texture);
            });

            test("should set and get normalMap", () => {
                const texture = new Texture(document);
                physicalMaterial.normalMap = texture;
                expect(physicalMaterial.normalMap).toBe(texture);
            });

            test("should set and get emissiveMap", () => {
                const texture = new Texture(document);
                physicalMaterial.emissiveMap = texture;
                expect(physicalMaterial.emissiveMap).toBe(texture);
            });

            test("should have default texture maps", () => {
                expect(physicalMaterial.metalnessMap).toBeInstanceOf(Texture);
                expect(physicalMaterial.roughnessMap).toBeInstanceOf(Texture);
                expect(physicalMaterial.bumpMap).toBeInstanceOf(Texture);
                expect(physicalMaterial.normalMap).toBeInstanceOf(Texture);
                expect(physicalMaterial.emissiveMap).toBeInstanceOf(Texture);
            });
        });
    });

    describe("Inheritance", () => {
        test("PhongMaterial should inherit from Material", () => {
            const phongMaterial = new PhongMaterial(document, "Test", 0xff0000);
            expect(phongMaterial).toBeInstanceOf(Material);
            expect(phongMaterial).toBeInstanceOf(PhongMaterial);
        });

        test("PhysicalMaterial should inherit from Material", () => {
            const physicalMaterial = new PhysicalMaterial(document, "Test", 0xff0000);
            expect(physicalMaterial).toBeInstanceOf(Material);
            expect(physicalMaterial).toBeInstanceOf(PhysicalMaterial);
        });

        test("PhongMaterial should have access to Material properties", () => {
            const phongMaterial = new PhongMaterial(document, "Test", 0xff0000);
            phongMaterial.opacity = 0.5;
            expect(phongMaterial.opacity).toBe(0.5);
        });

        test("PhysicalMaterial should have access to Material properties", () => {
            const physicalMaterial = new PhysicalMaterial(document, "Test", 0xff0000);
            physicalMaterial.opacity = 0.7;
            expect(physicalMaterial.opacity).toBe(0.7);
        });
    });
});
