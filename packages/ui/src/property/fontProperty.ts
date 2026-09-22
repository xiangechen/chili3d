// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type PickedFont,
    type Property,
    PubSub,
    pickTextFont,
    type Result,
} from "@chili3d/core";
import { button, div } from "@chili3d/element";
import style from "./fontProperty.module.css";
import { PropertyBase } from "./propertyBase";

/** A text holder: an object set in a font, which can draw itself in another. */
interface FontHolder {
    fontName: string;
    useFont?(font: PickedFont): Promise<Result<void>>;
}

/**
 * The font a text is set in: the one it already has, and a way to pick another.
 *
 * There is no list of the document's fonts here because a document keeps none — a
 * node holds the outlines it drew plus the name and address of the font it drew
 * them in, so a font is chosen from what can actually be had: the fonts installed
 * on this machine, the ones the catalogue can fetch, and a file.
 *
 * Switching fonts is not just assigning a name — a node keeps the outlines it was
 * drawn with, so it has to be asked to draw itself again. That is done by looking
 * for the method rather than by type, since a property panel works on whatever
 * objects it was handed.
 */
export class FontProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: FontHolder[],
        readonly property: Property,
    ) {
        super(objects);
        this.append(this.render());
    }

    private get holders(): FontHolder[] {
        return this.objects as FontHolder[];
    }

    private render() {
        return div(
            { className: style.root },
            button({
                className: style.font,
                textContent: this.holders[0].fontName,
                onclick: () => void this.choose(),
            }),
        );
    }

    private async choose(): Promise<void> {
        const picked = await pickTextFont();
        if (!picked.isOk) return;

        const failed = await Promise.all(this.holders.map((holder) => assign(holder, picked.value)));

        this.document.visual.update();
        // The panel is rebuilt rather than patched: the row shows the font's name,
        // which only the objects themselves know after they have drawn in it.
        PubSub.default.pub("showProperties", this.document, this.document.selection.getSelectedNodes());
        if (failed.every((ok) => ok)) return;

        PubSub.default.pub("showToast", "toast.text.fontUnavailable");
    }
}

/**
 * Set an object in a font. An object that can draw itself again does; one that
 * only holds a name takes the name.
 */
async function assign(holder: FontHolder, font: PickedFont): Promise<boolean> {
    if (holder.useFont === undefined) {
        holder.fontName = font.name;
        return true;
    }

    const done = await holder.useFont(font);
    return done.isOk;
}

customElements.define("chili-font-property", FontProperty);
