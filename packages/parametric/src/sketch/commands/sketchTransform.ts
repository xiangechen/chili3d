// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    AsyncController,
    command,
    type EdgeMeshData,
    type IDocument,
    type IEventHandler,
    type IView,
    LENGTH_UNITS,
    MeshDataUtils,
    type ParameterValue,
    Precision,
    PubSub,
    type ShapeMeshData,
    UNITLESS,
    XYZ,
} from "@chili3d/core";
import { ARROW_HOVER_TOLERANCE, ARROW_LENGTH, distanceToSegment } from "../../commands/arrowHandle";
import { AxisDragHandler, type DragPreview } from "../../commands/axisDragHandler";
import { type DragSnap, snapConstraintKind, snapPosition } from "../autoConstraints";
import { applyConstraintIcon, badgeSymbol } from "../editor/sketchAnnotations";
import badgeStyle from "../editor/sketchAnnotations.module.css";
import { SketchEditor } from "../editor/sketchEditor";
import { additivePick, sketchEntityMesh } from "../editor/sketchEventHandler";
import { ConstraintKind, toStorageDatum, toUV, toWorld } from "../sketchModel";
import {
    isIdentityTransform,
    type SketchTransform,
    transformBase,
    transformEntities,
    transformPreview,
} from "../transformOps";
import { SketchConstraintCommand } from "./sketchConstraints";

/**
 * The transform's own cue, in the tone a proposal is drawn in: the moved geometry is not
 * on the sketch yet, so the preview is the only thing saying where it would land.
 */
const TRANSFORM_PREVIEW_COLOR = 0xfb7185;
const TRANSFORM_PREVIEW_LINE_WIDTH = 3;

/**
 * The glyphs are white with a dark outline — a drawing-tool look rather than a CAD triad's:
 * the fill matches the viewport's light chrome, the outline is what keeps the glyph readable
 * on the sketch's own geometry underneath. The outline is a uniform edge offset, so it reads
 * as a stroke rather than a shadow.
 */
const GLYPH_FILL = 0xffffff;

/**
 * The fill a glyph takes while the pointer is on it, or the one the gesture is dragging.
 * Not a pale wash of the accent: the idle fill is white, so a tint of the accent is barely
 * a different white, and the whole job of this colour is to say which of the four handles
 * the gesture has hold of. The accent itself, at full strength, is what does that.
 */
const GLYPH_FILL_ACTIVE = 0xf97316;

/** The outline every glyph is edged with. */
const OUTLINE_COLOR = 0x334155;

/** The outline's width, as a fraction of the frame's length — about 2px at the size drawn. */
const OUTLINE_WIDTH_RATIO = 0.024;

/** How much a glyph grows while the pointer is on it — the hover cue beside the fill wash. */
const HOVER_GROW = 1.12;

/** The accent the origin disc carries as its heart — the one spot of colour on the frame. */
const ACCENT_COLOR = GLYPH_FILL_ACTIVE;

/** Where the arrows start, as a multiple of their length: clear of the disc on the origin. */
const HANDLE_GAP_RATIO = 0.46;

/** How long the arrows are drawn, as a fraction of the frame's length — stubby, not sweeping. */
const ARROW_LENGTH_RATIO = 0.62;

/** The origin disc's radius, as a multiple of the arrows' length, and its accent heart's. */
const ORIGIN_DISC_RADIUS_RATIO = 0.1;
const ORIGIN_CORE_RATIO = 0.45;

/** How many segments a round glyph part is drawn with. */
const DISC_SEGMENTS = 32;

/**
 * The arc's stroke, in pixels, and the extra the darker line under it takes on each side. A
 * line is not a face and has no outline of its own, so its "outline" is a second, wider line
 * drawn first — two pixels of it showing past the one on top.
 */
const ARC_STROKE_WIDTH = 2.5;
const OUTLINE_LINE_WIDTH = 2;

/** The arc's own sampling — finer than the disc's, since it is a short sweep of a small circle. */
const ARC_SEGMENTS = 24;

/**
 * The arrow's proportions. The head is the solid triangle a dimension annotation closes with,
 * but fanned wider than one: the annotations draw at `DIMENSION_ARROW_HALF_ANGLE`, and an
 * arrowhead you are meant to *grab* wants more meat on it than one you are meant to read past.
 * The shaft is a straight stem, slim against that head — the head is what the eye finds.
 */
const ARROW_HEAD_RATIO = 0.34;
const ARROW_HEAD_HALF_ANGLE = (42 * Math.PI) / 180;
const ARROW_SHAFT_TO_HEAD = 0.2;

/**
 * The scale handle's mark — a plain triangle pointing the way the drag grows the geometry —
 * as a fraction of the arrows' length: base to tip.
 *
 * Kept well under the arrows' length on purpose. A triangle this size is already the widest
 * thing on the frame across, and being the only glyph that is a solid mass rather than a
 * stroke, it reads heavier than its outline does — at half the arrows' length it took the
 * whole triad over, and a handle is not meant to be the subject.
 */
const SCALE_MARK_RATIO = 0.3;

/**
 * How far out the scale mark sits, as a multiple of the arrows' length — its base, well clear
 * of the origin disc. Further out than the arrows start, because the mark is a shape rather
 * than a direction: crowding it against the origin makes it read as part of the disc instead
 * of as one of the four things to grab.
 */
const SCALE_MARK_GAP_RATIO = 1;

/**
 * The free-move mark: a square on the diagonal, out between the two arrows, dragged any way in
 * the plane at once. It sits where the scale mark used to, since a shape that goes both ways
 * at once belongs nearer the corner the two arrows share and the one that only grows outward
 * belongs past it — but only just past the origin disc, close enough to read as the corner the
 * arrows make rather than as a fourth thing out on its own.
 */
const FREE_MARK_GAP_RATIO = 0.62;
/** The square's half-size — its side is twice this. */
const FREE_MARK_SIZE_RATIO = 0.125;

/**
 * The rotate mark: a short arc with a small round knob riding its middle. Read as a dial — the
 * arc is the track the geometry swings along and the knob is what you take hold of — which
 * needs no arrowhead at all to say "turn".
 *
 * The radius as a fraction of the frame's length *is* the arc's own distance from the pivot,
 * so its circle runs through the origin: the curvature centre sits halfway between the two,
 * and the knob — which is what the hand takes hold of, and so what the frame places — is
 * twice the radius out. The half-angle is how much of that circle is drawn, and the knob's
 * radius is its own.
 *
 * The sweep is centred on the direction *away* from the origin, so the opening faces the pivot
 * and the +along arrow runs into it rather than into the arc.
 */
const ROTATE_ARC_RADIUS_RATIO = 0.62;
/**
 * How much of that circle is drawn, half either side of the knob. The one number that decides
 * whether the glyph reads as an arc at all: sagitta over chord is `tan(half) / 2` and depends
 * on nothing else, so shrinking the sweep is what flattens the mark — at 32° it came out at
 * 0.143 and read as a slanted line with a bead on it. 45° puts it at 0.207, which is curved
 * enough to see. It also sets how far the arc's ends reach back: at 45° they stop at 1.06L,
 * clear of the +along arrow's head, and the knob sits 6px off that arrow's tip.
 */
const ROTATE_ARC_SWEEP_HALF = (20 * Math.PI) / 180;
/**
 * The knob's radius. Small against the arc on purpose: the arc is a fifth of a ring and the
 * knob is what says where to take hold of it, so a knob that swallows the sweep stops being a
 * bead riding a track and becomes a ball with two stubs either side of it.
 */
const ROTATE_ARC_KNOB_RATIO = 0.085;

/** The things the tool's handles grab. The first four are one field each; the square is two. */
type TransformHandle = "translateU" | "translateV" | "rotate" | "scale" | "free" | "origin";

/** The command's own fields, in the names its inputs carry. */
export type TransformField = "distanceX" | "distanceY" | "angle" | "scale";

/**
 * The two handles dragged by where the pointer lands on the plane rather than by how far it has
 * slid along a line: the square, which moves the geometry, and the origin, which moves the
 * frame the geometry is measured on. Everything else is a projection onto an axis.
 */
function isPointDrag(handle: TransformHandle): boolean {
    return handle === "free" || handle === "origin";
}

const HANDLE_FIELDS: Partial<Record<TransformHandle, TransformField>> = {
    translateU: "distanceX",
    translateV: "distanceY",
    rotate: "angle",
    scale: "scale",
};

/**
 * One handle as it sits on screen: the shaft the arrow is drawn along and the segment the
 * pointer has to come near, which for a shaft that straddles its grab point is not the
 * same line.
 *
 * `origin`/`normal` are the *drag axis*, and they are deliberately not the drawn segment.
 * They are what turns a pointer ray into the handle's own unit — see `handleAxis`, where
 * the lengths carry the conversions from a world distance to a ratio and to degrees.
 */
