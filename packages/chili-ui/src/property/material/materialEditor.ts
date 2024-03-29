// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ColorConverter, IConverter, Material, Property, PubSub, Result, readFileAsync } from "chili-core";
import { Binding, button, div, img, items, localize, span, svg } from "../../controls";
import { appendProperty } from "../utils";
import { MaterialDataContent } from "./materialDataContent";
import style from "./materialEditor.module.css";

class ActiveStyleConverter implements IConverter<Material> {
    constructor(readonly material: Material) {}

    convert(value: Material): Result<string> {
        return Result.success(
            this.material === value ? `${style.material} ${style.active}` : style.material,
        );
    }
}

class UrlStringConverter implements IConverter<string> {
    convert(value: string): Result<string> {
        return Result.success(`url('${value}')`);
    }
}

export class MaterialEditor extends HTMLElement {
    private editingControl: HTMLElement;
    private readonly colorConverter = new ColorConverter();

    constructor(readonly dataContent: MaterialDataContent) {
        super();
        this.editingControl = div();
        this.initEditingControl(dataContent.editingMaterial);
        this.append(
            div(
                {
                    className: style.root,
                },
                div(
                    { className: style.title },
                    span({
                        textContent: localize("common.material"),
                    }),
                    svg({
                        icon: "icon-plus",
                        onclick: () => {
                            this.dataContent.addMaterial();
                        },
                    }),
                    svg({
                        icon: "icon-clone",
                        onclick: () => {
                            this.dataContent.copyMaterial();
                        },
                    }),
                    svg({
                        icon: "icon-times",
                        onclick: () => {
                            this.dataContent.deleteMaterial();
                        },
                    }),
                ),
                items({
                    className: style.materials,
                    sources: this.dataContent.document.materials,
                    template: (material: Material) =>
                        span({
                            className: new Binding(
                                this.dataContent,
                                "editingMaterial",
                                new ActiveStyleConverter(material),
                            ),
                            title: material.name,
                            style: {
                                backgroundColor: new Binding(material, "color", this.colorConverter),
                                background: new Binding(material, "texture", new UrlStringConverter()),
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
                        }),
                }),
                this.editingControl,
                div(
                    {
                        className: style.bottom,
                    },
                    button({
                        textContent: localize("common.confirm"),
                        onclick: () => {
                            this.dataContent.callback(this.dataContent.editingMaterial);
                            this.remove();
                        },
                    }),
                    button({
                        textContent: localize("common.cancel"),
                        onclick: () => {
                            this.remove();
                        },
                    }),
                ),
            ),
        );
    }

    connectedCallback() {
        this.dataContent.onPropertyChanged(this._onEditingMaterialChanged);
        PubSub.default.sub("showProperties", this._handleShowProperty);
    }

    disconnectedCallback() {
        PubSub.default.remove("showProperties", this._handleShowProperty);
    }

    private _handleShowProperty = () => {
        this.remove();
    };

    private _onEditingMaterialChanged = (property: keyof MaterialDataContent) => {
        if (property !== "editingMaterial") return;
        this.editingControl.firstChild?.remove();
        this.initEditingControl(this.dataContent.editingMaterial);
    };

    private initEditingControl(material: Material) {
        let container = div({
            className: style.properties,
        });
        this.editingControl.appendChild(
            div(
                {
                    className: style.editing,
                },
                container,
                div(
                    {
                        className: style.texture,
                    },
                    img({
                        style: {
                            backgroundSize: "contain",
                            backgroundImage: new Binding(material, "texture", new UrlStringConverter()),
                        },
                        onclick: async () => {
                            let file = await readFileAsync(".png, .jpeg", false, "readAsDataURL");
                            material.texture = file.unwrap()[0].data;
                        },
                    }),
                    span({
                        textContent: localize("material.texture"),
                    }),
                    svg({
                        icon: "icon-times",
                        onclick: () => {
                            material.texture = "";
                        },
                    }),
                ),
            ),
        );

        Property.getProperties(material).forEach((x) => {
            appendProperty(container, this.dataContent.document, [material], x);
        });
    }
}

customElements.define("material-editor", MaterialEditor);
