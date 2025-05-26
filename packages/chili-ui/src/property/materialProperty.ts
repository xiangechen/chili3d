// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { button, collection, ColorConverter, div, span, UrlStringConverter } from "chili-controls";
import {
    Binding,
    IDocument,
    Localize,
    Material,
    ObservableCollection,
    PathBinding,
    Property,
    PubSub,
    Transaction,
} from "chili-core";
import style from "./materialProperty.module.css";
import { PropertyBase } from "./propertyBase";

export class MaterialProperty extends PropertyBase {
    private readonly materials: ObservableCollection<Material>;

    constructor(
        readonly document: IDocument,
        objects: { materialId: string | string[] }[],
        readonly property: Property,
    ) {
        super(objects);
        this.materials = this.materialCollection(objects[0].materialId);
        this.append(
            collection({
                sources: this.materials,
                template: (material, index) => this.materialControl(document, material, index),
            }),
        );
    }

    private materialControl(document: IDocument, material: Material, index: number) {
        return div(
            { className: style.material },
            div(
                span({ textContent: new Localize("common.material") }),
                this.materials.length > 1 ? span({ textContent: ` ${index + 1}` }) : "",
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
        Transaction.execute(this.document, "change material", () => {
            this.materials.replace(index, material);
            this.objects.forEach((x) => {
                if (this.property.name in x) {
                    x.materialId =
                        this.materials.length > 1
                            ? x.materialId.toSpliced(index, 1, material.id)
                            : material.id;
                }
            });
        });
        this.document.visual.update();
    }

    private materialCollection(id: string | string[]) {
        const findMaterial = (id: string) => this.document.materials.find((m) => m.id === id);
        const materials = Array.isArray(id)
            ? id.map(findMaterial).filter(Boolean)
            : [findMaterial(id)].filter(Boolean);
        return new ObservableCollection(...materials) as ObservableCollection<Material>;
    }
}

customElements.define("chili-material-property", MaterialProperty);
