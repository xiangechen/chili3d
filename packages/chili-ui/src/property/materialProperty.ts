// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding, IDocument, Material, ObservableCollection, PathBinding, Property, PubSub, Transaction } from "chili-core";
import { button, collection, div, localize, span } from "../components";
import style from "./materialProperty.module.css";
import { PropertyBase } from "./propertyBase";
import { UrlStringConverter } from "./material/urlConverter";
import { ColorConverter } from "../converters";

export class MaterialProperty extends PropertyBase {
    private readonly materials: ObservableCollection<Material>

    constructor(
        readonly document: IDocument,
        objects: { materialId: string | string[] }[],
        readonly property: Property,
    ) {
        super(objects);
        this.materials = this.materialCollection(objects[0].materialId);
        this.append(collection({
            sources: this.materials,
            template: (material, index) => this.materialControl(document, material, index),
        }))
    }

    private materialControl(document: IDocument, material: Material, index: number) {
        return div(
            {
                className: style.material,
            },
            div(
                span({
                    textContent: localize("common.material"),
                }),
                this.materials.length > 1 ? span({ textContent: ` ${index + 1}`}) : "",
            ),
            button({
                textContent: material.name,
                style: {
                    backgroundColor: new Binding(material, "color", new ColorConverter()),
                    backgroundImage: new PathBinding(material, "map.image", new UrlStringConverter()),
                    backgroundBlendMode: "multiply",
                    backgroundSize: "cover",
                    cursor: "pointer",
                },
                onclick: (e) => {
                    PubSub.default.pub("editMaterial", document, material, (material) => {
                        this.setMaterial(e, material, index);
                    });
                },
            }),
        );
    }

    private setMaterial(e: MouseEvent, material: Material, index: number) {
        Transaction.excute(this.document, "change material", () => {
            this.materials.replace(index, material);
            this.objects.forEach((x) => {
                if (this.property.name in x) {
                    if (this.materials.length > 1) {
                        x.materialId = x.materialId.toSpliced(index, 1, material.id);
                    } else if (this.materials.length === 1) {
                        x.materialId = material.id;
                    }
                }
            });
        });
        this.document.visual.update();
    }

    private materialCollection(id: string | string[]) {
        const findMaterial = (id: string) => this.document.materials.find(m => m.id === id);

        let materials: Material[]
        if (Array.isArray(id)) {
            materials = id.map((x) => findMaterial(x)).filter((x) => x !== undefined);
        } else {
            materials = [];
            let material = findMaterial(id);
            if (material) {
                materials.push(material);
            }   
        }
        return new ObservableCollection(...materials);
    }
}

customElements.define("chili-material-property", MaterialProperty);
