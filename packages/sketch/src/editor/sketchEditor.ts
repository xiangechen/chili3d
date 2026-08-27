// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CameraType,
    I18n,
    type I18nKeys,
    type IDisposable,
    type IDocument,
    type IEventHandler,
    type IView,
    PubSub,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import { type SketchData, type SketchEntityType, type SketchPointRef, worldPerPixel } from "../sketchModel";
import type { SketchNode } from "../sketchNode";
import { SketchSolver, type SolveOutcome } from "../solver";
import type { DimensionAnchor } from "./dimensionLayout";
import { SketchAnnotationManager } from "./sketchAnnotations";
import { SketchEventHandler } from "./sketchEventHandler";

export type SketchPickKind = "point" | "entity" | "position";

/** Live-preview callback fed with the pointer uv on each move; undefined when off-plane. */
export type SketchPickPreview = (uv: [number, number] | undefined) => void;

interface PickRequest {
    kind: SketchPickKind;
    entityType?: SketchEntityType;
    preview?: SketchPickPreview;
    resolve: (value: any) => void;
}

interface SavedCamera {
    position: XYZ | undefined;
    target: XYZ | undefined;
    up: XYZ | undefined;
    type: CameraType;
}

/**
 * One sketch editing session: owns the solver, swaps the view's event handler,
 * locks the camera onto the sketch plane and renders constraint annotations.
 */
export class SketchEditor implements IDisposable {
    readonly solver: SketchSolver;
    readonly annotations: SketchAnnotationManager;
    /** Label anchors (relative to the referenced geometry) for datum constraints. */
    readonly dimensionAnchors = new Map<number, DimensionAnchor>();

    private readonly eventHandler: SketchEventHandler;
    private readonly savedHandler: IEventHandler;
    private readonly savedWorkplane: IView["workplane"];
    private readonly savedCamera: SavedCamera;
    private pickRequest?: PickRequest;
    private disposed = false;

    /**
     * At most one sketch is edited at a time (`enter` exits any previous session),
     * so the active session is a private static. Enter with `enter`, leave it
     * (committing changes) with `exit` or Escape.
     */
    private static activeEditor?: SketchEditor;

    static getActive(): SketchEditor | undefined {
        return SketchEditor.activeEditor;
    }

    static enter(node: SketchNode): SketchEditor {
        SketchEditor.exit();
        const editor = new SketchEditor(node.document, node);
        SketchEditor.activeEditor = editor;
        node.document.application.mainWindow?.ribbon.openTab("ribbon.tab.sketch");
        return editor;
    }

    static exit(): void {
        SketchEditor.activeEditor?.exit();
    }

    constructor(
        readonly document: IDocument,
        readonly node: SketchNode,
    ) {
        const data = node.data;
        this.solver = new SketchSolver(node.plane, data);
        this.loadAnchors(data);

        const view = this.view;
        const controller = view.cameraController;
        this.savedCamera = {
            position: controller.cameraPosition,
            target: controller.cameraTarget,
            up: controller.cameraUp,
            type: controller.cameraType,
        };
        this.savedWorkplane = view.workplane;
        this.savedHandler = document.visual.eventHandler;
        this.lockCameraOntoPlane(view);

        this.eventHandler = new SketchEventHandler(this);
        document.visual.eventHandler = this.eventHandler;
        this.setCanRotate(false);
        // drop the pre-sketch selection so its highlight doesn't linger in sketch mode
        document.selection.clearSelection();

        this.annotations = new SketchAnnotationManager(
            view,
            this.solver,
            this.dimensionAnchors,
            (ids) => this.eventHandler.highlightConstraintEntities(ids),
            (id) => this.editDatum(id),
        );
        node.onPropertyChanged(this.onNodeDataChanged);
        this.solve(true);
    }

    /** Loads saved datum anchors; constraint ids are stable, stale ones are dropped. */
    private loadAnchors(data: SketchData): void {
        const constraintIds = new Set(data.constraints.map((c) => c.id));
        this.dimensionAnchors.clear();
        for (const x of data.anchors ?? []) {
            if (constraintIds.has(x.id)) this.dimensionAnchors.set(x.id, x.anchor);
        }
    }