/**
 * The triad's layout on a frame of a given length, in whatever space that frame is in. Called
 * twice over: once on the real frame, for the hit tests and the drag axes, and once on the
 * canonical one for the glyph geometry — see `CANONICAL_FRAME`.
 */
function layoutHandles(frame: { origin: XYZ; along: XYZ; across: XYZ }, length: number): HandleGeometry[] {
    const { origin, along, across } = frame;
    const gap = length * HANDLE_GAP_RATIO;
    const arrowLength = length * ARROW_LENGTH_RATIO;
    const diagonal = (a: XYZ, b: XYZ) => a.add(b).normalize() ?? a;
    // the knob, which is twice the arc's radius out — the curvature centre is halfway
    const ringRadius = length * ROTATE_ARC_RADIUS_RATIO * 2;

    // the square takes the corner the two arrows make, the scale mark sits out past it, and the
    // dial sits out along +along past that arrow — all measured on the frame, so the whole triad
    // is one rigid figure rather than five handles that happen to share a base
    const scaleDirection = diagonal(along, across);
    const rotateMark = origin.add(along.multiply(ringRadius));
    const uStart = origin.add(along.multiply(gap));
    const vStart = origin.add(across.multiply(gap));
    const scaleSize = length * SCALE_MARK_RATIO;
    const scaleCentre = origin.add(scaleDirection.multiply(length * SCALE_MARK_GAP_RATIO + scaleSize / 2));
    const freeCentre = origin.add(scaleDirection.multiply(length * FREE_MARK_GAP_RATIO));

    return [
        {
            role: "translateU",
            start: uStart,
            end: uStart.add(along.multiply(arrowLength)),
            origin,
            normal: along,
        },
        {
            role: "translateV",
            start: vStart,
            end: vStart.add(across.multiply(arrowLength)),
            origin,
            normal: across,
        },
        {
            role: "scale",
            // the grab segment runs through the mark along the way it is dragged, so the hit
            // test is the mark's own middle rather than a line beside it
            start: scaleCentre.sub(scaleDirection.multiply(scaleSize / 2)),
            end: scaleCentre.add(scaleDirection.multiply(scaleSize / 2)),
            origin,
            normal: scaleDirection.multiply(1 / length),
        },
        {
            role: "rotate",
            // the dial is a shape rather than a direction, so it is one point rather than a
            // segment: the arc it rides says which way the drag goes, and the tangent where the
            // knob sits is the frame's +y
            start: rotateMark,
            end: rotateMark,
            origin,
            normal: across.multiply(180 / (Math.PI * ringRadius)),
        },
        {
            role: "free",
            // no axis at all: this one is dragged by where the pointer lands on the plane rather
            // than by how far it has slid along a line. `normal` is still a unit direction off
            // the diagonal so the base can size the frame from it — it is never projected onto.
            start: freeCentre,
            end: freeCentre,
            origin,
            normal: scaleDirection,
        },
    ];
}

/**
 * The origin's own handle: the place the transform is about, which is dragged to move the triad
 * off the selection's centre and onto a point of the user's choosing. Onshape's ball point.
 */
function originHandle(frame: { origin: XYZ; along: XYZ; across: XYZ }): HandleGeometry {
    return {
        role: "origin",
        start: frame.origin,
        end: frame.origin,
        origin: frame.origin,
        normal: frame.along,
    };
}

/**
 * The frame the glyphs are meshed on: the plane's own axes at its origin, one arrow long. Every
 * glyph is built here and then `placeMesh`d onto the frame it is actually drawn on, which is
 * what makes one mesh serve every position, heading and zoom.
 */
const CANONICAL_FRAME = { origin: XYZ.zero, along: XYZ.unitX, across: XYZ.unitY };

/**
 * A glyph meshed on the canonical frame, drawn on the one it is wanted on: each vertex goes
 * through one map — the scale that carries ARROW_LENGTH to the frame's own length, and the two
 * axes that say where that frame is and which way it faces.
 *
 * The normals go through it too, as the frame's own normal. The meshes are drawn unlit today, so
 * nothing would notice if they did not, but a normal left pointing up out of the world's XY
 * plane would be a lie the day that changes. A line mesh carries none, and its `lineWidth` is in
 * screen pixels rather than in the world, so it is the one thing that does not scale — which is
 * what makes the stroke the same weight at every zoom.
 */
function placeMesh(mesh: ShapeMeshData, origin: XYZ, along: XYZ, across: XYZ, scale: number): ShapeMeshData {
    const normal = along.cross(across).normalize() ?? XYZ.unitZ;
    const source = mesh.position;
    const position = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 3) {
        const x = source[i] * scale;
        const y = source[i + 1] * scale;
        position[i] = origin.x + along.x * x + across.x * y;
        position[i + 1] = origin.y + along.y * x + across.y * y;
        position[i + 2] = origin.z + along.z * x + across.z * y;
    }
    return { ...mesh, position, ...placeNormals(mesh, normal) };
}

/** A face mesh's normals, turned from the canonical plane's to the frame's. */
function placeNormals(mesh: ShapeMeshData, normal: XYZ): { normal?: Float32Array } {
    const source = (mesh as { normal?: Float32Array }).normal;
    if (source === undefined) return {};
    const mapped = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 3) {
        const z = source[i + 2];
        mapped[i] = normal.x * z;
        mapped[i + 1] = normal.y * z;
        mapped[i + 2] = normal.z * z;
    }
    return { normal: mapped };
}

interface HandleGeometry {
    readonly role: TransformHandle;
    readonly start: XYZ;
    readonly end: XYZ;
    readonly origin: XYZ;
    readonly normal: XYZ;
}

/** The values the panel may already hold when the session opens, so the handles start in sync. */
export interface TransformFields {
    readonly distanceX: number;
    readonly distanceY: number;
    readonly angle: number;
    readonly scale: number;
}

export interface TransformSessionData {
    /** The sketch being edited: its selection *is* the set to transform. */
    readonly editor: SketchEditor;
    /**
     * Where viewport events go when they are not a handle's — the sketch's own handler, so
     * clicking and boxing curves, their hover and their highlight all behave exactly as
     * they do outside the command.
     */
    readonly picking: IEventHandler;
    /** The command's current values, so the handles start in sync with its inputs. */
    readonly initial?: Partial<TransformFields>;
    onReady?(session: SketchTransformSession): void;
    onDone?(): void;
    /** The session reports a settled value so the command syncs its input. */
    onFieldChange?(field: TransformField, value: number): void;
}

/**
 * The transform's session: the triad sits on the selected geometry and the sketch keeps
 * being worked in underneath it. Select a curve — click it, or rubber-band several — and
 * the handles appear on it with the move previewed; drag a handle and its value changes
 * under the hand; select more curves and the same transform applies to all of them at
 * once. Picking and dragging are one session rather than two stages, which is how the
 * offset's arrow and the extrude and revolve handles work as well.
 *
 * That is also why it forwards rather than owns: anything not aimed at a handle goes to the
 * sketch's own event handler, so entity picking, hovering, the rubber band and endpoint
 * dragging stay the ones the user already knows. Only the handles' own gestures, and the
 * keys that type their values, are handled here.
 *
 * The four handles carry Onshape's triad between them, as flat glyphs on the plane rather
 * than a manipulator of three shapes: `AxisDragHandler` owns everything about "drag along an
 * axis" — the press/drag and click-move-click gestures, the keypad entry, the confirm
 * control, the pixel-sized shaft — and one arrow is the whole of what it draws. So the four
 * are drawn here, on top, and the base's own arrow is suppressed (`arrowSegment` degenerates
 * to a point). What each handle *means* is still the base's axis, though: `handleAxis` hands
 * it the drag axis with the length that converts the pointer's travel into that handle's unit.
 *
 * A drag settles a value but does not commit — Enter or the confirm button does — and the
 * tool is one shot per invocation, like the offset. Empty space is NOT "confirm" the way it
 * is in Onshape: that click belongs to the sketch's own picking, which reads it as the start
 * of a rubber band, so taking it would break selecting.
 */
export class SketchTransformSession extends AxisDragHandler {
    private _du: number;
    private _dv: number;
    /** Degrees, as the panel and the keypad give them; `transform` converts on the way out. */
    private _degrees: number;
    private _scale: number;

