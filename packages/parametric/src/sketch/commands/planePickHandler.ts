// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IFace,
    type IView,
    Plane,
    type Ray,
    ShapeSelectionHandler,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { DATUM_PLANE_NAMES, type DatumPlaneName, datumPlaneOf } from "../planeRef";
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

/**
 * Display frames for the datum quads: each quad stays in the positive quadrant so the
 * three pick quads stay symmetric around the origin. This is decoupled from the sketch
 * plane orientation — `Plane.ZX` is Z-up (xvec = −X) but its quad still shows in +X+Z.
 */
const DATUM_DISPLAY_PLANES = [
    Plane.XY,
    Plane.YZ,
    new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitZ }),
];

export type PlanePickResult =
    | { kind: "face"; data: VisualShapeData }
    | { kind: "datum"; plane: Plane; name: DatumPlaneName };

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

    protected override select(_view: IView, _event: PointerEvent): number {
        // A hovered datum wins: the quads draw on top, so the pointer over one is
        // aiming at it, not at the face the ray would otherwise hit first.
        if (this._hoveredDatum >= 0) {
            const datum = DATUM_PLANES[this._hoveredDatum];
            this.result = { kind: "datum", plane: datum.plane, name: datum.name };
            return 1;
        }
        const face = this._highlights?.[0];
        if (face !== undefined) {
            this.result = { kind: "face", data: face };
            return 1;
        }
        return 0;
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
