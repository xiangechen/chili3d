// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Material, type MaterialPreset, Observable } from "@chili3d/core";

let count = 1;

export class MaterialDataContent extends Observable {
    get editingMaterial(): Material {
        return this.getPrivateValue("editingMaterial");
    }
    set editingMaterial(value: Material) {
        this.setProperty("editingMaterial", value);
    }

    constructor(
        readonly document: IDocument,
        readonly callback: (material: Material) => void,
        editingMaterial: Material,
    ) {
        super();
        this.setPrivateValue("editingMaterial", editingMaterial);
    }

    deleteMaterial() {
        if (this.document.modelManager.materials.length <= 1) return;
        const tempMaterial = this.editingMaterial;
        this.editingMaterial = this.document.modelManager.materials.find(
            (m) => m.id !== this.editingMaterial.id,
        )!;
        this.callback(this.editingMaterial);
        this.document.modelManager.materials.remove(tempMaterial);
    }

    /** Adds a material — wearing `preset`'s surface, or a plain grey one when none is given. */
    addMaterial(preset?: MaterialPreset) {
        this.document.modelManager.materials.push(
            preset === undefined
                ? new Material({ document: this.document, name: `Material ${count++}`, color: 0xdddddd })
                : Material.fromPreset(this.document, preset),
        );
    }

    copyMaterial() {
        this.document.modelManager.materials.push(this.editingMaterial.clone());
    }
}