    private _sources: number[] = [];
    private _base: [number, number] | undefined;
    /** Where the origin has been dragged to, in sketch (u, v); the selection's centre without it. */
    private _pivot: [number, number] | undefined;
    private _hoveredHandle: TransformHandle | undefined;
    /** Frozen for the length of a gesture, so the axis cannot change under the drag. */
    private _activeHandle: TransformHandle | undefined;
    /** Glyph geometry, meshed once per handle and per aimed-at state. See `cachedGlyph`. */
    private readonly _glyphCache = new Map<string, ShapeMeshData[]>();
    private arrowGesture = false;
    private moveMode = false;
    /**
     * The axes the live gesture reads, frozen when it starts.
     *
     * The frame travels with the value it carries, so a drag measured from the frame's own
     * base would be measured from a point that had just moved by that very drag: the value
     * pushes the base, the base pushes the projection, the projection pushes the value again,
     * and the handle jitters under a still pointer. Freezing the axes for the length of the
     * gesture breaks the loop — the frame still travels, it is only what *measures* that stays
     * put.
     */
    private _frozenAxis: { origin: XYZ; normal: XYZ } | undefined;
    /**
     * Where the square's gesture started: the point the pointer went down on, in sketch (u, v),
     * and the move the geometry already carried when it did.
     *
     * A free drag is not a projection onto an axis but the difference between two points on the
     * plane, and the point it measures *from* has to be the one the gesture started on. Measuring
     * from anywhere the frame travels to would be the same feedback the frozen axis breaks: the
     * move carries the square, and the square's own travel would then be read as more move.
     */
    private _freeGrab:
        | { u: number; v: number; du: number; dv: number; pivot: [number, number] | undefined }
        | undefined;
    /** The badge element the snap reuses, and what it currently shows. See `showSnapBadge`. */
    private _snapBadge: HTMLElement | undefined;
    private _snapShown: ConstraintKind | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly data: TransformSessionData,
    ) {
        super(document, controller);
        this._du = data.initial?.distanceX ?? 0;
        this._dv = data.initial?.distanceY ?? 0;
        this._degrees = data.initial?.angle ?? 0;
        this._scale = data.initial?.scale ?? 1;
        // the badges are DOM overlays; over the whole session they would take the presses
        // that belong to the handles (see `updateBadgeInterception`)
        this.data.editor.annotations.suppressConstraintSymbols = true;
        this.syncSelection();
        this.start();
    }

    /** What the user settled on — what the command commits. */
    get transform(): SketchTransform {
        return {
            du: this._du,
            dv: this._dv,
            angle: toStorageDatum(ConstraintKind.Angle, this._degrees),
            scale: this._scale,
        };
    }

    /** The entities being transformed: the sketch's own selection. */
    get sources(): readonly number[] {
        return this._sources;
    }

    /**
     * What the triad turns and scales about, in sketch (u, v) — the command transforms about the
     * same point the preview shows, so they cannot drift apart.
     *
     * The selection's own centre until the origin is taken hold of: the ball point is a *place*
     * rather than a consequence of what is selected, so once the hand has put it somewhere it
     * stays there, and a later change of selection does not drag it back.
     */
    get base(): [number, number] | undefined {
        return this._pivot ?? this._base;
    }

    /**
     * The command pushes an input's value into the session. The value came from the options
     * bar, which is the authority on it — so the readout the drag left under the pointer goes,
     * rather than sitting there showing a number that is no longer the one being transformed by.
     */
    setField(field: TransformField, value: number): void {
        switch (field) {
            case "distanceX":
                this._du = value;
                break;
            case "distanceY":
                this._dv = value;
                break;
            case "angle":
                this._degrees = value;
                break;
            case "scale":
                this._scale = value;
                break;
        }
        this.dismissDragBox();
        this.refresh();
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    /** The handle under the gesture, or under the pointer, or the one a bare axis() has to answer with. */
    private get activeHandle(): TransformHandle {
        return this._activeHandle ?? this._hoveredHandle ?? "translateU";
    }

    /**
     * The drag axis of the handle under the gesture: the line the pointer's travel is
     * projected onto, and the length that turns that travel into the handle's own unit.
     *
     * The base projects the pointer onto the axis line and dots the result with `normal` as
     * given — it normalizes the *line*, not the vector it measures with. So a `normal` that
     * is not a unit vector is what lets one linear drag serve all four: a unit one makes the
     * value a world distance (the two translation arrows), `1/2L` makes it the ratio of the
     * pointer's reach to the scale handle's own (the scale), and `180/πL·2` makes it degrees
     * of arc about the pivot (the rotate). Normalizing any of them "for tidiness" silently
     * changes what that handle measures — millimetres instead of a ratio, arc length instead
     * of degrees. See `handles()`, where each `normal` is built.
     */
    protected override axis(): { origin: XYZ; normal: XYZ } {
        if (this._frozenAxis !== undefined) return this._frozenAxis;
        const handle = this.handleOf(this.activeHandle);
        return handle === undefined ? { origin: XYZ.zero, normal: XYZ.unitX } : handle;
    }

    /** Takes the axes the gesture under way will read, before the first value moves the frame. */
    private freezeAxis(): void {
        this._frozenAxis = this.handleOf(this.activeHandle);
    }

    /**
     * A point, never a segment: the base draws one arrow from here, and the four this tool
     * needs are drawn in `buildPreview` instead. Degenerating is how the base's own arrow is
     * switched off — its `normalize()` reads a zero-length shaft as no direction at all.
     */
    protected override arrowSegment(): { start: XYZ; end: XYZ } {
        return { start: XYZ.zero, end: XYZ.zero };
    }

    /** Measured where the triad has travelled to, so the handles size themselves where they sit. */
    protected override scaleAnchor(): XYZ {
        return this._frozenAxis?.origin ?? this.frame()?.origin ?? XYZ.zero;
    }

    /**
     * The displacement measured along the frame's own axes rather than along the sketch's. The
     * arrows point wherever the frame has been turned to, so what one reads by being dragged is
     * its own axis' component of the move — the sketch holds the move as `_du`/`_dv` because
     * that is what the op transforms by, and these are that pair seen from the frame.
     */
    private alongMove(): number {
        const turned = this.turned;
        return this._du * Math.cos(turned) + this._dv * Math.sin(turned);
    }

    private acrossMove(): number {
        const turned = this.turned;
        return -this._du * Math.sin(turned) + this._dv * Math.cos(turned);
    }

    protected override currentValue(): number {
        switch (this.activeHandle) {
            case "translateU":
                return this.alongMove();
            case "translateV":
                return this.acrossMove();
            case "rotate":
                return this._degrees;
            case "free":
            case "origin":
                // nothing to report: these drags are read off the pointer, not accumulated
                return 0;
            default:
                return this._scale;
        }
    }

    /**
     * What the drag is at, as the box under the pointer prints it — a plain number, the same
     * one the options tab takes. The square is left out: it moves both ways at once, so it has
     * no single number for a box to hold, and the two it has are in the options tab.
     */
    protected override dragText(): string | undefined {
        switch (this.activeHandle) {
            case "translateU":
                return formatValue(this.alongMove());
            case "translateV":
                return formatValue(this.acrossMove());
            case "rotate":
                return formatValue(this._degrees);
            case "scale":
                return formatValue(this._scale);
            default:
                return undefined;
        }
    }

    /**
     * The square's gesture: the pointer's own travel across the sketch plane, added to whatever
     * move the geometry already carried. Both fields move together, and both are reported, since
     * a free drag is exactly the one thing on this frame that is not one input.
     */
    protected override updateDrag(view: IView, event: PointerEvent): void {
        const handle = this.activeHandle;
        if (!isPointDrag(handle)) {
            super.updateDrag(view, event);
            return;
        }
        const grab = this._freeGrab;
        const point = this.planePoint(view, event);
        if (grab !== undefined && point !== undefined) {
            const plane = this.data.editor.node.plane;
            const travel = point.sub(plane.origin);
            // the *difference* from where the gesture started, not the point it is at: what
            // moves carries only how far it has come, and neither the square nor the origin
            // sits on the plane's own origin
            const u = travel.dot(plane.xvec) - grab.u;
            const v = travel.dot(plane.yvec) - grab.v;
            if (handle === "free") this.moveGeometry(grab.du + u, grab.dv + v);
            else this.movePivot(grab, view, event, u, v);
        }
        this.refreshTempShapes(view);
        view.document.visual.update();
    }

    /** The square's drag: the geometry goes, the frame it is measured on stays where it is. */
    private moveGeometry(du: number, dv: number): void {
        this._du = du;
        this._dv = dv;
        this.data.onFieldChange?.("distanceX", du);
        this.data.onFieldChange?.("distanceY", dv);
    }

    /**
     * The origin's drag: the triad goes, and the preview does not. What the hand carries is
     * the triad itself — the point every later turn and scale happens about — so it lands
     * under the pointer, exactly on a snap when there is one. The transform it anchors is
     * re-anchored with it: the translation takes the triad's travel back out with the turn
     * and the scale inverted (`d' = d + (I − Rs⁻¹)·τ`), so the geometry already settled on
     * stays exactly where it was instead of swinging around the moving pivot. Without the
     * compensation a drag after a rotation moved the preview on its own; without landing the
     * triad (rather than the bare pivot) on the snap, a move already carried put the triad
     * on the preview's image of the snapped line instead of on the line.
     */
    private movePivot(
        grab: { du: number; dv: number; pivot: [number, number] | undefined },
        view: IView,
        event: PointerEvent,
        du: number,
        dv: number,
    ): void {
        const anchor = grab.pivot ?? this._base;
        if (anchor === undefined) return;
        // where the triad was taken hold of: the pivot carried by the move it had then
        const held: [number, number] = [anchor[0] + grab.du, anchor[1] + grab.dv];
        const landed = this.snappedPivot(view, event) ?? ([held[0] + du, held[1] + dv] as [number, number]);
        const travelU = landed[0] - held[0];
        const travelV = landed[1] - held[1];
        // the travel with the turn and the scale taken back out — the pivot's own share of it
        const cos = Math.cos(this.turned);
        const sin = Math.sin(this.turned);
        const scale = Math.abs(this._scale) > Precision.Float ? this._scale : 1;
        const backU = (cos * travelU + sin * travelV) / scale;
        const backV = (-sin * travelU + cos * travelV) / scale;
        const movedU = grab.du + travelU - backU;
        const movedV = grab.dv + travelV - backV;
        this._pivot = [landed[0] - movedU, landed[1] - movedV];
        this.moveGeometry(movedU, movedV);
    }

    /**
     * Where the triad's centre lands for this move: the snap the drawing tools would find under
     * that pointer, or nothing.
     *
     * The centre goes *onto* whatever was found rather than beside it, which is why the grab
     * offset is dropped on the way — a ball point exists to be put exactly somewhere, and a
     * pivot still carrying the few pixels between the finger and the disc's middle could never
     * be put anywhere exactly. Off a snap it falls back to the plain drag, so the triad follows
     * the hand as it did.
     */
    private snappedPivot(view: IView, event: PointerEvent): [number, number] | undefined {
        const editor = this.data.editor;
        const hit = this.planePoint(view, event);
        if (hit === undefined) return undefined;

        const tolerance = editor.screenTolerance();
        const { position, snap } = snapPosition(editor.solver, toUV(editor.node.plane, hit), {
            pointTolerance: tolerance,
            lineTolerance: tolerance,
        });
        this.showSnapBadge(snap);
        return snap === undefined ? undefined : position;
    }

    /**
     * The snap's own badge over the pointer, the one the drawing tools show: the constraint icon
     * for what was found — a point, a line, a circle. Published once per change rather than per
     * move, since the flyout takes a tip by taking the element into itself, and handing it the
     * same one on every pointer move would take it apart and put it back together each time.
     */
    private showSnapBadge(snap: DragSnap | undefined): void {
        const kind = snap === undefined ? undefined : snapConstraintKind(snap);
        if (kind === this._snapShown) return;
        this._snapShown = kind;

        const symbol = kind === undefined ? undefined : badgeSymbol(kind);
        if (symbol === undefined) {
            PubSub.default.pub("clearFloatTip");
            return;
        }
        if (this._snapBadge === undefined) {
            this._snapBadge = document.createElement("div");
            this._snapBadge.className = badgeStyle.badge;
        }
        applyConstraintIcon(this._snapBadge, symbol);
        PubSub.default.pub("showFloatTip", this._snapBadge);
    }

    /** Takes the badge down; there is nothing to take down when none is up. */
    private clearSnapBadge(): void {
        if (this._snapShown === undefined) return;
        this._snapShown = undefined;
        PubSub.default.pub("clearFloatTip");
    }

    /** Where the pointer lands on the sketch plane, or undefined when the ray misses it. */
    private planePoint(view: IView, event: PointerEvent): XYZ | undefined {
        return this.data.editor.node.plane.intersectRay(view.rayAt(event.offsetX, event.offsetY));
    }

    /** Takes the point a free drag measures from, before the frame can move out under it. */
    private grabFree(view: IView, event: PointerEvent): void {
        const point = this.planePoint(view, event);
        if (point === undefined) {
            this._freeGrab = undefined;
            return;
        }
        const plane = this.data.editor.node.plane;
        const travel = point.sub(plane.origin);
        this._freeGrab = {
            u: travel.dot(plane.xvec),
            v: travel.dot(plane.yvec),
            du: this._du,
            dv: this._dv,
            pivot: this.base,
        };
    }

    /** Puts the geometry back where the square's gesture found it, for a drag that is abandoned. */
    private restoreFree(): void {
        if (this._freeGrab === undefined) return;
        this._pivot = this._freeGrab.pivot;
        this.moveGeometry(this._freeGrab.du, this._freeGrab.dv);
    }

    protected override setCurrentValue(value: number): void {
        const handle = this.activeHandle;
        const turned = this.turned;
        // the square and the origin have no one value to set: `updateDrag` moves them
        // outright, and the base's "reset to nought" is answered there instead
        if (isPointDrag(handle)) return;
        const cos = Math.cos(turned);
        const sin = Math.sin(turned);
        switch (handle) {
            case "translateU": {
                // this arrow moves the frame along its own axis: the component across it stays
                const across = this.acrossMove();
                this._du = value * cos - across * sin;
                this._dv = value * sin + across * cos;
                break;
            }
            case "translateV": {
                const along = this.alongMove();
                this._du = along * cos - value * sin;
                this._dv = along * sin + value * cos;
                break;
            }
            case "rotate":
                this._degrees = value;
                break;
            default:
                this._scale = value;
                break;
        }
        const field = HANDLE_FIELDS[handle];
        if (field !== undefined) this.data.onFieldChange?.(field, value);
    }

    /**
     * The scale's nought is 1, not 0: the base's bare `setCurrentValue(0)` would zero it,
     * and with the scale at nought the preview collapses and the confirm goes with it. The
     * square and the origin carry no value — `restoreFree` has already put theirs back, and
     * `setCurrentValue` has nothing to say to them.
     */
    protected override resetValue(): void {
        if (this.activeHandle === "scale") {
            this.setCurrentValue(1);
            return;
        }
        this.setCurrentValue(0);
    }

    protected override get arrowHovered(): boolean {
        return this._hoveredHandle !== undefined;
    }
    protected override set arrowHovered(_value: boolean) {
        // the highlight is the handle's own color, drawn in the preview — nothing to set here
    }

    /**
     * The handles' own hover feedback. Without this none of them would light up, since the
     * base leaves the hook empty and only its own click path ever sets the flag. The arrow
     * length has to be built before the first hit test can size anything.
     */
    protected override onHover(view: IView, event: PointerEvent): void {
        if (this.arrowLength === undefined) this.refreshArrow(view);
        const hovered = this.handleAt(view, event);
        if (hovered === this._hoveredHandle) return;
        this._hoveredHandle = hovered;
        this.refresh();
    }

    /**
     * Confirming takes geometry as well as a value: with nothing selected there is nothing
     * to move, and no handles on screen to drag either. A scale dragged through zero is
     * refused here as the op refuses it — a negative one is a reflection, and the arcs it
     * would flip need the mirror's own answers.
     */
    protected override canConfirm(): boolean {
        return (
            this._sources.length > 0 &&
            this._base !== undefined &&
            this._scale > Precision.Float &&
            !isIdentityTransform(this.transform)
        );
    }

    /**
     * The base's own hit test measures against the one arrow it draws, which this session
     * suppresses — so it is answered from the four handles instead.
     */
    protected override isOverArrow(view: IView, event: PointerEvent): boolean {
        return this.handleAt(view, event) !== undefined;
    }

    /** The moved geometry first, then the handles it is moved with — the handles stack on top. */
    protected override buildPreview(): DragPreview {
        return { meshes: [...this.geometryMeshes(), ...this.handleMeshes()] };
    }

    /**
     * The glyphs' white is the look, not a surface to shade: lit, the fills would render grey
     * against the unlit outlines drawn beside them.
     */
    protected override previewUnlit(): boolean {
        return true;
    }

    /** The handles are what is being aimed at, so they must not hide behind the geometry. */
    protected override previewOnTop(): boolean {
        return true;
    }

    /**
     * The triad is pixel-sized like the base's arrow, but drawn as preview meshes — which
     * `refreshArrow` alone does not rebuild. Rebuild them on every camera change, or the
     * handles keep the size they were drawn at until the next hover happens to redraw them.
     */
    protected override onCameraChanged(view: IView): void {
        this.refreshTempShapes(view);
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onCleanup(): void {
        this.clearSnapBadge();
        // the badges take pointer events again once nothing is being dragged, and the
        // sketch's own constraint symbols come back with them
        this.data.editor.annotations.inertConstraintSymbols = false;
        this.data.editor.annotations.suppressConstraintSymbols = false;
        this.data.onDone?.();
    }

    // ------------------------------------------------------------------ Click-move mode bookkeeping

    protected override enterMoveMode(view: IView, event: PointerEvent): void {
        this.moveMode = true;
        // the click path reaches here without a pointerDown, so the handle is frozen here too
        this._activeHandle = this._hoveredHandle;
        this.freezeAxis();
        if (this._activeHandle !== undefined && isPointDrag(this._activeHandle)) this.grabFree(view, event);
        super.enterMoveMode(view, event);
    }

    protected override finishMoveMode(view: IView): void {
        this.moveMode = false;
        // the gesture is over: from here the frame's own axes are what a fresh grab reads
        this._frozenAxis = undefined;
        this._freeGrab = undefined;
        super.finishMoveMode(view);
    }

    protected override exitMoveMode(view: IView): void {
        this.moveMode = false;
        this._frozenAxis = undefined;
        // the base resets an axis drag to nought; a square's nought is where it was taken hold
        // of, which is the one thing a bare `setCurrentValue(0)` cannot know
        this.restoreFree();
        this._freeGrab = undefined;
        super.exitMoveMode(view);
    }

    // ------------------------------------------------------------------ Events: a handle's, or the sketch's

    override pointerDown(view: IView, event: PointerEvent): void {
        // the hit test runs here rather than trusting the last hover: a click can land
        // straight on a handle with no move before it
        const hovered = this.handleAt(view, event);
        this._hoveredHandle = hovered;
        this.arrowGesture = this.moveMode || hovered !== undefined;
        if (this.arrowGesture) {
            this._activeHandle = hovered;
            // taken before the first value moves the frame out from under the gesture
            this.freezeAxis();
            if (this._activeHandle !== undefined && isPointDrag(this._activeHandle)) {
                this.grabFree(view, event);
            }
        }
        this.updateBadgeInterception(view, event);
        if (this.arrowGesture) {
            super.pointerDown(view, event);
            return;
        }
        this.data.picking.pointerDown(view, additivePick(event));
        this.syncSelection();
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        // the base also runs the handles' hover feedback, which is wanted either way
        super.pointerMove(view, event);
        this.updateBadgeInterception(view, event);
        if (this.moveMode || this.arrowGesture) return;
        this.data.picking.pointerMove(view, additivePick(event));
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        this.updateBadgeInterception(view, event);
        if (this.moveMode || this.arrowGesture) {
            super.pointerUp(view, event);
            this.arrowGesture = false;
            this._activeHandle = undefined;
            // a click that only opened the click-move-click gesture has not ended it —
            // `finishMoveMode` releases the freeze when the second click does
            if (!this.moveMode) {
                this._frozenAxis = undefined;
                this._freeGrab = undefined;
                this.clearSnapBadge();
            }
            // the sketch may have selected a box, or dragged a point and committed: its
            // redraw can leave the handles stale, so they go back up whatever it did
            this.syncSelection();
            return;
        }
        this._frozenAxis = undefined;
        this._freeGrab = undefined;
        this.data.picking.pointerUp(view, additivePick(event));
        this.syncSelection();
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.data.picking.pointerOut?.(view, additivePick(event));
    }

    override mouseWheel(view: IView, event: WheelEvent): void {
        super.mouseWheel(view, event);
        this.data.picking.mouseWheel?.(view, event);
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        // Escape (out of the drag, then out of the command), Enter, and the digits that type
        // a value are the drag's. Deleting a picked curve is a sketch edit and has to reach
        // the sketch, which also changes what the transform applies to.
        if (event.key === "Delete" || event.key === "Backspace") {
            this.data.picking.keyDown(view, event);
            this.syncSelection();
            return;
        }
        super.keyDown(view, event);
    }

    /**
     * While a handle is being aimed at or moved, the sketch's floating constraint badges stop
     * taking pointer events. They stay drawn; only the interception goes, and only while this
     * lasts — one lying over a handle would take the press that grabs it and the browser would
     * never know the handle was under it (the offset's arrow does the same).
     */
    private updateBadgeInterception(view: IView, event: PointerEvent): void {
        this.data.editor.annotations.inertConstraintSymbols =
            this.moveMode || this.arrowGesture || this.handleAt(view, event) !== undefined;
    }

    // ------------------------------------------------------------------ Following the selection

    /**
     * Re-reads the selection and, when it moved, re-anchors the triad and redraws the handles
     * and the preview. This is what makes the handles appear the moment a curve is picked (the
     * sketch's own click path did the picking) and follow every later box, add or delete. The
     * accumulated values are kept across a change of selection, as Onshape keeps them.
     */
    private syncSelection(): void {
        const sources = this.data.editor.selectedEntityIds();
        const base = transformBase(this.data.editor.solver, sources);
        if (sameSelection(sources, this._sources) && samePoint(base, this._base)) return;
        this._sources = sources;
        this._base = base;
        this.refresh();
    }

    // ------------------------------------------------------------------ Handles

    /** The triad's base in world space, or undefined when nothing is selected. */
    private baseWorld(): XYZ | undefined {
        const base = this.base;
        return base === undefined ? undefined : toWorld(this.data.editor.node.plane, ...base);
    }

    /**
     * The world length the arrows are drawn at: the pixel-constant one the base sizes its own
     * arrow to. Never below `ARROW_LENGTH`, because a meshed arrow shorter than that comes out
     * with a head longer than its own shaft — which only ever bites when the view is so close
     * that the whole triad would be unusable anyway.
     */
    private get handleLength(): number {
        return Math.max(this.arrowLength ?? ARROW_LENGTH, ARROW_LENGTH);
    }

    /** The turn the frame is drawn at, in radians. */
    private get turned(): number {
        return toStorageDatum(ConstraintKind.Angle, this._degrees);
    }

    /**
     * Where the frame sits and which way it faces: the selection's own centre, carried by the
     * move and turned by the rotation. The triad travels with the geometry it is transforming,
     * so what the user aims at stays where the geometry went rather than being left behind at
     * the place it started from — and a rotation shows as the frame itself having turned.
     */
    private frame(): { origin: XYZ; along: XYZ; across: XYZ } | undefined {
        const base = this.baseWorld();
        if (base === undefined) return undefined;
        const { xvec: x, yvec: y } = this.data.editor.node.plane;
        const cos = Math.cos(this.turned);
        const sin = Math.sin(this.turned);
        return {
            origin: base.add(x.multiply(this._du)).add(y.multiply(this._dv)),
            // the plane's axes as the rotation leaves them
            along: x.multiply(cos).add(y.multiply(sin)),
            across: x.multiply(-sin).add(y.multiply(cos)),
        };
    }

    /**
     * Where the four handles sit, on the frame above.
     *
     * The scale is not one of the things that moves them: the frame carries the move and the
     * turn, but a triad that grew with the geometry would stop being usable as a triad — the
     * arrows would walk out of the viewport at the very sizes where aiming matters.
     */
    private handles(): HandleGeometry[] {
        const frame = this.frame();
        if (frame === undefined) return [];
        // the origin comes after the marks rather than from `layoutHandles`, which is what the
        // glyphs are built from: this one has no glyph of its own — the disc below is drawn
        // where it sits, and drawn the same on the canonical frame either way
        return [...layoutHandles(frame, this.handleLength), originHandle(frame)];
    }

    private handleOf(role: TransformHandle): HandleGeometry | undefined {
        return this.handles().find((handle) => handle.role === role);
    }

    /**
     * The handle whose glyph the pointer is nearest, or undefined — the base's own hit test
     * only ever knows about one arrow, so the four are tested here and the nearest wins.
     */
    private handleAt(view: IView, event: PointerEvent): TransformHandle | undefined {
        let nearest: TransformHandle | undefined;
        let best = ARROW_HOVER_TOLERANCE;
        for (const handle of this.handles()) {
            const distance = this.handleDistance(view, handle, event);
            if (distance <= best) {
                best = distance;
                nearest = handle.role;
            }
        }
        return nearest;
    }

    private handleDistance(view: IView, handle: HandleGeometry, event: PointerEvent): number {
        // the square is an area rather than a line, so anywhere on it counts — and it answers
        // with nought from inside, which is what keeps a press that lands on the mark itself
        // from being read as a press on whatever line happens to pass under it
        if (handle.role === "free") {
            const centre = view.worldToScreen(handle.start);
            const corner = view.worldToScreen(
                handle.start.add(
                    this.frame()?.along.multiply(this.handleLength * FREE_MARK_SIZE_RATIO) ?? XYZ.zero,
                ),
            );
            const half = Math.hypot(corner.x - centre.x, corner.y - centre.y);
            return Math.max(0, Math.hypot(event.offsetX - centre.x, event.offsetY - centre.y) - half);
        }
        // the dial is grabbed round its arc rather than at its centre, so measure along the
        // arc's line and the middle it wraps, since the glyph is taken as a whole
        if (handle.role !== "rotate") {
            const a = view.worldToScreen(handle.start);
            const b = view.worldToScreen(handle.end);
            return distanceToSegment(event.offsetX, event.offsetY, a, b);
        }
        const frame = this.frame();
        const facing = handle.origin.sub(handle.start).normalize();
        if (frame === undefined || facing === undefined) return Number.POSITIVE_INFINITY;
        // the mark reads as one glyph, so its middle counts as much as the band itself
        const centre = view.worldToScreen(handle.start);
        let best = distanceToSegment(event.offsetX, event.offsetY, centre, centre);
        const points = arcMidlinePoints(
            arcCentreOf(handle),
            facing,
            frame.along,
            frame.across,
            this.handleLength,
        );
        for (let i = 0; i + 1 < points.length; i++) {
            const a = view.worldToScreen(points[i]);
            const b = view.worldToScreen(points[i + 1]);
            best = Math.min(best, distanceToSegment(event.offsetX, event.offsetY, a, b));
        }
        return best;
    }

    /**
     * The frame, back to front: each handle as a white glyph with its dark outline — the
     * aimed-at one grown and washed with the accent — and the origin disc carried last.
     * On-top preview meshes share a render order, so within one preview the later a mesh is
     * displayed the higher it stacks: the layering here is nothing but array order.
     *
     * All of it is flat work on the sketch plane — outlines and discs, never solids. The
     * sketch is a drawing, and a handle standing off it in 3D would read as a body in the model
     * rather than as part of the tool; it is also what the arrows being *on* the plane buys,
     * since a solid cone seen edge-on from a near-top view disappears into a sliver.
     */
    private handleMeshes(): ShapeMeshData[] {
        const frame = this.frame();
        if (frame === undefined) return [];
        const { origin, along, across } = frame;
        const lit = this._activeHandle ?? this._hoveredHandle;
        // the glyphs were meshed at ARROW_LENGTH and are drawn at whatever the viewport sizes
        // them to; every dimension in them is a ratio of that length, so one scale is the whole
        // of the difference
        const scale = this.handleLength / ARROW_LENGTH;
        const meshes: ShapeMeshData[] = [];
        for (const handle of layoutHandles(CANONICAL_FRAME, ARROW_LENGTH)) {
            for (const mesh of this.cachedGlyph(handle, handle.role === lit)) {
                meshes.push(placeMesh(mesh, origin, along, across, scale));
            }
        }
        for (const mesh of this.cachedOriginDisc(lit === "origin")) {
            meshes.push(placeMesh(mesh, origin, along, across, scale));
        }
        return meshes;
    }

    /**
     * One glyph's meshes, meshed the first time it is asked for and handed back from then on.
     *
     * Every dimension a glyph is built from is a ratio of the frame's length, so the same glyph
     * on a longer frame is the same glyph scaled — one shape per handle and per aimed-at state,
     * placed by `placeMesh` rather than rebuilt. That is worth doing because meshing is not
     * cheap and this runs on every pointer move of a drag: measured on the OCCT kernel, the
     * thirteen faces came to about 11 ms a redraw, and seven of those milliseconds were the
     * five 32-sided discs. Meshed once, a redraw is a walk over a few hundred vertices.
     *
     * The aimed-at state is part of the key rather than a coat of paint applied afterwards: the
     * highlight is baked into the mesh colours, and only one glyph is ever at it.
     */
    private cachedGlyph(handle: HandleGeometry, lit: boolean): ShapeMeshData[] {
        return this.cachedMesh(`glyph:${handle.role}:${lit}`, () =>
            handleGlyphMeshes(handle, ARROW_LENGTH, CANONICAL_FRAME.along, CANONICAL_FRAME.across, lit),
        );
    }

    private cachedOriginDisc(lit: boolean): ShapeMeshData[] {
        return this.cachedMesh(`origin:${lit}`, () =>
            originDiscMeshes(
                CANONICAL_FRAME.origin,
                ARROW_LENGTH,
                CANONICAL_FRAME.along,
                CANONICAL_FRAME.across,
                lit,
            ),
        );
    }

    private cachedMesh(key: string, build: () => ShapeMeshData[]): ShapeMeshData[] {
        let meshes = this._glyphCache.get(key);
        if (meshes === undefined) {
            meshes = build();
            this._glyphCache.set(key, meshes);
        }
        return meshes;
    }

    /** The geometry as the current values would leave it, in the tone a proposal is drawn in. */
    private geometryMeshes(): EdgeMeshData[] {
        // nothing to preview for a value that could not be committed either — see `canConfirm`
        const base = this.base;
        if (base === undefined || this._scale <= Precision.Float) return [];
        if (isIdentityTransform(this.transform)) return [];
        const copies = transformPreview(this.data.editor.solver, this._sources, base, this.transform);
        return copies.map((copy) => {
            const mesh = sketchEntityMesh(this.data.editor, copy, TRANSFORM_PREVIEW_COLOR, "dash");
            mesh.lineWidth = TRANSFORM_PREVIEW_LINE_WIDTH;
            return mesh;
        });
    }
}

/** One handle's glyph: its dark outline with the white fill on top, grown while the pointer is on it. */
function handleGlyphMeshes(
    handle: HandleGeometry,
    length: number,
    right: XYZ,
    up: XYZ,
    lit: boolean,
): ShapeMeshData[] {
    switch (handle.role) {
        case "rotate":
            return arcMarkMeshes(handle, length, right, up, lit);
        case "scale":
            return triangleMarkMeshes(handle, length, right, up, lit);
        case "free":
            return squareMarkMeshes(handle, length, right, up, lit);
        default:
            return arrowGlyphMeshes(handle, length, right, up, lit);
    }
}

/** A translation arrow: the annotation's arrowhead on a straight stem, filled and outlined. */
function arrowGlyphMeshes(
    handle: HandleGeometry,
    length: number,
    right: XYZ,
    up: XYZ,
    lit: boolean,
): ShapeMeshData[] {
    const direction = handle.end.sub(handle.start).normalize();
    const normal = right.cross(up).normalize();
    // the plane's own axes rather than a basis off `direction`: an arrow lying in the plane can
    // only be widened along the plane, and which way that is must not depend on where it points
    const across = direction === undefined ? undefined : normal?.cross(direction).normalize();
    if (direction === undefined || normal === undefined || across === undefined) return [];

    // drawn as long as its own grab segment, which runs shorter than the frame's length
    const points = scaledPoints(
        arrowPoints(handle.start, direction, across, handle.end.distanceTo(handle.start)),
        lit ? HOVER_GROW : 1,
    );
    return outlinedMeshes(points, normal, length * OUTLINE_WIDTH_RATIO, lit);
}

/**
 * The scale handle's mark: a plain triangle pointing the way the drag grows the geometry —
 * a shape, not a direction, so it carries no stem.
 */
function triangleMarkMeshes(
    handle: HandleGeometry,
    length: number,
    right: XYZ,
    up: XYZ,
    lit: boolean,
): ShapeMeshData[] {
    const centre = handle.start.add(handle.end).multiply(0.5);
    const direction = handle.end.sub(handle.start).normalize();
    const normal = right.cross(up).normalize();
    const across = direction === undefined ? undefined : normal?.cross(direction).normalize();
    if (direction === undefined || normal === undefined || across === undefined) return [];

    // an equilateral silhouette: half the base is the height over √3
    const size = handle.end.distanceTo(handle.start);
    const at = (along: number, side: number) =>
        centre.add(direction.multiply(along)).add(across.multiply(side));
    const points = scaledPoints(
        [at(size / 2, 0), at(-size / 2, size / Math.sqrt(3)), at(-size / 2, -size / Math.sqrt(3))],
        lit ? HOVER_GROW : 1,
    );
    return outlinedMeshes(points, normal, length * OUTLINE_WIDTH_RATIO, lit);
}

/**
 * The free-move handle's mark: a plain square on the diagonal, the one glyph on the frame with
 * no direction in it — which is what it is for. Every other mark says *which way* along some
 * axis it drags; this one drags whichever way the pointer goes, so a shape with no axis in it
 * is the honest drawing of it.
 */
function squareMarkMeshes(
    handle: HandleGeometry,
    length: number,
    right: XYZ,
    up: XYZ,
    lit: boolean,
): ShapeMeshData[] {
    const normal = right.cross(up).normalize();
    if (normal === undefined) return [];

    const half = length * FREE_MARK_SIZE_RATIO;
    const at = (along: number, side: number) =>
        handle.start.add(right.multiply(along)).add(up.multiply(side));
    const points = scaledPoints(
        [at(-half, -half), at(half, -half), at(half, half), at(-half, half)],
        lit ? HOVER_GROW : 1,
    );
    return outlinedMeshes(points, normal, length * OUTLINE_WIDTH_RATIO, lit);
}

/**
 * The rotate handle's mark: a short arc about the pivot with a small round knob riding its
 * middle — the dial below. The arc is drawn as a line rather than a filled band, since a band
 * this thin was only ever a stroke wearing a fill; the knob stays solid, being what the hand
 * takes hold of.
 */
function arcMarkMeshes(
    handle: HandleGeometry,
    length: number,
    right: XYZ,
    up: XYZ,
    lit: boolean,
): ShapeMeshData[] {
    const normal = right.cross(up).normalize();
    const facing = handle.origin.sub(handle.start).normalize();
    if (normal === undefined || facing === undefined) return [];

    const centre = arcCentreOf(handle);
    const knob = arcKnobCentre(centre, facing, right, up, length);
    const line = arcMidlinePoints(centre, facing, right, up, length);
    const color = lit ? GLYPH_FILL_ACTIVE : GLYPH_FILL;
    return [
        // The stroke is the same two-pass the filled glyphs get from `outlinedMeshes`: a line
        // has no room for an outline, so it is laid twice, the darker one wider underneath. One
        // line alone would be a white thread, which on the light theme is no thread at all.
        ...arcLineMeshes(line, OUTLINE_COLOR, ARC_STROKE_WIDTH + OUTLINE_LINE_WIDTH),
        ...arcLineMeshes(line, color, ARC_STROKE_WIDTH),
        ...outlinedMeshes(
            discPoints(knob, length * ROTATE_ARC_KNOB_RATIO, right, up),
            normal,
            length * OUTLINE_WIDTH_RATIO,
            lit,
        ),
    ];
}

/** A run of points as the one stroked line it draws, or nothing when it has no segments. */
function arcLineMeshes(points: readonly XYZ[], color: number, lineWidth: number): EdgeMeshData[] {
    const meshes: EdgeMeshData[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const segment = MeshDataUtils.createEdgeMesh(points[i], points[i + 1], color, "solid");
        segment.lineWidth = lineWidth;
        meshes.push(segment);
    }
    return meshes.length === 0 ? [] : [meshes.reduce((all, one) => MeshDataUtils.mergeEdgeMesh(all, one))];
}

/**
 * Where the arc's circle is centred: halfway between the pivot and the knob. The radius is the
 * arc's distance from the pivot and the knob is twice that, so the two points are the diameter
 * and the middle of it is the centre — which is what puts the circle through the origin.
 */
function arcCentreOf(handle: HandleGeometry): XYZ {
    return handle.origin.add(handle.start).multiply(0.5);
}

/** Where the knob rides: the middle of the arc, on its own line. */
function arcKnobCentre(centre: XYZ, facing: XYZ, right: XYZ, up: XYZ, length: number): XYZ {
    const { start, end } = arcSweep(facing, right, up);
    const angle = (start + end) / 2;
    const rho = length * ROTATE_ARC_RADIUS_RATIO;
    return centre.add(right.multiply(rho * Math.cos(angle))).add(up.multiply(rho * Math.sin(angle)));
}

/**
 * The arc's two ends in the plane's frame, centred on the direction *away* from the origin —
 * so the opening faces the pivot the handle turns about, and the +along arrow, which comes in
 * from that side, runs into the gap rather than into the band.
 */
function arcSweep(facing: XYZ, right: XYZ, up: XYZ): { start: number; end: number } {
    const away = Math.atan2(-facing.dot(up), -facing.dot(right));
    return { start: away - ROTATE_ARC_SWEEP_HALF, end: away + ROTATE_ARC_SWEEP_HALF };
}

/**
 * The arc's midline — what the hover test measures against, since the mark is grabbed round
 * its sweep rather than at its centre.
 */
function arcMidlinePoints(centre: XYZ, facing: XYZ, right: XYZ, up: XYZ, length: number): XYZ[] {
    const radius = length * ROTATE_ARC_RADIUS_RATIO;
    const { start, end } = arcSweep(facing, right, up);
    const points: XYZ[] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const angle = start + ((end - start) * i) / ARC_SEGMENTS;
        points.push(
            centre.add(right.multiply(radius * Math.cos(angle))).add(up.multiply(radius * Math.sin(angle))),
        );
    }
    return points;
}

