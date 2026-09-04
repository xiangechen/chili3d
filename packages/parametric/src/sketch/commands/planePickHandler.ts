// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type FaceMeshData,
    type IDocument,
    type IFace,
    type IView,
    MeshGroup,
    Plane,
    type Ray,
    ShapeSelectionHandler,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";

const DATUM_PLANES = [Plane.XY, Plane.YZ, Plane.ZX];
const DATUM_SIZE = 150;
const DATUM_GAP = 50;
const DATUM_COLOR = 0x707070;
const DATUM_HIGHLIGHT_COLOR = 0x4a9eff;

export type PlanePickResult = { kind: "face"; data: VisualShapeData } | { kind: "datum"; plane: Plane };

/** Double-sided translucent quad in the plane's positive quadrant, with a gap from the axes. */
function datumQuad(plane: Plane): FaceMeshData {
    const { origin, xvec, yvec, normal } = plane;
    const corner = (u: number, v: number) => origin.add(xvec.multiply(u)).add(yvec.multiply(v));
    const [min, max] = [DATUM_GAP, DATUM_GAP + DATUM_SIZE];
    const corners = [corner(min, min), corner(max, min), corner(max, max), corner(min, max)];
    return {
        position: new Float32Array(corners.flatMap((c) => [c.x, c.y, c.z])),
        index: new Uint32Array([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]),
        normal: new Float32Array(corners.flatMap(() => [normal.x, normal.y, normal.z])),
        uv: new Float32Array(8),
        range: [],
        groups: [new MeshGroup({ start: 0, count: 12, materialIndex: 0 })],
        color: DATUM_COLOR,
    };
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
        for (const plane of DATUM_PLANES) {
            this._datumMeshIds.push(context.displayMesh([datumQuad(plane)], { meshOpacity: 0.25 }));
        }
    }

    protected override setHighlight(view: IView, event: PointerEvent): void {
        super.setHighlight(view, event);
        const hovered = this._highlights?.length
            ? -1
            : this.detectDatum(view.rayAt(event.offsetX, event.offsetY));
        this.setHoveredDatum(view, hovered);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredDatum(view, -1);
    }

    private detectDatum(ray: Ray): number {
        return DATUM_PLANES.findIndex((plane) => {
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
        this._datumMeshIds.forEach((id, i) => {
            context.setMeshColor(id, i === index ? DATUM_HIGHLIGHT_COLOR : DATUM_COLOR);
        });
        view.update();
    }

    protected override select(_view: IView, _event: PointerEvent): number {
        const face = this._highlights?.[0];
        if (face !== undefined) {
            this.result = { kind: "face", data: face };
            return 1;
        }
        if (this._hoveredDatum >= 0) {
            this.result = { kind: "datum", plane: DATUM_PLANES[this._hoveredDatum] };
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