    /** Undo/redo rewrites the node data behind the solver's back — resync from it. */
    private readonly onNodeDataChanged = (property: string) => {
        if (property !== "dataJson" || this.disposed) return;
        const history = this.document.history;
        if (!history.isUndoing && !history.isRedoing) return;
        this.solver.reset(this.node.data);
        this.loadAnchors(this.node.data);
        this.annotations.clearConstraintSelection();
        this.solve(true);
    };

    /** Orthographic top-down view onto the sketch plane; the plane becomes the workplane. */
    private lockCameraOntoPlane(view: IView): void {
        const controller = view.cameraController;
        const plane = this.node.plane;
        const distance = controller.cameraPosition?.distanceTo(controller.cameraTarget) || 1000;
        controller.cameraType = "orthographic";
        controller.lookAt(plane.origin.add(plane.normal.multiply(distance)), plane.origin, plane.yvec);
        controller.fitContent();
        view.workplane = plane;
    }

    get view(): IView {
        const view = this.document.application.activeView;
        if (view === undefined) {
            throw new Error("Sketch editing requires an active view");
        }
        return view;
    }

    get isPicking(): boolean {
        return this.pickRequest !== undefined;
    }

    /** The pending pick request, used by the event handler for hover feedback. */
    get activePick():
        | { kind: SketchPickKind; entityType?: SketchEntityType; preview?: SketchPickPreview }
        | undefined {
        return this.pickRequest;
    }

    pickPoint(prompt: I18nKeys, preview?: SketchPickPreview): Promise<SketchPointRef | undefined> {
        return this.startPick("point", prompt, undefined, preview);
    }

    pickEntity(prompt: I18nKeys, type?: SketchEntityType): Promise<number | undefined> {
        return this.startPick("entity", prompt, type);
    }

    pickPosition(prompt: I18nKeys, preview?: SketchPickPreview): Promise<[number, number] | undefined> {
        return this.startPick("position", prompt, undefined, preview);
    }

    cancelPick(): void {
        const request = this.pickRequest;
        this.pickRequest = undefined;
        request?.resolve(undefined);
        this.annotations.suppressConstraintSymbols = false;
        this.publishSolveStatus({ result: "Ok", dofs: this.solver.dofs() });
    }

    /**
     * Called by the SketchEventHandler on pointerDown. Returns true when a pick
     * request consumed the event (picking suppresses dragging).
     */
    handlePickPointerDown(view: IView, event: PointerEvent): boolean {
        const request = this.pickRequest;
        if (request === undefined) return false;
        if (event.button === 2) {
            this.cancelPick();
            return true;
        }

        let value: unknown;
        if (request.kind === "point") {
            value = this.eventHandler.hitTestPoint(view, event);
        } else if (request.kind === "entity") {
            value = this.eventHandler.hitTestEntity(view, event, request.entityType);
        } else {
            value = this.eventHandler.pointerToUV(view, event);
        }

        if (value !== undefined) {
            this.pickRequest = undefined;
            this.annotations.suppressConstraintSymbols = false;
            request.resolve(value);
        }
        return true;
    }

    solve(fine: boolean): SolveOutcome {
        const outcome = this.solver.solve(fine);
        this.annotations.refresh();
        this.publishSolveStatus(outcome);
        return outcome;
    }

    /** Tolerance of 8 screen pixels in sketch-plane units at the view center (0 when unavailable). */
    screenTolerance(): number {
        const view = this.document.application.activeView;
        if (view === undefined) return 0;
        const size = worldPerPixel(view, this.node.plane, view.width / 2, view.height / 2);
        return size === undefined ? 0 : size * 8;
    }

    /** Deletes constraints (and their datum anchors), then commits (undoable). */
    deleteConstraints(constraintIds: Iterable<number>): void {
        if (this.disposed) return;
        const ids = [...constraintIds];
        if (ids.length === 0) return;
        for (const id of ids) {
            this.solver.removeConstraint(id);
            this.dimensionAnchors.delete(id);
        }
        this.annotations.deselectConstraints(ids);
        this.solve(true);
        this.commit();
    }

    /** Deletes entities with their constraints and anchors, then commits (undoable). */
    deleteEntities(entityIds: Iterable<number>): void {
        if (this.disposed) return;
        const ids = [...entityIds];
        if (ids.length === 0) return;
        const removedConstraints: number[] = [];
        for (const entityId of ids) {
            for (const constraintId of this.solver.removeEntity(entityId)) {
                this.dimensionAnchors.delete(constraintId);
                removedConstraints.push(constraintId);
            }
        }
        this.annotations.deselectConstraints(removedConstraints);
        this.annotations.setHighlightedEntities([]);
        this.solve(true);
        this.commit();
    }