/**
 * The origin marker: a white disc edged in the outline, with the accent as its filled heart.
 * Round because it is the pivot every handle is measured from — and it is taken hold of, being
 * the one thing on the frame that drags the frame itself rather than the geometry, so it lights
 * up like the rest. Its heart inverts while it does: an accent core on an accent disc would
 * simply not be there.
 */
function originDiscMeshes(centre: XYZ, length: number, right: XYZ, up: XYZ, lit: boolean): ShapeMeshData[] {
    const radius = length * ORIGIN_DISC_RADIUS_RATIO;
    return [
        ...discMeshes(centre, radius + length * OUTLINE_WIDTH_RATIO, right, up, OUTLINE_COLOR),
        ...discMeshes(centre, radius, right, up, lit ? GLYPH_FILL_ACTIVE : GLYPH_FILL),
        ...discMeshes(centre, radius * ORIGIN_CORE_RATIO, right, up, lit ? GLYPH_FILL : ACCENT_COLOR),
    ];
}

/**
 * A glyph as two faces: the outline's own points grown by the outline's width, in the outline
 * colour, with the white fill on top. The grow is an edge offset rather than a scale about the
 * centroid, so the outline is the same width all the way round and reads as a stroke.
 */
function outlinedMeshes(points: XYZ[], normal: XYZ, width: number, lit: boolean): ShapeMeshData[] {
    return [
        ...faceMeshes(offsetPoints(points, width, normal), OUTLINE_COLOR),
        ...faceMeshes(points, lit ? GLYPH_FILL_ACTIVE : GLYPH_FILL),
    ];
}

