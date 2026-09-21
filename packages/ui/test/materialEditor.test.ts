// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Material, MaterialPresets } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { MaterialDataContent } from "../src/property/material/materialDataContent";
import { MaterialEditor } from "../src/property/material/materialEditor";
import style from "../src/property/material/materialEditor.module.css";
import { mustQuery } from "./_helpers/domHelpers";

describe("MaterialEditor", () => {
    let document: TestDocument;
    let editor: MaterialEditor;

    beforeEach(() => {
        document = new TestDocument();
        const editing = new Material({ document, name: "start", color: 0x111111 });
        document.modelManager.materials.push(editing);
        editor = new MaterialEditor(new MaterialDataContent(document, () => {}, editing));
        window.document.body.appendChild(editor);
    });

    afterEach(() => {
        // removing the editor is what closes the preset list, which lives on document.body
        editor.remove();
        document.dispose();
    });

    function materials() {
        return document.modelManager.materials;
    }

    /** The collection's `at` is typed as possibly missing; these tests know what it holds. */
    function materialAt(index: number): Material {
        return materials().at(index) as Material;
    }

    /** The title-bar icon buttons carry no label: they are found by the icon they render. */
    function iconButton(icon: string): Element {
        const use = [...editor.querySelectorAll("use")].find(
            (x) => x.getAttribute("xlink:href") === `#${icon}`,
        );
        expect(use).not.toBeNull();
        return (use as Element).parentElement as Element;
    }

    /** Happy-DOM gives SVG elements no `click()`, and the handler is on `onclick`. */
    function click(el: Element) {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }

    function openPresets() {
        click(iconButton("icon-plus"));
        return mustQuery(window.document.body, `.${style.presets}`);
    }

    function menuRows() {
        return [...mustQuery(window.document.body, `.${style.presets}`).children] as HTMLElement[];
    }

    /** The plain material leads the list; the presets follow the divider. */
    function blankRow() {
        return menuRows()[0];
    }

    function presetRows() {
        return menuRows().slice(2);
    }

    function swatchColor(row: Element) {
        return mustQuery<HTMLElement>(row, `.${style.presetSwatch}`).style.backgroundColor;
    }

    describe("preset list", () => {
        test("should offer every preset, each showing its colour and name", () => {
            openPresets();

            expect(presetRows().map(swatchColor)).toEqual(["#dedede", "#dedede", "#ffffff", "#eaf4f7"]);
            // the row is labelled with the name the material will carry
            expect(presetRows().map((x) => x.textContent)).toEqual([
                "Matte Plastic",
                "Satin Plastic",
                "Metal",
                "Glass",
            ]);
        });

        test("should lead with the plain material, apart from the presets", () => {
            const menu = openPresets();

            // the blank entry shows no surface, only the frame
            expect(blankRow().textContent).toBe("Blank");
            expect(swatchColor(blankRow())).toBe("");
            // plain material, divider, then the four surfaces
            expect([...menu.children].map((x) => x.className)).toEqual([
                style.preset,
                style.presetDivider,
                style.preset,
                style.preset,
                style.preset,
                style.preset,
            ]);
        });

        test("should add nothing until a preset is picked", () => {
            openPresets();

            expect(materials().length).toBe(1);
        });

        test("should close when the editor goes away", () => {
            openPresets();

            editor.remove();

            expect(window.document.body.querySelector(`.${style.presets}`)).toBeNull();
        });
    });

    describe("picking a preset", () => {
        test.each([
            { index: 0, roughness: 0.85, metalness: 0, opacity: 1 },
            { index: 1, roughness: 0.45, metalness: 0, opacity: 1 },
            { index: 2, roughness: 0.5, metalness: 1, opacity: 1 },
            { index: 3, roughness: 0.05, metalness: 0.1, opacity: 0.3 },
        ])("should start the new material at preset $index", ({ index, roughness, metalness, opacity }) => {
            openPresets();

            click(presetRows()[index]);

            expect(materials().length).toBe(2);
            const added = materialAt(1);
            expect(added.roughness).toBe(roughness);
            expect(added.metalness).toBe(metalness);
            expect(added.opacity).toBe(opacity);
            expect(added.color).toBe(MaterialPresets[index].color);
        });

        test("should close the list once a preset is picked", () => {
            openPresets();

            click(presetRows()[1]);

            expect(window.document.body.querySelector(`.${style.presets}`)).toBeNull();
        });

        test("should add a plain material from the blank entry", () => {
            openPresets();

            click(blankRow());

            expect(materials().length).toBe(2);
            const added = materialAt(1);
            // the plain material: a mid-grey, half-rough surface with no texture on it
            expect(added.color).toBe(0xdddddd);
            expect(added.roughness).toBe(0.5);
            expect(added.metalness).toBe(0);
            expect(added.map.image).toBe("");
        });

        test("should leave the material being edited alone", () => {
            openPresets();

            click(presetRows()[2]);

            expect(materialAt(0).color).toBe(0x111111);
            expect(materialAt(0).roughness).toBe(0.5);
        });

        test("should give each picked preset the values the core presets declare", () => {
            openPresets();

            for (const [index, row] of presetRows().entries()) {
                click(row);
                const added = materialAt(-1);
                expect(added.color).toBe(MaterialPresets[index].color);
                expect(added.roughness).toBe(MaterialPresets[index].roughness);
                expect(added.metalness).toBe(MaterialPresets[index].metalness);
            }
            expect(materials().length).toBe(MaterialPresets.length + 1);
        });
    });

    describe("names", () => {
        test("should name a material after the preset it came from", () => {
            const preset = Material.fromPreset(document, MaterialPresets[1]);
            document.modelManager.materials.push(preset);

            const titles = [...editor.querySelectorAll(`.${style.material}`)].map(
                (x) => (x as HTMLElement).title,
            );

            expect(titles).toContain("Satin Plastic");
            expect(preset.name).toBe("Satin Plastic");
        });
    });
});
