// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { AsyncController } from "../foundation";
import { Plane, type Ray, XYZ } from "../math";
import { isReferenceGeometryNode } from "../selectionFilter";
import { type FaceMeshData, type IFace, MeshGroup, ShapeTypes } from "../shape";
import { type IView, type VisualShapeData, VisualStates } from "../visual";
import { ShapeSelectionHandler } from "./shapeSelectionEventHandler";

export type DatumPlaneName = "XY" | "YZ" | "ZX";
export const DATUM_PLANE_NAMES: readonly DatumPlaneName[] = ["XY", "YZ", "ZX"];
export const DATUM_SIZE = 150;
export const DATUM_PREVIEW_SIZE = 300;
export const DATUM_GAP = 50;
export const DATUM_COLOR = 0x707070;
export const DATUM_OPACITY = 0.25;
export const DATUM_HOVER_OPACITY = 0.7;
export const DATUM_COLORS: Record<DatumPlaneName, number> = {
    YZ: 0xe06c6c,
    ZX: 0x6cc46c,
    XY: 0x6c9ce0,
};
export const DATUM_HIGHLIGHT_COLORS: Record<DatumPlaneName, number> = {
    YZ: 0xff9a9a,
    ZX: 0x9aff9a,
    XY: 0x9ac4ff,
};

const DATUM_PLANES: Record<DatumPlaneName, Plane> = {
    XY: Plane.XY,
    YZ: Plane.YZ,
    ZX: Plane.ZX,
};
const DATUM_DISPLAY_PLANES: Record<DatumPlaneName, Plane> = {
    XY: Plane.XY,
    YZ: Plane.YZ,
    ZX: new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitZ }),
};

export function datumPlaneOf(name: DatumPlaneName): Plane {
    return DATUM_PLANES[name];
}

export function datumDisplayPlane(name: DatumPlaneName): Plane {
    return DATUM_DISPLAY_PLANES[name];
}

export interface DatumPlaneSpec {
    readonly name: DatumPlaneName;
    readonly plane: Plane;
    readonly display: Plane;
}

export const DATUMS: readonly DatumPlaneSpec[] = DATUM_PLANE_NAMES.map((name) => ({
    name,
    plane: datumPlaneOf(name),
    display: datumDisplayPlane(name),
}));

export function quadAt(plane: Plane, center: XYZ, width: number, height: number): FaceMeshData {
    const { xvec, yvec, normal } = plane;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const corner = (u: number, v: number) => center.add(xvec.multiply(u)).add(yvec.multiply(v));
    const corners = [
        corner(-halfWidth, -halfHeight),
        corner(halfWidth, -halfHeight),
        corner(halfWidth, halfHeight),
        corner(-halfWidth, halfHeight),
    ];
    return {
        position: new Float32Array(corners.flatMap((point) => [point.x, point.y, point.z])),
        index: new Uint32Array([0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]),
        normal: new Float32Array(corners.flatMap(() => [normal.x, normal.y, normal.z])),
        uv: new Float32Array(8),
        range: [],
        groups: [new MeshGroup({ start: 0, count: 12, materialIndex: 0 })],
        color: DATUM_COLOR,
    };
}

export function datumQuadCenter(plane: Plane, size: number = DATUM_SIZE): XYZ {
    const half = DATUM_GAP + size / 2;
    return plane.origin.add(plane.xvec.multiply(half)).add(plane.yvec.multiply(half));
}

export function datumQuadAt(plane: Plane, center: XYZ, size: number = DATUM_SIZE): FaceMeshData {
    return quadAt(plane, center, size, size);
}

export function datumQuad(plane: Plane, size: number = DATUM_SIZE): FaceMeshData {
    return datumQuadAt(plane, datumQuadCenter(plane, size), size);
}

export interface DatumPickResult {
    readonly kind: "datum";
    readonly plane: Plane;
    readonly point?: XYZ;
}

export interface FacePickResult {
    readonly kind: "face";
    readonly data: VisualShapeData;
    readonly point?: XYZ;
}

export type PlanePickResult = DatumPickResult | FacePickResult;

export interface PlanePickOptions {
    readonly allowCurved?: boolean;
    readonly unlit?: boolean;
    readonly excludeReferenceGeometry?: boolean;
}

export abstract class PlanePickHandler<TResult> extends ShapeSelectionHandler {
    result?: TResult;
    private readonly datumMeshIds: number[] = [];
    private hoveredDatum = -1;

    constructor(document: IDocument, controller: AsyncController, options: PlanePickOptions = {}) {
        super(
            document,
            ShapeTypes.face,
            false,
            controller,
            { allow: (shape) => options.allowCurved || (shape as IFace).surface().isPlanar() },
            options.excludeReferenceGeometry
                ? { allow: (node) => !isReferenceGeometryNode(node) }
                : undefined,
        );
        this.highlightState = VisualStates.faceHighlight;
        for (const datum of DATUMS) {
            const id = document.visual.context.displayMesh([datumQuad(datum.display)], {
                meshOpacity: DATUM_OPACITY,
                onTop: true,
                unlit: options.unlit === true ? true : undefined,
            });
            document.visual.context.setMeshColor(id, DATUM_COLORS[datum.name]);
            this.datumMeshIds.push(id);
        }
    }

    protected abstract createDatumResult(datum: DatumPlaneSpec, ray: Ray): TResult;
    protected abstract createFaceResult(
        face: VisualShapeData,
        view: IView,
        event: PointerEvent,
    ): TResult | undefined;

    protected override setHighlight(view: IView, event: PointerEvent): void {
        const hovered = this.detectDatum(view.rayAt(event.offsetX, event.offsetY));
        if (hovered >= 0) this.cleanHighlights();
        else super.setHighlight(view, event);
        this.setHoveredDatum(view, hovered);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredDatum(view, -1);
    }

    protected detectDatum(ray: Ray): number {
        return DATUMS.findIndex(({ display }) => {
            const hit = display.intersectRay(ray);
            if (!hit) return false;
            const offset = hit.sub(display.origin);
            const inRange = (value: number) => value >= DATUM_GAP && value <= DATUM_GAP + DATUM_SIZE;
            return inRange(offset.dot(display.xvec)) && inRange(offset.dot(display.yvec));
        });
    }

    protected setHoveredDatum(view: IView, index: number): void {
        if (index === this.hoveredDatum) return;
        this.hoveredDatum = index;
        const context = this.document.visual.context;
        this.datumMeshIds.forEach((id, at) => {
            const name = DATUMS[at].name;
            context.setMeshColor(id, (index === at ? DATUM_HIGHLIGHT_COLORS : DATUM_COLORS)[name]);
            context.setMeshOpacity(id, index === at ? DATUM_HOVER_OPACITY : DATUM_OPACITY);
        });
        view.update();
    }

    protected override select(view: IView, event: PointerEvent): number {
        const ray = view.rayAt(event.offsetX, event.offsetY);
        if (this.hoveredDatum >= 0) {
            this.result = this.createDatumResult(DATUMS[this.hoveredDatum], ray);
            return 1;
        }
        const face = this._highlights?.[0];
        if (!face) return 0;
        const result = this.createFaceResult(face, view, event);
        if (!result) return 0;
        this.result = result;
        return 1;
    }

    protected override highlightNext(): void {}

    protected override disposeInternal(): void {
        super.disposeInternal();
        for (const id of this.datumMeshIds) this.document.visual.context.removeMesh(id);
        this.datumMeshIds.length = 0;
    }
}