/**
 * A closed run of points pushed outward by a uniform distance along the plane's normal: each
 * vertex moves along the bisector of its two edges, clamped so a sharp corner's miter cannot
 * run away. Outward is `edge × normal` for the counter-clockwise winding the glyphs are drawn in.
 */
function offsetPoints(points: readonly XYZ[], distance: number, normal: XYZ): XYZ[] {
    const count = points.length;
    const result: XYZ[] = [];
    for (let i = 0; i < count; i++) {
        const edgeIn = points[i].sub(points[(i - 1 + count) % count]).normalize();
        const edgeOut = points[(i + 1) % count].sub(points[i]).normalize();
        if (edgeIn === undefined || edgeOut === undefined) {
            result.push(points[i]);
            continue;
        }
        const inward = edgeIn.cross(normal);
        const bisector = inward.add(edgeOut.cross(normal)).normalize();
        if (bisector === undefined) {
            result.push(points[i]);
            continue;
        }
        result.push(
            points[i].add(bisector.multiply(distance / Math.max(Math.abs(bisector.dot(inward)), 0.5))),
        );
    }
    return result;
}

/** The outline grown (or shrunk) about its own centroid — the hover grow. */
function scaledPoints(points: readonly XYZ[], factor: number): XYZ[] {
    if (factor === 1) return [...points];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
        z += point.z;
    }
    const centre = new XYZ(x / points.length, y / points.length, z / points.length);
    return points.map((point) => centre.add(point.sub(centre).multiply(factor)));
}

