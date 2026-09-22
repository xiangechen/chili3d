// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    cacheOfOutline,
    codePointsOf,
    command,
    DefaultFont,
    Dimensions,
    defaultTextFont,
    extrudeTextShape,
    type FontOutline,
    type GeometryNode,
    GeometryUtils,
    type I18nKeys,
    type IEdge,
    type IFace,
    type IStep,
    type IWire,
    LENGTH_UNITS,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    Logger,
    outlineOfPicked,
    type ParameterValue,
    type PickedFont,
    Plane,
    type PointSnapData,
    PointStep,
    Precision,
    PubSub,
    pickTextFont,
    property,
    Result,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    type TextShape,
    textShape,
    type XYZ,
} from "@chili3d/core";
import { TextNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

const PLACEMENTS = ["option.text.placement.point", "option.text.placement.path"] as const;

/**
 * Write a line of text as a solid.
 *
 * The font is chosen before the first step rather than beside the other
 * parameters, because nothing can be drawn without one — the panel's font row
 * reopens the picker for text that is already placed.
 *
 * Three points place the text, as they place a box: the first is the corner the
 * line starts at, and lies in the plane that point is in — the flat face it
 * snapped to, or the working plane when it snapped to nothing — the second says
 * which way along that plane the line runs, and the third how tall it stands,
 * measured off the baseline. That is why there is no separate "on a face" mode:
 * snapping already says which face, and asking the user to say it twice let the
 * two answers disagree. The height is the one dimension of a line of text that a
 * point says better than a number does: pointing at a corner already in the model
 * makes the text exactly as tall as what is there.
 */
@command({
    key: "create.text",
    icon: "icon-text",
})
export class TextCommand extends CreateCommand {
    private font?: FontOutline;
    /** Where the font in use can be fetched; empty for one off the user's disk. */
    private fontUrl = "";
    /** What the step draws its preview with, for as long as it is the one being placed into. */
    private snapRedraw?: () => void;

    /** The font in use, shown on the panel's font row. */
    @property("font.select", { type: "font" })
    get fontName(): string {
        return this.getPrivateValue("fontName", DefaultFont.family);
    }
    set fontName(value: string) {
        this.setProperty("fontName", value);
    }

    @property("text.size", { unit: LENGTH_UNITS })
    get size(): ParameterValue {
        return this.getPrivateValue("size", 10);
    }
    set size(value: ParameterValue) {
        this.setProperty("size", value);
    }

    @property("option.text.placement", { combobox: Combobox.from([...PLACEMENTS]) })
    get placement(): I18nKeys {
        return this.getPrivateValue("placement", PLACEMENTS[0]);
    }
    set placement(value: I18nKeys) {
        // The steps ask for different things, so the placement is settled first.
        this.setProperty("placement", value, () => void this.restart());
    }

    @property("text.content")
    get text(): string {
        return this.getPrivateValue("text", "Text");
    }
    set text(value: string) {
        this.setProperty("text", value);
    }

    /**
     * Draw the text in a font the user picks instead of the default — what the
     * panel's font row runs.
     */
    async chooseFont(): Promise<Result<void>> {
        const picked = await pickTextFont();
        if (!picked.isOk) return Result.err(picked.error);

        return this.loadFont(picked.value);
    }

    /**
     * Nothing to draw with yet, so take the default font rather than asking. The
     * steps come after this, and a font that cannot be had has to say so: ending
     * the command in silence reads as a command that does not work.
     */
    protected override async canExcute(): Promise<boolean> {
        if (this.font !== undefined) return true;
        return (await this.loadFont(defaultTextFont())).isOk;
    }

    /**
     * Take a font, keep it in the document, and lay text out in it.
     *
     * The font goes into the document rather than onto the node because a text
     * node keeps only its own outlines: the font is what lets the text be typed
     * again later, on a machine that has never seen the file. A font parsed once
     * is remembered for the session, so a second run of the command costs
     * nothing — and the whole default download happens only the first time.
     */
    private async loadFont(picked: PickedFont): Promise<Result<void>> {
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

    protected override geometryNode(): GeometryNode {
        const font = this.font;
        if (font === undefined) throw new Error("A font is needed before text can be drawn");

        const size = this.resolveParameter(this.size, LENGTH_UNITS);
        if (!size.isOk) throw new Error(size.error);

        return new TextNode({
            document: this.document,
            plane: this.planeOf(),
            text: this.text,
            size: size.value,
            depth: this.textDepth(),
            fontName: this.fontName,
            fontUrl: this.fontUrl,
            outlines: JSON.stringify(cacheOfOutline(font, codePointsOf(this.text))),
            path: this.pathOf(),
        });
    }

    protected override getSteps(): IStep[] {
        if (this.placement === "option.text.placement.path") {
            return [
                new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.path"),
                new LengthAtAxisStep("prompt.pickNextPoint", this.depthData),
            ];
        }

        return [
            new PointStep("prompt.pickFistPoint"),
            new PointStep("prompt.text.direction", this.directionData),
            new LengthAtAxisStep("prompt.pickNextPoint", this.depthData),
        ];
    }

    /**
     * The second point says which way the line runs, so it is asked for in the
     * plane the text is to stand on, and it must not be the first point again.
     */
    private readonly directionData = (): PointSnapData => ({
        refPoint: () => this.stepDatas[0].point!,
        dimension: Dimensions.D1D2D3,
        plane: () => this.planeOf(),
        validator: (point: XYZ) => this.stepDatas[0].point!.distanceTo(point) > Precision.Distance,
        preview: this.textPreview,
        // What the preview is made of is this command's own parameters, so the preview
        // follows them: another line of text, another height, draws it again in place
        // instead of waiting for the pointer to move. The command keeps what it was
        // handed, so that it can stop following when the step says it is over.
        onPreviewReady: (redraw) => {
            this.snapRedraw = redraw;
            this.onPropertyChanged(redraw);
        },
        // Letting go is `afterExecute`'s: it runs when the step's handler is done with.
        afterExecute: () => {
            if (this.snapRedraw === undefined) return;
            this.removePropertyChanged(this.snapRedraw);
            this.snapRedraw = undefined;
        },
    });

    /**
     * Where the depth is measured from, and which way it runs: off the plane the text lies in,
     * along that plane's normal — which is how a box's third point gives its height, and the
     * way the text is about to be extruded. A path lies in a plane of its own, and the frames
     * the text is set on stand upright in it.
     */
    private textDepthFrame(): { anchor: XYZ; normal: XYZ } {
        if (this.placement === "option.text.placement.path") {
            const plane = this.pathPlane();
            return { anchor: this.stepDatas[0].point ?? plane.origin, normal: plane.normal };
        }
        return { anchor: this.stepDatas[1].point!, normal: this.planeOf().normal };
    }

    /**
     * The last point asked for, either way the text is placed: how deep it is, which is how
     * far it stands off the plane it lies in.
     */
    private readonly depthData = (): LengthAtAxisSnapData => {
        const { anchor, normal } = this.textDepthFrame();
        return { point: anchor, direction: normal, preview: this.depthPreview };
    };

    /**
     * How far a point stands off a plane through `from`, read as a sliver rather than as none
     * when it lands on it: the extrude refuses a depth of nothing, and the pointer crosses the
     * plane on its way past it.
     */
    private alongNormal(point: XYZ, from: XYZ, normal: XYZ): number {
        const distance = point.sub(from).dot(normal);
        if (Math.abs(distance) < Precision.Distance) return distance < 0 ? -0.00001 : 0.00001;
        return distance;
    }

    /** How far a point stands off the text's own plane, which is the depth it asks for. */
    private depthOf(point: XYZ): number {
        const { anchor, normal } = this.textDepthFrame();
        return this.alongNormal(point, anchor, normal);
    }

    /**
     * The text drawn as far out as the pointer stands, so the depth being pointed at is the
     * depth seen. Until the pointer is off the plane there is no depth to read and what is
     * drawn is the flat text — as it is on the way there, and as it is when it will not draw.
     */
    private readonly depthPreview = (point: XYZ | undefined) => {
        const { anchor, normal } = this.textDepthFrame();
        const alongPath = this.placement === "option.text.placement.path";
        const towards = this.stepDatas[1]?.point;
        // The points already picked stay in view while their depth is pointed at; along a
        // path there are none to show, and what the viewport draws is the path itself.
        const marks =
            alongPath || towards === undefined ? [] : [this.meshPoint(anchor), this.meshPoint(towards)];

        const shape = this.previewShape(alongPath ? undefined : towards);
        if (!shape.isOk) return marks;
        if (point === undefined) return [...marks, this.meshShape(shape.value.faces)];

        const solid = extrudeTextShape(shape.value, this.alongNormal(point, anchor, normal));
        return solid.isOk
            ? [...marks, this.meshShape(solid.value)]
            : [...marks, this.meshShape(shape.value.faces)];
    };

    /**
     * The text itself, drawn where the second point would put it.
     *
     * Placing text is the one command where the preview has to be the real thing:
     * the direction and the size are what the user is looking at, and a line from
     * the first point says nothing about either. It is the *flat* text — what the
     * third point decides is how far it is pushed out, which is not what is being
     * settled here, and leaving the extrusion off keeps the rebuild cheap enough to
     * follow the pointer.
     */
    private readonly textPreview = (point: XYZ | undefined) => {
        const start = this.stepDatas[0].point;
        if (start === undefined) return [];
        if (point === undefined) return [this.meshPoint(start)];

        const shape = this.previewShape(point);
        return shape.isOk
            ? [this.meshPoint(start), this.meshShape(shape.value.faces)]
            : [this.meshPoint(start), this.meshLine(start, point)];
    };

    /**
     * The text as it would be drawn toward `towards`. A font that cannot be had,
     * or a size that will not resolve, leaves nothing to draw — the baseline the
     * caller falls back to at least keeps the interaction legible.
     */
    private previewShape(towards?: XYZ): Result<TextShape> {
        const font = this.font;
        if (font === undefined) return Result.err("A font is needed before text can be drawn");

        const size = this.resolveParameter(this.size, LENGTH_UNITS);
        if (!size.isOk) return Result.err(size.error);

        return textShape(font, {
            text: this.text,
            size: size.value,
            // Along a path the path decides where the text sits; the plane only says which
            // side of it the text stands on.
            plane: towards === undefined ? this.pathPlane() : this.turnedTowards(this.basePlane(), towards),
            path: this.pathOf(),
        });
    }

    /** How deep the text is: what the depth step's point says, either way it was placed. */
    private textDepth(): number {
        const { anchor, normal } = this.textDepthFrame();
        return this.alongNormal(this.stepDatas.at(-1)!.point!, anchor, normal);
    }

    /**
     * The plane the text stands on.
     *
     * A point on a curved face has no plane of its own: the tangent there is not a
     * surface the text could lie in, so it falls back to the working plane rather
     * than drawing text on a plane that only touches the face at the seam.
     *
     * The second point turns the plane's own x axis to run toward it, which is how
     * a line of text is set at an angle on a face. While that point is still being
     * picked there is none to turn toward, so the plane answers with its own axes.
     */
    private planeOf(): Plane {
        return this.placement === "option.text.placement.path"
            ? this.pathPlane()
            : this.turnedTowards(this.basePlane(), this.stepDatas[1]?.point);
    }

    /**
     * The plane the text is to stand on, before the second point has a say: the
     * flat face the first point snapped to, or the working plane when it snapped
     * to nothing — anchored at that point, since it is where the line starts.
     */
    private basePlane(): Plane {
        const { point, shapes, view } = this.stepDatas[0];
        const flat = this.snappedFace(shapes);
        return (flat ?? view.workplane).translateTo(point!);
    }

    /** Along a path the text still needs a plane: it decides which side the text stands on. */
    private pathPlane(): Plane {
        const { point, view } = this.stepDatas[0];
        return view.workplane.translateTo(point ?? view.workplane.origin);
    }

    /**
     * The plane's x axis turned to run from its origin toward a point. A point that
     * says nothing about direction — one on the plane's own axis, or on the origin
     * itself — leaves the plane as it was, since there is no direction to read.
     */
    private turnedTowards(plane: Plane, towards: XYZ | undefined): Plane {
        if (towards === undefined) return plane;

        const along = towards.sub(plane.origin);
        const inPlane = along.sub(plane.normal.multiply(along.dot(plane.normal)));
        return inPlane.length() < Precision.Distance
            ? plane
            : new Plane({ origin: plane.origin, normal: plane.normal, xvec: inPlane });
    }

    /** The face a pick landed on, when it is a flat one. */
    private snappedFace(shapes: SnapResult["shapes"]): Plane | undefined {
        const shape = shapes.find((x) => x.shape.shapeType === ShapeTypes.face);
        if (shape === undefined) return undefined;

        const face = shape.shape.transformedMul(shape.transform) as IFace;
        return face.surface().isPlanar() ? GeometryUtils.planeFromFace(face) : undefined;
    }

    private pathOf(): IEdge | IWire | undefined {
        if (this.placement !== "option.text.placement.path") return undefined;

        // The node keeps the curve and reads it again on every rebuild, so the command must
        // not take it away on the way out — the same hand-over the commands that build a
        // SweepNode, a RevolveNode or a body extrude along a section make.
        return this.transformdFirstShape(this.stepDatas[0], false) as IEdge | IWire;
    }
}
