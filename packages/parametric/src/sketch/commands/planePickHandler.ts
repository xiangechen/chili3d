// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IFace,
    type IView,
    type Plane,
    type Ray,
    ShapeSelectionHandler,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import {
    DATUM_PLANE_NAMES,
    type DatumPlaneName,
    datumDisplayPlane,
    datumPlaneOf,
    planeOfFace,
} from "../planeRef";
import {
    DATUM_COLORS,
    DATUM_GAP,
    DATUM_HIGHLIGHT_COLORS,
    DATUM_HOVER_OPACITY,
    DATUM_OPACITY,
    DATUM_SIZE,
    datumQuad,
} from "./planePreview";

/**
 * Sketch planes returned on a datum pick, oriented Z-up (see `sketchPlaneOfFace`).
 * Index-parallel with DATUM_DISPLAY_PLANES: one quad is shown per entry.
 */
const DATUM_PLANES: ReadonlyArray<{ name: DatumPlaneName; plane: Plane }> = DATUM_PLANE_NAMES.map((name) => ({
    name,
    plane: datumPlaneOf(name),
}));

/** Display frames for the datum quads, in name order — see `datumDisplayPlane`. */
const DATUM_DISPLAY_PLANES = DATUM_PLANE_NAMES.map(datumDisplayPlane);

export type PlanePickResult =
    /**
     * `point` is where the pointer met the face's plane — the point the user clicked,
     * which the offset preview centres on.
     */
    | { kind: "face"; data: VisualShapeData; point: XYZ }
    /** A datum quad is a stand-in, not geometry: there is no clicked point to carry. */
    | { kind: "datum"; plane: Plane; name: DatumPlaneName };

/**
 * Where the ray meets the picked face's plane. A planar face lies in that plane, so this
 * is the point the pointer was over. Undefined only for a ray parallel to the plane — a
 * grazing hit, since this picker is single-mode and so never sweeps a rect.
 */
function facePlanePoint(data: VisualShapeData, view: IView, event: PointerEvent): XYZ | undefined {
    const world = data.shape.transformedMul(data.transform) as IFace;
    try {
        return planeOfFace(world).intersectRay(view.rayAt(event.offsetX, event.offsetY));
    } finally {
        world.dispose();
    }
}

/**
 * Picks the sketch base plane directly in the viewport: a planar face of a
 * solid takes precedence, otherwise one of the three translucent datum quads
 * shown while the handler is active.
 */
export class PlanePickHandler extends ShapeSelectionHandler {
    result: PlanePickResult | undefined;

    private readonly _datumMeshIds: number[] = [];
    private _hoveredDatum = -1;

    constructor(document: IDocument, controller: AsyncController) {
        super(document, ShapeTypes.face, false, controller, {
            allow: (shape) => (shape as IFace).surface().isPlanar(),
        });
        this.highlightState = VisualStates.faceHighlight;
        const context = document.visual.context;
        DATUM_DISPLAY_PLANES.forEach((plane, i) => {
            // On top: the quads are the only way to reach a datum plane, so a body in
            // front of one must not put it out of reach. Picking follows the drawing
            // (see `setHighlight`), so what is shown is also what is hit.
            const id = context.displayMesh([datumQuad(plane)], {
                meshOpacity: DATUM_OPACITY,
                onTop: true,
            });
            context.setMeshColor(id, DATUM_COLORS[DATUM_PLANES[i].name]);
            this._datumMeshIds.push(id);
        });
    }

    protected override setHighlight(view: IView, event: PointerEvent): void {
        const hovered = this.detectDatum(view.rayAt(event.offsetX, event.offsetY));
        if (hovered >= 0) {
            // Drawing and picking stay in step: a quad under the pointer wins over the
            // face behind it, so the face highlight has to come down.
            this.cleanHighlights();
        } else {
            super.setHighlight(view, event);
        }
        this.setHoveredDatum(view, hovered);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredDatum(view, -1);
    }

    private detectDatum(ray: Ray): number {
        return DATUM_DISPLAY_PLANES.findIndex((plane) => {
            const hit = plane.intersectRay(ray);
            if (hit === undefined) return false;
            const vec = hit.sub(plane.origin);
            const inRange = (v: number) => v >= DATUM_GAP && v <= DATUM_GAP + DATUM_SIZE;
            return inRange(vec.dot(plane.xvec)) && inRange(vec.dot(plane.yvec));
        });
    }

    private setHoveredDatum(view: IView, index: number): void {
        if (index === this._hoveredDatum) return;
        this._hoveredDatum = index;
        const context = this.document.visual.context;
        // Two cues at once: the quad comes up to solid and brightens. The opacity is
        // what carries the change — at 0.25 the hue alone barely moves the pixel.
        this._datumMeshIds.forEach((id, i) => {
            const hovered = i === index;
            const name = DATUM_PLANES[i].name;
            context.setMeshColor(id, (hovered ? DATUM_HIGHLIGHT_COLORS : DATUM_COLORS)[name]);
            context.setMeshOpacity(id, hovered ? DATUM_HOVER_OPACITY : DATUM_OPACITY);
        });
        view.update();
    }

    protected override select(view: IView, event: PointerEvent): number {
        // A hovered datum wins: the quads draw on top, so the pointer over one is
        // aiming at it, not at the face the ray would otherwise hit first.
        if (this._hoveredDatum >= 0) {
            const datum = DATUM_PLANES[this._hoveredDatum];
            this.result = { kind: "datum", plane: datum.plane, name: datum.name };
            return 1;
        }
        const face = this._highlights?.[0];
        const point = face === undefined ? undefined : facePlanePoint(face, view, event);
        if (face === undefined || point === undefined) return 0;
        this.result = { kind: "face", data: face, point };
        return 1;
    }

    protected override highlightNext(_view: IView): void {
        // no cycling: at most one face is highlighted
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        const context = this.document.visual.context;
        this._datumMeshIds.forEach((id) => {
            context.removeMesh(id);
        });
        this._datumMeshIds.length = 0;
    }
}
