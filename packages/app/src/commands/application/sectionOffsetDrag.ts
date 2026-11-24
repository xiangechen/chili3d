// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    type ArrowDisplayMesh,
    ArrowHandle,
    type AsyncController,
    arrowMeshes,
    distanceToSegment,
    type IDocument,
    type IEventHandler,
    type IView,
    type IVisualObject,
    MeshDataUtils,
    PubSub,
    projectAxisValue,
    SectionPlaneNode,
    ShapeTypes,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import {
    isRotationHandleHit,
    projectRotationValue,
    rotationHandleDistance,
    rotationHandleMesh,
    rotationHandleMidpoint,
    type SectionRotationAxis,
    type SectionRotationHandle,
    sectionRotationHandle,
} from "./sectionRotationHandles";

type SectionHandle = "offset" | SectionRotationAxis;

interface SectionPick {
    visual: IVisualObject;
    node: SectionPlaneNode;
}

const MOUSE_MIDDLE = 4;

function wrappedAngleDelta(value: number): number {
    return ((value + 540) % 360) - 180;
}

export interface SectionOffsetDragData {
    readonly anchor: XYZ;
    readonly normal: XYZ;
    readonly xvec: XYZ;
    readonly yvec: XYZ;
    direction(): XYZ;
    flipped(): boolean;
    offset(): number;
    setOffset(value: number): void;
    angle(axis: SectionRotationAxis): number;
    setAngle(axis: SectionRotationAxis, value: number): void;
    onDragStart?(): void;
    onDragEnd?(): void;
}

export class SectionOffsetDragHandler implements IEventHandler {
    isEnabled = true;

    private readonly arrowHandle: ArrowHandle;
    private hovered?: SectionHandle;
    private dragging?: SectionHandle;
    private rotationGesture?: SectionRotationHandle;
    private lastRotationValue?: number;
    private grabOffset = 0;
    private capturedPointer?: { dom: HTMLElement; id: number };
    private sectionHover?: IVisualObject;
    private sectionPointerDown?: SectionPick;
    private disposed = false;

    constructor(
        readonly document: IDocument,
        private readonly controller: AsyncController,
        private readonly data: SectionOffsetDragData,
    ) {
        this.arrowHandle = new ArrowHandle(document, (view) => this.refreshArrow(view), true);
    }

    start(view: IView): void {
        this.refreshArrow(view);
    }

