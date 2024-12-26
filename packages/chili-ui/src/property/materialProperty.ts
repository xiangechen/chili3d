// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Material, Property, PubSub, Transaction } from "chili-core";
import { button, div, localize, span } from "../components";
import style from "./materialProperty.module.css";
import { PropertyBase } from "./propertyBase";

export class MaterialProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: { materialId: string | string[] }[],
        readonly property: Property,
    ) {
        super(objects);
        if (Array.isArray(objects[0].materialId)) {
            if (objects[0].materialId.length === 1) {
                this.append(this.materialControl(document, objects[0].materialId[0]));
            } else {
                for (let i = 0; i < objects[0].materialId.length; i++) {
                    this.append(this.materialControl(document, objects[0].materialId[i], i + 1));
                }
            }
        } else {
            this.append(this.materialControl(document, objects[0].materialId));
        }
    }

    private materialControl(document: IDocument, materialId: string, index?: number) {
        let material = this.findMaterial(materialId);
        if (!material) {
            return "";
        }

        return div(
            {
                className: style.material,
            },
            div(
                span({
                    textContent: localize("common.material"),
                }),
                index ? span({ textContent: " " + index.toString() }) : "",
            ),
            button({
                textContent: material.name,
                onclick: (e) => {
                    PubSub.default.pub(
                        "editMaterial",
                        document,
                        material,
                        (material) => {
                            this.setMaterial(e, material, index);
                        },
                    );
                },
            }),
        );
    }

    private setMaterial(e: MouseEvent, material: Material, index?: number) {
        let button = e.target as HTMLButtonElement;
        button.textContent = material.name;
        Transaction.excute(this.document, "change material", () => {
            this.objects.forEach((x) => {
                if (this.property.name in x) {
                    if (index) {
                        x.materialId = x.materialId.toSpliced(index - 1, 1, material.id);
                    } else {
                        x.materialId = material.id;
                    }
                }
            });
        });
        this.document.visual.update();
    }

    private findMaterial(id: string) {
        return this.document.materials.find((x) => x.id === id);
    }

}

customElements.define("chili-material-property", MaterialProperty);
