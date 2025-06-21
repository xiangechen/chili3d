// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { button, collection, ColorConverter, div, span, svg } from "chili-controls";
import { UrlStringConverter } from "chili-controls/src/converters/urlConverter";
import {
    Binding,
    IConverter,
    Localize,
    Material,
    PathBinding,
    Property,
    PubSub,
    Result,
    Texture,
} from "chili-core";
import { findPropertyControl } from "../utils";
import { MaterialDataContent } from "./materialDataContent";
import style from "./materialEditor.module.css";

class ActiveStyleConverter implements IConverter<Material> {
    constructor(readonly material: Material) {}

    convert(value: Material): Result<string> {
        return Result.ok(this.material === value ? `${style.material} ${style.active}` : style.material);
    }
}

export class MaterialEditor extends HTMLElement {
    private readonly editingControl: HTMLElement;
    private readonly colorConverter = new ColorConverter();

    constructor(readonly dataContent: MaterialDataContent) {
        super();
        this.editingControl = div({ className: style.properties });
        this.initEditingControl(dataContent.editingMaterial);
        this.append(this.createEditorUI());
    }

    private createEditorUI() {
        return div(
            { className: style.root },
            this.titleSection(),
            this.materialsCollection(),
            this.editingControl,
            this.buttons(),
        );
    }

    private titleSection() {
        return div(
            { className: style.title },
            span({ textContent: new Localize("common.material") }),
            this.iconButton("icon-plus", () => this.dataContent.addMaterial()),
            this.iconButton("icon-clone", () => this.dataContent.copyMaterial()),
            this.iconButton("icon-trash", () => this.dataContent.deleteMaterial()),
        );
    }

    private iconButton(icon: string, onclick: () => void) {
        return svg({ icon, onclick });
    }

    private materialsCollection() {
        return collection({
            className: style.materials,
            sources: this.dataContent.document.materials,
            template: (material: Material) => this.material(material),
        });
    }

    private material(material: Material) {
        return span({
            className: new Binding(this.dataContent, "editingMaterial", new ActiveStyleConverter(material)),
            title: material.name,
            style: {
                backgroundColor: new Binding(material, "color", this.colorConverter),
                backgroundImage: new PathBinding(material, "map.image", new UrlStringConverter()),
                backgroundBlendMode: "multiply",
                backgroundSize: "contain",
            },
            onclick: () => {
                this.dataContent.editingMaterial = material;
            },
            ondblclick: () => {
                this.dataContent.callback(material);
                this.remove();
            },
        });
    }

    private buttons() {
        return div(
            { className: style.bottom },
            button({
                textContent: new Localize("common.confirm"),
                onclick: () => {
                    this.dataContent.callback(this.dataContent.editingMaterial);
                    this.remove();
                },
            }),
            button({
                textContent: new Localize("common.cancel"),
                onclick: () => this.remove(),
            }),
        );
    }

    connectedCallback() {
        this.dataContent.onPropertyChanged(this._onEditingMaterialChanged);
        PubSub.default.sub("showProperties", this._handleShowProperty);
    }

    disconnectedCallback() {
        PubSub.default.remove("showProperties", this._handleShowProperty);
    }

    private readonly _handleShowProperty = () => {
        this.remove();
    };

    private readonly _onEditingMaterialChanged = (property: keyof MaterialDataContent) => {
        if (property !== "editingMaterial") return;
        this.editingControl.firstChild?.remove();
        this.initEditingControl(this.dataContent.editingMaterial);
    };

    private initEditingControl(material: Material) {
        this.editingControl.innerHTML = "";

        const isTexture = (p: Property) => {
            return (material as any)[p.name] instanceof Texture;
        };

        let properties = Property.getProperties(material);
        this.editingControl.append(
            ...properties
                .filter((x) => !isTexture(x))
                .map((x) => findPropertyControl(this.dataContent.document, [material], x)),
            ...properties
                .filter(isTexture)
                .map((x) => findPropertyControl(this.dataContent.document, [material], x)),
        );
    }
}

customElements.define("material-editor", MaterialEditor);
