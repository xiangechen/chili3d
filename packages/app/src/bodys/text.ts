// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    cachedOutline,
    cacheOfOutline,
    codePointsOf,
    type FontOutline,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    LENGTH_UNITS,
    Logger,
    outlineFor,
    outlineFromCache,
    outlineOfPicked,
    ParameterShapeNode,
    type PickedFont,
    type Plane,
    PubSub,
    property,
    Result,
    serializable,
    serialize,
    textSolid,
    type XYZ,
} from "@chili3d/core";

export interface TextNodeOptions {
    document: IDocument;
    plane: Plane;
    text: string;
    size: number;
    depth: number;
    fontName: string;
    /** Where the font can be fetched, empty for one that came off a disk. */
    fontUrl: string;
    /**
     * The outlines of every character in `text`, in font units.
     *
     * A node keeps these rather than the font they came from, because it has to
     * build its shape synchronously — at load, on undo, on any edit — and the
     * font is a file that has to be fetched and parsed first. Text that was drawn
     * once therefore redraws with no font at all; only *changing* the text needs
     * one back.
     */
    outlines: string;
    /** A curve to follow; without one the text lies on `plane`. */
    path?: IEdge | IWire;
}

/**
 * A line of text as a solid. The characters are extruded together and left as
 * one compound — separate glyphs are separate pieces, and fusing them would cost
 * a boolean per pair for a body nobody asked to be a single one.
 */
@serializable()
export class TextNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.text";
    }

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }
    set plane(value: Plane) {
        this.setPropertyEmitShapeChanged("plane", value);
    }

    @property("common.location")
    get location() {
        return this.plane.origin;
    }
    set location(value: XYZ) {
        this.plane = this.plane.translateTo(value);
    }

    @serialize()
    @property("text.content")
    get text(): string {
        return this.getPrivateValue("text");
    }
    set text(value: string) {
        if (!this.setPropertyEmitShapeChanged("text", value)) return;

        // The node's own outlines only cover the characters it was drawn with, so
        // a new character has no glyph to draw. The font knows it, and a font
        // parsed once stays parsed — so lay the text out again from it, now if it
        // is at hand and as soon as it arrives if it is not.
        const outline = cachedOutline(this.fontName, this.fontUrl);
        if (outline !== undefined) {
            this.drawIn(this.fontName, this.fontUrl, outline);
            return;
        }

        void outlineFor(this.fontName, this.fontUrl).then((font) => {
            if (this.text !== value) return;
            if (font.isOk) {
                this.drawIn(this.fontName, this.fontUrl, font.value);
                return;
            }

            // The font is out of reach, so the characters just typed have no
            // glyphs. Saying so beats drawing a text that quietly lost them.
            Logger.warn(font.error);
            PubSub.default.pub("showToast", "toast.text.fontMissing");
        });
    }

    @serialize()
    @property("text.size", { unit: LENGTH_UNITS })
    get size(): number {
        return this.getPrivateValue("size");
    }
    set size(value: number) {
        this.setPropertyEmitShapeChanged("size", value);
    }

    @serialize()
    @property("text.depth", { unit: LENGTH_UNITS })
    get depth(): number {
        return this.getPrivateValue("depth");
    }
    set depth(value: number) {
        this.setPropertyEmitShapeChanged("depth", value);
    }

    /**
     * The font the text is set in. Only its name and address are kept: the
     * outlines above are what the shape is drawn from, and the font itself is
     * only needed again to lay the text out after it is retyped.
     */
    @serialize()
    @property("font.select", { type: "font" })
    get fontName(): string {
        return this.getPrivateValue("fontName");
    }
    set fontName(value: string) {
        this.setPrivateValue("fontName", value);
    }

    @serialize()
    get fontUrl(): string {
        return this.getPrivateValue("fontUrl", "");
    }
    set fontUrl(value: string) {
        this.setPrivateValue("fontUrl", value);
    }

    @serialize()
    get outlines(): string {
        return this.getPrivateValue("outlines");
    }
    set outlines(value: string) {
        this.setPrivateValue("outlines", value);
    }

    @serialize()
    get path(): IEdge | IWire | undefined {
        return this.getPrivateValue("path", undefined);
    }
    set path(value: IEdge | IWire | undefined) {
        this.setPropertyEmitShapeChanged("path", value);
    }

    constructor(options: TextNodeOptions) {
        super(options);
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue("text", options.text);
        this.setPrivateValue("size", options.size);
        this.setPrivateValue("depth", options.depth);
        this.setPrivateValue("fontName", options.fontName);
        this.setPrivateValue("fontUrl", options.fontUrl);
        this.setPrivateValue("outlines", options.outlines);
        this.setPrivateValue("path", options.path);
    }

    generateShape(): Result<IShape> {
        const font = this.outlineOf();
        if (!font.isOk) return Result.err(font.error);

        return textSolid(font.value, {
            text: this.text,
            size: this.size,
            depth: this.depth,
            plane: this.plane,
            path: this.path,
        });
    }

    /**
     * The node's own outlines. They arrive as JSON in a document, so anything
     * could be in that string — a node that was saved by a later version, or one
     * whose font never made it into the document — and building a shape from it
     * must fail as an error rather than take the document down with it.
     */
    private outlineOf(): Result<FontOutline> {
        if (this.outlines.length === 0) {
            return Result.err("This text has no font — set one to draw it");
        }

        try {
            return Result.ok(outlineFromCache(JSON.parse(this.outlines)));
        } catch (error) {
            return Result.err(`This text's outlines could not be read: ${error}`);
        }
    }

    /**
     * Draw the text in a font the user picked — what the font row runs.
     *
     * The bytes a picked file comes with are what makes this work for a font that
     * has no address at all; a catalogue font is fetched by address instead, and
     * remembered so the next retype costs nothing.
     */
    async useFont(picked: PickedFont): Promise<Result<void>> {
        const outline = await outlineOfPicked(picked);
        if (!outline.isOk) return Result.err(outline.error);

        this.drawIn(picked.name, picked.url ?? "", outline.value);
        return Result.ok(undefined);
    }

    /** Re-lay the text out in a font and keep the outlines it was drawn from. */
    drawIn(fontName: string, fontUrl: string, outline: FontOutline): void {
        this.outlines = JSON.stringify(cacheOfOutline(outline, codePointsOf(this.text)));
        this.setPrivateValue("fontName", fontName);
        this.setPrivateValue("fontUrl", fontUrl);
        this.setShape(this.generateShape());
    }
}
