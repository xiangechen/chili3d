// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, Expander, img, svg } from "chili-controls";
import { UrlStringConverter } from "chili-controls/src/converters/urlConverter";
import {
    type I18nKeys,
    type IDocument,
    PathBinding,
    PropertyUtils,
    readFileAsync,
    type Texture,
} from "chili-core";
import { basicPropertyControl } from "./basicPropertyControl";
import style from "./textureProperty.module.css";

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
        const properties = PropertyUtils.getProperties(this.texture)
            .filter((x) => (x.name as keyof Texture) !== "image")
            .map((x) => basicPropertyControl(this.document, [this.texture], x));

        return div(
            { className: style.expander },
            div({ className: style.properties }, ...properties),
            div(
                { className: style.image },
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
        const file = await readFileAsync(".png, .jpg, .jpeg", false, "readAsDataURL");
        this.texture.image = file.value[0].data;
    };
}

customElements.define("texture-editor", TextureProperty);