/**
 * A flat arrow on the plane, as one outline: a straight stem widening into the solid triangle
 * the sketch's dimension annotations draw their arrowheads with — a sharp tip, straight sides,
 * a flat tail. One outline rather than a shaft shape and a head shape — two faces meeting along
 * an edge have to agree on exactly where that edge is, and anything the kernel does to one of
 * them on its way through shows up as a gap in the middle of the arrow.
 */
function arrowPoints(start: XYZ, direction: XYZ, across: XYZ, length: number): XYZ[] {
    const headLength = length * ARROW_HEAD_RATIO;
    const shaftLength = length - headLength;
    const headHalf = headLength * Math.tan(ARROW_HEAD_HALF_ANGLE);
    const shaftHalf = headHalf * ARROW_SHAFT_TO_HEAD;
    const at = (along: number, side: number) =>
        start.add(direction.multiply(along)).add(across.multiply(side));

    return [
        at(0, -shaftHalf),
        at(shaftLength, -shaftHalf),
        at(shaftLength, -headHalf),
        at(length, 0),
        at(shaftLength, headHalf),
        at(shaftLength, shaftHalf),
        at(0, shaftHalf),
    ];
}

/**
 * A circle of the frame, as the points a stroke or a face is drawn from. Round because the
 * origin disc is a *place* rather than a direction — the arrows are what point.
 */
