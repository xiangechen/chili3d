// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Material, Property, PubSub, Transaction, VisualNode } from "chili-core";
import { button, div, localize, span } from "../components";
import style from "./materialProperty.module.css";
import { PropertyBase } from "./propertyBase";

export class MaterialProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: { materialId: string }[],
        readonly property: Property,
    ) {
        super(objects);
        this.appendChild(
            div(
                {
                    className: style.material,
                },
                span({
                    textContent: localize(property.display),
                }),
                button({
                    textContent: this.findMaterial(objects[0].materialId).name,
                    onclick: (e) => {
                        PubSub.default.pub(
                            "editMaterial",
                            document,
                            this.findMaterial(objects[0].materialId),
                            (material) => {
                                this.setMaterial(e, material);
                            },
                        );
                    },
                }),
            ),
        );
    }

    private setMaterial(e: MouseEvent, material: Material) {
        let button = e.target as HTMLButtonElement;
        button.textContent = material.name;
        Transaction.excute(this.document, "change material", () => {
            this.objects.forEach((x) => {
                if (this.property.name in x) {
                    x[this.property.name] = material.id;
                }
            });
        });
        this.document.visual.update();
    }

    private findMaterial(id: string) {
        return this.document.materials.find((x) => x.id === id)!;
    }
}

customElements.define("chili-material-property", MaterialProperty);
