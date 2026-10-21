// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    DefaultFont,
    Dimensions,
    defaultTextFont,
    FontCatalog,
    type FontOutline,
    type IStep,
    LENGTH_UNITS,
    Logger,
    outlineOfPicked,
    type ParameterValue,
    type PickedFont,
    Precision,
    PubSub,
    pickTextFont,
    property,
    Result,
    type ShapeMeshData,
    VisualConfig,
    type XYZ,
} from "@chili3d/core";
import { SKETCH_EDGE_LINE_WIDTH, type SketchTextData, toUV } from "../sketchModel";
import { fusedTextContours, layoutTextContours, textContoursMesh } from "../sketchText";
import { SketchMultistepCommand } from "./sketchMultistepCommand";
import { type SketchPointSnapData, SketchPointStep } from "./sketchPointStep";

/** The height a fresh text starts at — the property default and the preview's fallback. */
const DEFAULT_TEXT_SIZE = 20;

/**
 * Places a line of text on the sketch: a first pick for the anchor the baseline starts
 * at, and a second for the top the letters stand up to — the vector from the anchor to
 * the second pick is the text's up direction, its length the em height, so dragging
 * straight up places horizontal text in one go. A second pick that lands on the anchor
 * says neither, and the panel's height, unrotated, is what the text falls back to. The
 * string and its font are panel properties — set before or while picking, the preview
 * following every edit — and the placed glyphs are real sketch geometry: they extrude
 * with the profile they land in, and the anchor drags, constrains and dimensions like
 * any entity point. One placement per run.
 *
 * What is stored is each glyph's strokes merged into their union (`fusedTextContours`): a
 * font states a glyph as one contour per stroke, and crossing strokes would otherwise read
 * as extra sketch geometry that the profile rule punches holes through.
 *
 * The font is loaded before the first pick rather than beside the other parameters,
 * because nothing can be drawn without one — `TextCommand` makes the same call. A font
 * parsed once is remembered for the session, so a second run of the command costs nothing.
 */
@command({ key: "sketch.text", icon: "icon-text" })
export class SketchTextCommand extends SketchMultistepCommand {
    private font?: FontOutline;
    /** Where the font in use can be fetched; empty for one off the user's disk. */
    private fontUrl = "";
    /** The preview's laid-out spec of the current (font, text, size) — see `laidOutSpec`. */
    private laidOut?: { font: FontOutline; text: string; size: number; spec: SketchTextData };
    /** What the step draws its preview with, for as long as it is the one being picked into. */
    private snapRedraw?: () => void;

    @property("text.content")
    get text(): string {
        return this.getPrivateValue("text", "Text");
    }
    set text(value: string) {
        this.setProperty("text", value);
    }

    @property("text.size", { unit: LENGTH_UNITS })
    get size(): ParameterValue {
        return this.getPrivateValue("size", DEFAULT_TEXT_SIZE);
    }
    set size(value: ParameterValue) {
        this.setProperty("size", value);
    }

    /** The font in use, shown on the panel's font row. */
    @property("font.select", { type: "font" })
    get fontName(): string {
        return this.getPrivateValue("fontName", DefaultFont.family);
    }
    set fontName(value: string) {
        this.setProperty("fontName", value);
    }

    /** Draw the text in a font the user picks instead — what the panel's font row runs. */
    async chooseFont(): Promise<Result<void>> {
        const picked = await pickTextFont();
        if (!picked.isOk) return Result.err(picked.error);
        return this.useFont(picked.value);
    }

    /** Draw in a font the panel's font row picked — the `FontHolder` contract the row calls. */
    async useFont(picked: PickedFont): Promise<Result<void>> {
        const outline = await outlineOfPicked(picked);
        if (!outline.isOk) {
            Logger.warn(outline.error);
            PubSub.default.pub("showToast", "toast.text.fontFailed");
            return Result.err(outline.error);
        }

        this.font = outline.value;
        this.fontUrl = picked.url ?? "";
        this.fontName = picked.name;
        return Result.ok(undefined);
    }