function discPoints(centre: XYZ, radius: number, right: XYZ, up: XYZ): XYZ[] {
    const points: XYZ[] = [];
    for (let i = 0; i < DISC_SEGMENTS; i++) {
        const at = (i / DISC_SEGMENTS) * Math.PI * 2;
        points.push(
            centre.add(right.multiply(radius * Math.cos(at))).add(up.multiply(radius * Math.sin(at))),
        );
    }
    return points;
}

/** A filled disc — the origin marker's layers. */
function discMeshes(centre: XYZ, radius: number, right: XYZ, up: XYZ, color: number): ShapeMeshData[] {
    return faceMeshes(discPoints(centre, radius, right, up), color);
}

/**
 * A closed run of points as the filled mesh it draws from, or nothing when the kernel refused it.
 *
 * The run has to come back to where it started, and the callers hand over outlines rather than
 * rings — so the first point is appended unless it is already there. `polygon` builds its wire
 * with `MakePolygon`, which leaves it open, and an open wire of four points or more comes back
 * closed anyway while a triangle's two edges do not: OCCT closes it some other way and meshes
 * something else entirely. That is not a theory — the scale mark's triangle came out a sliver
 * exactly one third of its own height, every time, until this was here.
 */
function faceMeshes(points: readonly XYZ[], color: number): ShapeMeshData[] {
    const closed =
        points[0].distanceTo(points[points.length - 1]) <= Precision.Float
            ? [...points]
            : [...points, points[0]];
    const wire = shapeFactory.polygon(closed);
    if (!wire.isOk) return [];
    const face = shapeFactory.face([wire.value]);
    if (!face.isOk) {
        wire.value.dispose();
        return [];
    }
    const mesh = face.value.mesh.faces;
    if (mesh !== undefined) mesh.color = color;
    face.value.dispose();
    wire.value.dispose();
    return mesh === undefined ? [] : [mesh];
}

