// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Material, Observable } from "chili-core";

let count = 1;

export class MaterialDataContent extends Observable {
    private _editingMaterial: Material;
    get editingMaterial(): Material {
        return this._editingMaterial;
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
        this._editingMaterial = editingMaterial;
    }

    deleteMaterial() {
        if (this.document.materials.length <= 1) return;
        let tempMaterial = this.editingMaterial;
        this.editingMaterial = this.document.materials.find((m) => m.id !== this.editingMaterial.id)!;
        this.callback(this.editingMaterial);
        this.document.materials.remove(tempMaterial);
    }

    addMaterial() {
        this.document.materials.push(new Material(this.document, `Material ${count++}`, 0xdddddd));
    }

    copyMaterial() {
        this.document.materials.push(this.editingMaterial.clone());
    }
}