    /**
     * Nothing to draw with yet, so take a font rather than asking: the one the persisted
     * name still stands for — the choice survives across runs — and the default when it
     * does not (a local file's font has no address to fetch again). A font that cannot be
     * had has to say so: ending the command in silence reads as a command that does not work.
     */
    protected override async canExcute(): Promise<boolean> {
        if (!(await super.canExcute())) return false;
        if (this.font !== undefined) return true;
        return (await this.useFont(this.persistedFont())).isOk;
    }

    /** The font the persisted name stands for, or the default when the name is not fetchable. */
    private persistedFont(): PickedFont {
        const catalog = FontCatalog.find((font) => font.family === this.fontName);
        return catalog === undefined ? defaultTextFont() : { name: catalog.family, url: catalog.url };
    }

    getSteps(): IStep[] {
        return [
            new SketchPointStep("prompt.pickTextPosition", this.getAnchorData),
            new SketchPointStep("prompt.text.height", this.getTopData),
        ];
    }

    protected async executeMainTask(): Promise<void> {
        const [u, v] = this.uvOf(0);
        const [du, dv] = this.uvOf(1);
        const placed = this.placementOf(u, v, du, dv);
        if (placed === undefined) return;
        // canExcute already said so with a toast when no font could be had
        const font = this.font;
        if (font === undefined) return;
        // The committed contours are the merged ones — each glyph's strokes fused into
        // their union (`fusedTextContours`) — while the preview drew the raw ones, which
        // is cheaper per pointer move. At stroke overlaps a preview pixel can therefore
        // differ from the edge that lands, deliberately.
        const contours = await fusedTextContours(font, this.text, placed.sizeMm);
        // a cancel that landed while the kernel merged must not commit after the fact
        if (this.checkCanceled()) return;
        if (!contours.isOk) {
            PubSub.default.pub("displayError", contours.error);
            return;
        }
        this.commitNewEntity(
            this.editor.solver.addText(u, v, placed.angle, {
                text: this.text,
                size: placed.sizeMm,
                fontName: this.fontName,
                fontUrl: this.fontUrl,
                contours: JSON.stringify(contours.value),
            }),
        );
    }

    /**
     * What the two picks place: the vector from the anchor to the second pick is the
     * text's UP direction — the way the tops of the letters point — and its length the
     * height, so the baseline runs at that vector turned a quarter turn back. A second
     * pick on the anchor itself says neither — the step's validator keeps a click from
     * landing there, but a typed zero still can — and the panel's height, unrotated,
     * answers instead. A height the pick did state becomes the panel's, so a repeat run
     * starts from it (the fallback path must NOT do this: the panel may hold an
     * expression, and overwriting it with its own resolved value would silently lose it).
     */
    private placementOf(
        u: number,
        v: number,
        du: number,
        dv: number,
    ): { sizeMm: number; angle: number } | undefined {
        const dist = Math.hypot(du - u, dv - v);
        if (dist >= Precision.Distance) {
            this.size = dist;
            return { sizeMm: dist, angle: Math.atan2(dv - v, du - u) - Math.PI / 2 };
        }
        const size = this.resolveParameter(this.size, LENGTH_UNITS);
        if (!size.isOk) {
            PubSub.default.pub("displayError", size.error);
            return undefined;
        }
        if (size.value <= 0) {
            PubSub.default.pub("displayError", "The text height must be positive");
            return undefined;
        }
        return { sizeMm: size.value, angle: 0 };
    }

    private readonly getAnchorData = (): SketchPointSnapData => this.snapData(this.anchorPreview);

    private readonly getTopData = (): SketchPointSnapData => ({
        ...this.snapData(this.topPreview),
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2,
    });

    /**
     * The step wiring both picks share: what the preview is made of is this command's own
     * properties, so it follows them — another string, height or font draws it again in
     * place instead of waiting for the pointer to move. `onPreviewReady` takes the step's
     * redraw when its handler starts, `afterExecute` lets it go when the handler is done —
     * and a step's letting go runs before the next step's hand-over, so the one
     * `snapRedraw` slot passes cleanly between the two picks.
     */
    private snapData(preview: (point: XYZ | undefined) => ShapeMeshData[]): SketchPointSnapData {
        return {
            preview,
            onPreviewReady: (redraw) => {
                this.snapRedraw = redraw;
                this.onPropertyChanged(redraw);
            },
            afterExecute: () => {
                if (this.snapRedraw === undefined) return;
                this.removePropertyChanged(this.snapRedraw);
                this.snapRedraw = undefined;
            },
        };
    }