/**
 * A dragged value as the box prints it: a plain number, rounded to a tenth of a millimetre's
 * worth of decimals and stripped of the trailing zeros that leaves — "25" rather than
 * "25.000", and short enough to read while the hand is still moving.
 */
function formatValue(value: number): string {
    return String(Number(value.toFixed(3)));
}

/** Whether the selection is the same set of entities, in the same order. */
function sameSelection(first: readonly number[], second: readonly number[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index]);
}

function samePoint(first: [number, number] | undefined, second: [number, number] | undefined): boolean {
    if (first === undefined || second === undefined) return first === second;
    return (
        Math.abs(first[0] - second[0]) <= Precision.Float && Math.abs(first[1] - second[1]) <= Precision.Float
    );
}

/**
 * Moves the selected geometry as one body — shifted, turned about the triad and scaled about
 * it — keeping every relation the moved geometry can still hold and dropping the ones it
 * cannot (see `transformOps.ts` for what survives and why). The handles are up as soon as
 * anything is selected; the values accumulate across handles and across a change of
 * selection, and Enter or the confirm button commits the lot as one undo step.
 *
 * One shot per invocation: the confirm commits and the command is over, so the next
 * transform starts the tool again. ESC, or a drag that never settles, leaves the sketch alone.
 */
@command({ key: "sketch.transform", icon: "icon-transform" })
export class SketchTransformCommand extends SketchConstraintCommand {
    private _session: SketchTransformSession | undefined;
    /** Set while the session pushes a value in, so the setter does not push it back. */
    private _syncingFromSession = false;
    /** Set while the setter drives the session, so nothing it echoes back replaces the input. */
    private _pushingToSession = false;

    /**
     * The four values the tool transforms by.
     *
     * Deliberately *not* `@property`s: that decorator is what puts a field on the options bar,
     * and these are edited where they are dragged — in the box that rides the pointer, over the
     * handle that moves them. Declaring them would put a second place to type the number the
     * hand just moved the geometry to, kept in step with the first, for no gain. They are still
     * observable values the session reports through both ways, and the confirm bar still reads
     * whether there is anything to confirm.
     */
    get distanceX(): ParameterValue {
        return this.getPrivateValue("distanceX", 0);
    }
    set distanceX(value: ParameterValue) {
        if (!this.setProperty("distanceX", value)) return;
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        if (resolved.isOk) this.pushField("distanceX", resolved.value);
    }

    get distanceY(): ParameterValue {
        return this.getPrivateValue("distanceY", 0);
    }
    set distanceY(value: ParameterValue) {
        if (!this.setProperty("distanceY", value)) return;
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        if (resolved.isOk) this.pushField("distanceY", resolved.value);
    }

    /** How far the selection turns about the triad, counter-clockwise and in degrees. */
    get angle(): ParameterValue {
        return this.getPrivateValue("angle", 0);
    }
    set angle(value: ParameterValue) {
        if (!this.setProperty("angle", value)) return;
        const resolved = this.resolveParameter(value, ANGLE_UNITS);
        if (resolved.isOk) this.pushField("angle", resolved.value);
    }

    /** How much larger the selection becomes about the triad: 2 doubles it, 0.5 halves it. */
    get scale(): ParameterValue {
        return this.getPrivateValue("scale", 1);
    }
    set scale(value: ParameterValue) {
        if (!this.setProperty("scale", value)) return;
        const resolved = this.resolveParameter(value, UNITLESS);
        if (resolved.isOk) this.pushField("scale", resolved.value);
    }

    protected async executeWithEditor(editor: SketchEditor): Promise<void> {
        this.controller = new AsyncController();
        const controller = this.controller;
        const session = new SketchTransformSession(editor.document, controller, this.sessionData(editor));
        try {
            await editor.document.picker.pickAsync(
                session,
                "prompt.transformEntities",
                controller,
                "none",
                // the picking cursor, not the drawing one: this session selects curves
                // (and drags a handle), it does not lay geometry down
                "select.default",
            );
        } finally {
            session.dispose();
        }

        // The session may have ended under the drag (another view, a closed document):
        // `picker.pickAsync` restores whatever handler it replaced, which by then is a
        // disposed sketch handler, so nothing may touch the editor from here on.
        if (SketchEditor.getActive() !== editor) return;
        if (controller.result?.status !== "success") return;
        const base = session.base;
        if (base === undefined) return;
        this.applyTransform(editor, session.sources, base, session.transform);
    }

    /**
     * What the session needs of the command: the sketch it works in, the handler to hand
     * every non-handle event to, and the two-way tie between its four values and this
     * command's inputs.
     */
    private sessionData(editor: SketchEditor): TransformSessionData {
        return {
            editor,
            // read before the swap: the sketch's handler is the one in place, and
            // everything not aimed at a handle has to keep reaching it
            picking: editor.document.visual.eventHandler,
            initial: {
                distanceX: this.applied("distanceX", LENGTH_UNITS),
                distanceY: this.applied("distanceY", LENGTH_UNITS),
                angle: this.applied("angle", ANGLE_UNITS),
                scale: this.applied("scale", UNITLESS),
            },
            onReady: (created) => {
                this._session = created;
            },
            onDone: () => {
                this._session = undefined;
            },
            onFieldChange: (field, value) => {
                if (this._pushingToSession) return;
                this._syncingFromSession = true;
                this[field] = value;
                this._syncingFromSession = false;
            },
        };
    }

    /** Runs the op and commits, or reports why it would not. Either way the tool is done. */
    private applyTransform(
        editor: SketchEditor,
        sources: readonly number[],
        base: readonly [number, number],
        transform: SketchTransform,
    ): void {
        const result = transformEntities(editor.solver, sources, base, transform);
        if (!result.isOk) {
            PubSub.default.pub("displayError", result.error);
            return;
        }
        const { removedConstraintIds } = result.value;
        // the relations the move could not hold are gone: their dimension anchors have to
        // go with them, and the user has to be told which way the sketch paid for the move
        if (removedConstraintIds.length > 0) {
            editor.forgetConstraints(removedConstraintIds);
            PubSub.default.pub(
                "statusBarTip",
                "sketch.transformRemovedConstraints{0}",
                removedConstraintIds.length,
            );
        }
        editor.solve(true);
        editor.commit();
        editor.clearEntitySelection();
    }

    /** One input's value, resolved against the document's parameters. */
    private applied(field: TransformField, unit: typeof LENGTH_UNITS): number {
        const resolved = this.resolveParameter(this[field], unit);
        return resolved.isOk ? resolved.value : 0;
    }

    /** Hands an input's value to the session, unless the session is what put it there. */
    private pushField(field: TransformField, value: number): void {
        if (this._syncingFromSession || this._session === undefined) return;
        this._pushingToSession = true;
        this._session.setField(field, value);
        this._pushingToSession = false;
    }
}