    refreshArrow(view?: IView): void {
        if (this.disposed) return;
        const { start, direction } = this.arrowSegment();
        if (view) this.arrowHandle.updateScale(view, start, direction);
        const length = this.arrowHandle.handleLength;
        const arrowColor = this.hovered === "offset" ? ARROW_HOVER_COLOR : ARROW_COLOR;
        const meshes: ArrowDisplayMesh[] = arrowMeshes(start, direction, length, arrowColor).map((data) => ({
            data,
            kind: "face",
        }));
        const centerColor = this.hovered === "x" || this.hovered === "y" ? ARROW_HOVER_COLOR : ARROW_COLOR;
        const midpoint = rotationHandleMidpoint(this.rotationHandle("x"));
        meshes.push({ data: MeshDataUtils.createVertexMesh(midpoint, 6, centerColor), kind: "vertex" });
        for (const axis of ["x", "y"] as const) {
            const handle = sectionRotationHandle(
                axis,
                start,
                this.arcDirection(),
                this.data.xvec,
                this.data.yvec,
                length,
            );
            const color = this.hovered === axis ? ARROW_HOVER_COLOR : ARROW_COLOR;
            meshes.push(
                ...rotationHandleMesh(handle, color).map((data) => ({ data, kind: "line" as const })),
            );
        }
        this.arrowHandle.replace(meshes);
        this.document.visual.update();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button !== 0 || !event.isPrimary) return;
        const handle = this.handleAt(view, event);
        if (handle === undefined) {
            this.sectionPointerDown = this.sectionAt(view, event);
            if (this.sectionPointerDown) event.preventDefault();
            return;
        }
        this.sectionPointerDown = undefined;
        event.preventDefault();
        this.dragging = handle;
        if (handle === "offset") {
            this.grabOffset = this.projectOffset(view, event) - this.data.offset();
        } else {
            this.rotationGesture = this.rotationHandle(handle);
            const projection = projectRotationValue(view, event, this.rotationGesture);
            if (projection === undefined) {
                this.dragging = undefined;
                this.rotationGesture = undefined;
                this.lastRotationValue = undefined;
                return;
            }
            this.lastRotationValue = projection;
        }
        this.data.onDragStart?.();
        if (view.dom) {
            view.dom.setPointerCapture(event.pointerId);
            this.capturedPointer = { dom: view.dom, id: event.pointerId };
        }
        this.setHovered(view, handle);
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === MOUSE_MIDDLE) return;
        if (this.dragging === undefined) this.updateSectionHover(view, event);
        if (this.dragging !== undefined && event.buttons === 0) {
            this.endDrag(event);
            return;
        }
        if (this.dragging === "offset") {
            event.preventDefault();
            const value = this.projectOffset(view, event) - this.grabOffset;
            this.data.setOffset(value);
            this.showValue(value, "");
        } else if (
            this.dragging !== undefined &&
            this.rotationGesture !== undefined &&
            this.lastRotationValue !== undefined
        ) {
            event.preventDefault();
            const projection = projectRotationValue(view, event, this.rotationGesture);
            if (projection === undefined) return;
            const value =
                this.data.angle(this.dragging) + wrappedAngleDelta(projection - this.lastRotationValue);
            this.lastRotationValue = projection;
            this.data.setAngle(this.dragging, value);
            this.showValue(value, "°");
        } else {
            this.setHovered(view, this.handleAt(view, event));
        }
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (this.dragging !== undefined) {
            this.endDrag(event);
            return;
        }
        const picked = this.sectionPointerDown;
        this.sectionPointerDown = undefined;
        if (!picked) return;
        if (this.sectionAt(view, event)?.visual === picked.visual) {
            this.document.selection.setSelectedNodes([picked.node], event.shiftKey === true);
        }
        event.preventDefault();
    }

    pointerCancel(_view: IView, event: PointerEvent): void {
        this.sectionPointerDown = undefined;
        this.endDrag(event);
    }

    pointerOut(view: IView, _event: PointerEvent): void {
        this.sectionPointerDown = undefined;
        this.updateSectionHover(view, undefined);
        if (this.dragging === undefined) this.setHovered(view, undefined);
    }

    keyDown(_view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") this.controller.cancel();
        else if (event.key === "Enter" || event.key === " ") this.controller.success();
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    dispose(): void {
        if (this.disposed) return;
        this.endDrag();
        this.disposed = true;
        this.sectionPointerDown = undefined;
        this.updateSectionHover(undefined, undefined);
        this.releasePointer();
        this.arrowHandle.dispose();
        PubSub.default.pub("clearFloatTip");
        this.document.visual.update();
    }

    private endDrag(event?: PointerEvent): void {
        this.releasePointer();
        if (this.dragging === undefined) return;
        event?.preventDefault();
        this.dragging = undefined;
        this.rotationGesture = undefined;
        this.lastRotationValue = undefined;
        PubSub.default.pub("clearFloatTip");
        this.data.onDragEnd?.();
    }

    private releasePointer(): void {
        const captured = this.capturedPointer;
        this.capturedPointer = undefined;
        if (captured?.dom.hasPointerCapture(captured.id)) {
            captured.dom.releasePointerCapture(captured.id);
        }
    }

    private arrowSegment(): { start: XYZ; direction: XYZ } {
        return {
            start: this.data.anchor.add(this.data.normal.multiply(this.data.offset())),
            direction: this.data.direction(),
        };
    }

    private arcDirection(): XYZ {
        return this.data.flipped() ? this.data.normal.multiply(-1) : this.data.normal;
    }

    private rotationHandle(axis: SectionRotationAxis): SectionRotationHandle {
        const { start } = this.arrowSegment();
        const length = this.arrowHandle.handleLength;
        return sectionRotationHandle(
            axis,
            start,
            this.arcDirection(),
            this.data.xvec,
            this.data.yvec,
            length,
        );
    }

    private sectionAt(view: IView, event: MouseEvent): SectionPick | undefined {
        for (const visual of view.detectVisual(event.offsetX, event.offsetY)) {
            const node = this.document.visual.context.getNode(visual);
            if (node instanceof SectionPlaneNode) return { visual, node };
        }
        return undefined;
    }

    private updateSectionHover(view: IView | undefined, event: MouseEvent | undefined): void {
        const next = view && event ? this.sectionAt(view, event)?.visual : undefined;
        if (next === this.sectionHover) return;
        if (this.sectionHover) {
            this.document.visual.highlighter.removeState(
                this.sectionHover,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
        }
        this.sectionHover = next;
        if (next) {
            this.document.visual.highlighter.addState(next, VisualStates.edgeHighlight, ShapeTypes.shape);
        }
    }

    private handleAt(view: IView, event: PointerEvent): SectionHandle | undefined {
        const { start, direction } = this.arrowSegment();
        const end = start.add(direction.multiply(this.arrowHandle.handleLength));
        const a = view.worldToScreen(start);
        const b = view.worldToScreen(end);
        let best = distanceToSegment(event.offsetX, event.offsetY, a, b);
        let handle: SectionHandle | undefined = isRotationHandleHit(best) ? "offset" : undefined;
        for (const axis of ["x", "y"] as const) {
            const distance = rotationHandleDistance(view, event, this.rotationHandle(axis));
            if (isRotationHandleHit(distance) && distance < best) {
                best = distance;
                handle = axis;
            }
        }
        return handle;
    }

    private projectOffset(view: IView, event: PointerEvent): number {
        return projectAxisValue(view, this.data.anchor, this.data.normal, event);
    }

    private setHovered(view: IView, hovered: SectionHandle | undefined): void {
        if (this.hovered === hovered) return;
        this.hovered = hovered;
        this.refreshArrow(view);
    }

    private showValue(value: number, suffix: string): void {
        PubSub.default.pub("showFloatTip", { level: "info", msg: `${value.toFixed(2)}${suffix}` });
    }
}