    commit(): void {
        if (this.disposed) return;
        const data = this.solver.toData();
        if (this.dimensionAnchors.size > 0) {
            data.anchors = [...this.dimensionAnchors].map(([id, anchor]) => ({ id, anchor }));
        }
        Transaction.execute(this.document, "edit sketch", () => {
            this.node.setDataEmitShapeChanged(data);
        });
        this.document.visual.update();
    }

    /**
     * Shows the datum input in a modal dialog; a valid confirm runs `apply`,
     * re-solves and commits. Invalid input keeps the dialog open with an error
     * message; cancelling keeps the current value and runs `onCancel`.
     */
    promptDatum(initial: number, apply: (value: number) => void, onCancel?: () => void): void {
        const textbox = document.createElement("input");
        textbox.value = initial.toFixed(2);
        textbox.autofocus = true;
        const error = document.createElement("label");
        error.style.cssText = "color: red; font-size: 11px; display: none;";
        const content = document.createElement("div");
        content.append(textbox, error);
        PubSub.default.pub("showDialog", "dialog.title.enterValue", content, [
            {
                content: "common.confirm",
                // validation lives in shouldClose: the dialog runs onclick even when
                // shouldClose vetoes closing, so applying there would apply invalid values
                shouldClose: () => {
                    const value = Number(textbox.value);
                    if (!Number.isFinite(value) || value <= 0) {
                        error.textContent = I18n.translate("error.input.invalidNumber") ?? "invalid number";
                        error.style.display = "";
                        return false;
                    }
                    apply(value);
                    this.solve(true);
                    this.commit();
                    return true;
                },
                onclick: () => {},
            },
            { content: "common.cancel", onclick: () => onCancel?.() },
        ]);
        setTimeout(() => textbox.select());
    }

    /** Re-opens the datum dialog of an existing dimension constraint (double-click edit). */
    editDatum(constraintId: number): void {
        const constraint = this.solver.toData().constraints.find((x) => x.id === constraintId);
        if (constraint?.datum === undefined) return;
        this.promptDatum(constraint.datum, (value) => this.solver.setDatum(constraintId, value));
    }

    /** Commits and disposes this session; clears the active-editor reference. */
    exit(): void {
        if (this.disposed) return;
        if (SketchEditor.activeEditor === this) SketchEditor.activeEditor = undefined;
        this.commit();
        this.node.document.application.mainWindow?.ribbon.closeTab("ribbon.tab.sketch");
        this.dispose();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelPick();
        this.node.removePropertyChanged(this.onNodeDataChanged);
        this.eventHandler.dispose();
        this.document.visual.eventHandler = this.savedHandler;
        const view = this.document.application.activeView;
        if (view !== undefined) {
            view.workplane = this.savedWorkplane;
            const controller = view.cameraController;
            if (this.savedCamera.position && this.savedCamera.target && this.savedCamera.up) {
                controller.lookAt(this.savedCamera.position, this.savedCamera.target, this.savedCamera.up);
            }
            controller.cameraType = this.savedCamera.type;
        }
        this.setCanRotate(true);
        this.annotations.dispose();
        this.solver.dispose();
        PubSub.default.pub("clearStatusBarTip");
    }

    private startPick<T>(
        kind: SketchPickKind,
        prompt: I18nKeys,
        entityType?: SketchEntityType,
        preview?: SketchPickPreview,
    ): Promise<T> {
        this.cancelPick();
        PubSub.default.pub("statusBarTip", prompt);
        return new Promise<T>((resolve) => {
            this.pickRequest = { kind, entityType, preview, resolve };
            this.annotations.suppressConstraintSymbols = true;
        });
    }

    private publishSolveStatus(outcome: SolveOutcome): void {
        const key: I18nKeys = outcome.result.startsWith("Conflict")
            ? "sketch.conflicting"
            : outcome.dofs === 0
              ? "sketch.fullyConstrained"
              : "sketch.underConstrained";
        PubSub.default.pub("statusBarTip", key);
    }

    private setCanRotate(value: boolean): void {
        const handler = this.document.visual.viewHandler as unknown as Record<string, unknown>;
        if (handler !== null && typeof handler === "object" && "canRotate" in handler) {
            handler["canRotate"] = value;
        }
    }
}
