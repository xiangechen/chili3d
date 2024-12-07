// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, PathBinding, Property, readFileAsync, Texture } from "chili-core";
import { div, Expander, img, svg } from "../../components";
import { findPropertyControl } from "../utils";
import style from "./textureEditor.module.css";
import { UrlStringConverter } from "./urlConverter";

export class TextureProperty extends Expander {
    constructor(
        readonly document: IDocument,
        display: I18nKeys,
        readonly texture: Texture,
    ) {
        super(display);
        this.classList.add(style.root);
        this.append(this.render());
    }

    private render() {
        return div(
            {
                className: style.expander,
            },
            div(
                { className: style.properties },
                ...Property.getProperties(this.texture).map((x) => {
                    if ((x.name as keyof Texture) === "image") return "";
                    return findPropertyControl(this.document, [this.texture], x);
                }),
            ),
            div(
                {
                    className: style.image,
                },
                img({
                    style: {
                        backgroundImage: new PathBinding(this.texture, "image", new UrlStringConverter()),
                        backgroundSize: "contain",
                    },
                    onclick: this.selectTexture,
                }),
                svg({
                    icon: "icon-times",
                    onclick: () => {
                        this.texture.image = "";
                    },
                }),
            ),
        );
    }

    private readonly selectTexture = async () => {
        let file = await readFileAsync(".png, .jpg, .jpeg", false, "readAsDataURL");
        this.texture.image = file.value[0].data;
    };
}

customElements.define("texture-editor", TextureProperty);