    /**
     * The anchor pick's preview: the text at the probe, horizontal at the panel's height —
     * before a direction pick exists, there is no vector to say more.
     */
    private readonly anchorPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        if (point === undefined) return [];
        return this.textPreviewMesh(toUV(this.editor.node.plane, point), 0, this.previewSize());
    };

    /**
     * The top pick's preview: the text at the anchor, standing up toward the probe and
     * as tall as the probe is far from it — the probe rides the letters' tops. While the
     * probe sits on the anchor there is no up direction to read yet — the panel's height,
     * unrotated, so the first frame is not empty.
     */
    private readonly topPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const anchor = this.stepDatas[0]?.point;
        if (anchor === undefined) return [];
        const mark = this.meshPoint(anchor);
        if (point === undefined) return [mark];
        const plane = this.editor.node.plane;
        const anchorUv = toUV(plane, anchor);
        const probe = toUV(plane, point);
        const dist = Math.hypot(probe[0] - anchorUv[0], probe[1] - anchorUv[1]);
        const picked = dist >= Precision.Distance;
        return [
            mark,
            ...this.textPreviewMesh(
                anchorUv,
                picked ? Math.atan2(probe[1] - anchorUv[1], probe[0] - anchorUv[0]) - Math.PI / 2 : 0,
                picked ? dist : this.previewSize(),
            ),
        ];
    };

    /**
     * The height a preview draws at: the panel's, resolved — or the default when it will
     * not resolve (an expression still being typed previews rather than not at all; the
     * commit resolves it for real and says so when it cannot).
     */
    private previewSize(): number {
        const resolved = this.resolveParameter(this.size, LENGTH_UNITS);
        return resolved.isOk && resolved.value > 0 ? resolved.value : DEFAULT_TEXT_SIZE;
    }

    /** The laid-out text as an edge mesh at anchor/angle — empty when there is nothing to draw. */
    private textPreviewMesh(anchor: [number, number], angle: number, sizeMm: number): ShapeMeshData[] {
        const spec = this.laidOutSpec(sizeMm);
        if (spec === undefined) return [];
        const mesh = textContoursMesh(
            this.editor.node.plane,
            { params: [...anchor, angle], text: spec },
            VisualConfig.defaultEdgeColor,
        );
        mesh.lineWidth = SKETCH_EDGE_LINE_WIDTH;
        return [mesh];
    }

    /**
     * The spec the PREVIEW draws: the contours laid out at `sizeMm` as the font states them,
     * stroke crossings included. Memoized per (font, text, size) — the preview asks on every
     * pointer move, and laying a line of glyphs out is not free. The commit re-lays the text
     * merged (`executeMainTask`), so what lands can differ from what was previewed exactly at
     * the stroke overlaps — deliberately: the fuse costs more than the pointer moving can pay.
     * Undefined when the string lays out to nothing — nothing but spaces, or every glyph
     * missing from the font: there is no geometry to draw, and the preview simply has none.
     */
    private laidOutSpec(sizeMm: number): SketchTextData | undefined {
        const font = this.font;
        if (font === undefined) return undefined;
        const cached = this.laidOut;
        if (
            cached !== undefined &&
            cached.font === font &&
            cached.text === this.text &&
            cached.size === sizeMm
        ) {
            return cached.spec;
        }
        const contours = layoutTextContours(font, this.text, sizeMm);
        if (contours.length === 0) return undefined;
        const spec: SketchTextData = {
            text: this.text,
            size: sizeMm,
            fontName: this.fontName,
            fontUrl: this.fontUrl,
            contours: JSON.stringify(contours),
        };
        this.laidOut = { font, text: this.text, size: sizeMm, spec };
        return spec;
    }
}
