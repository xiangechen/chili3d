// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, PathBinding, Property, readFileAsync, Texture } from "chili-core";
import { div, Expander, img, svg } from "../../components";
import { appendProperty } from "../utils";
import style from "./textureEditor.module.css";
import { UrlStringConverter } from "./urlConverter";

export class TextureEditor extends Expander {
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
        let properties = div({ className: style.properties });
        Property.getProperties(this.texture).forEach((x) => {
            if ((x.name as keyof Texture) === "image") return;
            appendProperty(properties, this.document, [this.texture], x);
        });

        return div(
            {
                className: style.expander,
            },
            properties,
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

customElements.define("texture-editor", TextureEditor);
