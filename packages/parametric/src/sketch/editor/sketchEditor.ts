// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type CameraType,
    type I18nKeys,
    type IDisposable,
    type IDocument,
    type IEventHandler,
    type IView,
    PubSub,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import type { ParametricBodyNode } from "../../parametricBodyNode";
import {
    ConstraintKind,
    isExternalEntityId,
    type SketchData,
    type SketchEntityType,
    type SketchPointRef,
    worldPerPixel,
} from "../sketchModel";
import type { SketchNode } from "../sketchNode";
import { computeSketchRollback, rollbackRestoreOrder } from "../sketchRollback";
import { SketchSolver, type SolveOutcome } from "../solver";
import * as datumPrompt from "./datumPrompt";
import { type DimensionAnchor, toDisplayDatum, toStorageDatum } from "./dimensionLayout";
import { SketchAnnotationManager } from "./sketchAnnotations";
import { SketchEventHandler } from "./sketchEventHandler";

/**
 * One sketch editing session, and the only thing that owns it.
 *
 * The object is created by `SketchEditor.enter(node)` and disposed by `exit()`; at most one is
 * live at a time (`getActive`). It owns the `SketchSolver`, swaps the view's event handler for
 * `SketchEventHandler`, locks the camera onto the sketch plane, and drives
 * `SketchAnnotationManager`. It is also the layer the sketch COMMANDS talk to — they call
 * `pickPoint`/`pickEntity`, `solve`, `commit`, `promptDatum`, and read `isPicking`.
 *
 * The session's four phases, in order:
 *
 * 1. **Enter** (`enter` → `startSession`, `createSessionSolver`, `installEventHandler`,
 *    `createAnnotations`, `lockCameraOntoPlane`). `applyTimelineRollback` rolls every dependent
 *    body back to this sketch's timeline position first — see `sketch/sketchRollback.ts` and §3
 *    of `docs/parametric.md`.
 * 2. **Editing** — picking (`pickPoint`/`pickEntity`/`pickPosition`, plus
 *    `handlePickPointerDown`), solving (`solve`), and the datum value dialogs
 *    (`promptDatum`/`promptDatumPair`/`editDatum`).
 * 3. **Commit** (`commit`) — writes the solved data back to the node.
 * 4. **Exit** (`exit` → `teardownSession`, `restoreRolledBackBodies`, `restoreViewState`,
 *    `dispose`) — unwinds the rollback in `rollbackRestoreOrder`, restores the camera and the
 *    pre-edit visibility, and clears the active-editor reference.
 *
 * The heavy lifting lives next door: `sketchEventHandler.ts` (pointer/keyboard), and
 * `sketchAnnotations.ts` (constraint badges and dimension graphics).
 */

export type SketchPickKind = "point" | "entity" | "position";

/** Entity type filter for picks: a single type or a set of acceptable types. */
export type SketchEntityTypeFilter = SketchEntityType | readonly SketchEntityType[];

/** Live-preview callback fed with the pointer uv on each move; undefined when off-plane. */
export type SketchPickPreview = (uv: [number, number] | undefined) => void;

interface PickRequest {
    kind: SketchPickKind;
    entityType?: SketchEntityTypeFilter;
    /** Entity picks only: also allow picking the datum X/Y axes. */
    datum?: boolean;
    preview?: SketchPickPreview;
    resolve: (value: any) => void;
}

interface SavedCamera {
    position: XYZ | undefined;
    target: XYZ | undefined;
    up: XYZ | undefined;
    type: CameraType;
}

/** Bodies rolled back for the session and their timeline positions (see `computeSketchRollback`). */
type RollbackMap = ReturnType<typeof computeSketchRollback>;

/** The live sketch session — see the module header for its lifecycle and ownership. */
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
    /** Visibility before the session; a consumed sketch is hidden but editing shows it. */
    private readonly savedVisible: boolean;
    /**
     * Bodies rolled back to the sketch's timeline position for the session
     * (`computeSketchRollback`), restored in `dispose`. Runtime-only — the feature
     * lists and the undo history never see it.
     */
    private readonly rollback: RollbackMap;

    /**
     * At most one sketch is edited at a time (`enter` exits any previous session),
     * so the active session is a private static. Enter with `enter`, leave it
     * (committing changes) with `exit` or Escape.
     */
    private static activeEditor?: SketchEditor;

    // ------------------------------------------------------------------ Static entry points — at most one session is live

    static getActive(): SketchEditor | undefined {
        return SketchEditor.activeEditor;
    }

    static enter(node: SketchNode): SketchEditor {
        SketchEditor.exit();
        // Profile faces are normally shown for picking; hide them while editing.
        node.setShowProfileFaces(false);
        try {
            const editor = new SketchEditor(node.document, node);
            SketchEditor.activeEditor = editor;
            node.document.application.mainWindow?.ribbon.openTab("ribbon.tab.sketch");
            return editor;
        } catch (error) {
            // The constructor already undid its own session state; this is the flag
            // enter() itself set.
            node.setShowProfileFaces(true);
            throw error;
        }
    }

    /** Closes the live session, if any — the instance counterpart is `exit` below. */
    static exit(): void {
        SketchEditor.activeEditor?.exit();
    }

    // ------------------------------------------------------------------ Construction

    constructor(
        readonly document: IDocument,
        readonly node: SketchNode,
    ) {
        // The only non-null assertion in here — resolve it before any session state
        // is written: enter() publishes the active editor only after the constructor
        // returns, so a later throw unwinds in this constructor's own catch, and this
        // one cannot strand anything.
        this.view = this.document.application.activeView!;
        const session = this.startSession();
        this.solver = session.solver;
        this.rollback = session.rollback;

        // From here on every step writes view/session state, and exit() stays a no-op
        // when the constructor throws (the active editor is published only after it
        // returns) — so each completed step queues its own undo, and a throw unwinds
        // the queue in reverse, then releases startSession as well.
        const teardown: Array<() => void> = [];
        try {
            this.savedCamera = this.captureCamera();
            this.savedWorkplane = this.view.workplane;
            this.savedHandler = document.visual.eventHandler;
            // queued before the camera move, so a throw mid-move still restores it
            teardown.push(() => this.restoreViewState());
            this.lockCameraOntoPlane(this.view);

            this.eventHandler = this.installEventHandler();
            teardown.push(() => {
                this.eventHandler.dispose();
                this.document.visual.eventHandler = this.savedHandler;
                this.setCanRotate(true);
            });

            this.savedVisible = this.showSketchForSession();
            teardown.push(() => {
                this.document.visual.context.setNodeOnTop([this.node], false);
                this.setNodeVisibleSilently(this.savedVisible);
            });

            this.annotations = this.createAnnotations();
            teardown.push(() => this.annotations.dispose());

            node.onPropertyChanged(this.onNodeDataChanged);
            teardown.push(() => this.node.removePropertyChanged(this.onNodeDataChanged));

            this.solve(true);
            PubSub.default.sub("activeViewChanged", this.onActiveViewChanged);
            teardown.push(() => PubSub.default.remove("activeViewChanged", this.onActiveViewChanged));
        } catch (error) {
            for (const undo of teardown.reverse()) {
                try {
                    undo();
                } catch {
                    // keep unwinding the remaining steps
                }
            }
            this.unwindSession();
            throw error;
        }
    }

    // ------------------------------------------------------------------ Session lifecycle: enter, rollback, teardown

    /**
     * Claims the session state (editing flag, timeline rollback, solver), unwinding
     * what it already wrote when a later step throws: exit() would be a permanent
     * no-op after a constructor throw — enter() publishes the active editor only
     * after the constructor returns (it restores the profile-face visibility it
     * set itself).
     */
    private startSession(): { rollback: RollbackMap; solver: SketchSolver } {
        // the session owns the solver and dataJson; the node skips its off-session
        // re-solve of external-reference followers while this flag is set
        this.node.setEditingSession(true);
        let rollback: RollbackMap | undefined;
        try {
            rollback = this.applyTimelineRollback();
            return { rollback, solver: this.createSessionSolver() };
        } catch (error) {
            try {
                if (rollback !== undefined) {
                    for (const body of rollbackRestoreOrder(rollback)) {
                        // per-body isolation like unwindSession/dispose: a throwing
                        // restore must not strand the bodies after it
                        try {
                            body.setRollbackIndex(undefined);
                        } catch {
                            // best effort — the body keeps displaying its last good shape
                        }
                    }
                }
            } finally {
                // … and nothing above may skip this — a sketch left session-owned
                // stops following its external references for good
                this.node.setEditingSession(false);
            }
            throw error;
        }
    }

    /**
     * Undoes startSession when a later constructor step throws: the session never
     * became active (enter() publishes it only after the constructor returns), so
     * dispose() will never run to release any of this.
     */
    private unwindSession(): void {
        for (const body of rollbackRestoreOrder(this.rollback)) {
            try {
                body.setRollbackIndex(undefined);
            } catch {
                // best effort — the body keeps displaying its last good shape
            }
        }
        this.node.setEditingSession(false);
        this.solver.dispose();
    }

    /**
     * Rolls dependent bodies back to the sketch's timeline position BEFORE the
     * solver loads: the rollback rebuild re-resolves the plane and the external
     * refs against the capture-time geometry, so the solver seeds exactly the
     * geometry the sketch was drawn on (later features stay hidden all session).
     */
    private applyTimelineRollback(): RollbackMap {
        const rollback = computeSketchRollback(this.document, this.node);
        const failed: ParametricBodyNode[] = [];
        for (const [body, index] of rollback) {
            // A throwing replay must be contained per body: escaping here would skip
            // the map handoff to startSession's catch and strand every body already
            // rolled back above.
            let applied = false;
            try {
                applied = body.setRollbackIndex(index);
            } catch {
                // falls through as a failed replay
            }
            if (!applied) failed.push(body);
        }
        for (const body of failed) {
            // the truncated replay failed — leaving the full chain displayed is
            // more honest than letting plane/external-ref resolution read the
            // later geometry as the sketch's timeline position
            rollback.delete(body);
            try {
                body.setRollbackIndex(undefined);
            } catch {
                // best effort — the body keeps displaying its last good shape
            }
        }
        if (failed.length > 0) {
            // PubSub.pub isolates subscriber exceptions, so this tip cannot escape
            // and skip the rollback-map handoff to startSession.
            PubSub.default.pub("statusBarTip", "sketch.rollbackFailed");
        }
        return rollback;
    }

    private createSessionSolver(): SketchSolver {
        const data = this.node.data;
        const solver = new SketchSolver(this.node.plane, data);
        // the anchor of the face the sketch sits on outlives its boundary refs
        solver.planeOwnerNodeId = this.node.planeRef?.nodeId;
        this.loadAnchors(data);
        return solver;
    }

    private captureCamera(): SavedCamera {
        const controller = this.view.cameraController;
        return {
            position: controller.cameraPosition,
            target: controller.cameraTarget,
            up: controller.cameraUp,
            type: controller.cameraType,
        };
    }

    private installEventHandler(): SketchEventHandler {
        const handler = new SketchEventHandler(this);
        // drop the pre-sketch selection so its highlight doesn't linger in sketch mode
        // (before the handler swap, so a throw here leaves the old handler in place)
        this.document.selection.clearSelection();
        this.document.visual.eventHandler = handler;
        this.setCanRotate(false);
        return handler;
    }

    /** Forces the sketch visible (and on top) for the session; returns the visibility to restore. */
    private showSketchForSession(): boolean {
        const visible = this.node.visible;
        this.setNodeVisibleSilently(true);
        // keep the sketch visible through occluding geometry for the session
        this.document.visual.context.setNodeOnTop([this.node], true);
        return visible;
    }

    private createAnnotations(): SketchAnnotationManager {
        return new SketchAnnotationManager(
            this.view,
            this.solver,
            this.dimensionAnchors,
            (ids) => this.eventHandler.highlightConstraintEntities(ids),
            (id) => this.editDatum(id),
            () => this.commit(),
        );
    }

    private readonly onActiveViewChanged = (view: IView | undefined) => {
        if (view === undefined || this.document !== view.document) {
            this.exit();
        }
    };

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
        if (history.isUndoing || history.isRedoing) {
            const data = this.node.data;
            this.solver.reset(data);
            this.loadAnchors(data);
            this.annotations.clearConstraintSelection();
            this.refreshExternalDisplay();
            this.solve(true);
            return;
        }
        // A source-part rebuild re-resolves the external references on the node behind
        // the solver's back (untransacted) — reseed the moved externals and re-solve.
        // Unchanged refs (e.g. the editor's own commit) are a cheap no-op.
        if (this.solver.syncExternalRefs(this.node.data.externalRefs ?? [])) {
            // A type-flipped ref cascades its constraints away untransacted — drop
            // their dimension anchors and surface the deletion instead of leaving
            // orphan anchors and a silent constraint loss.
            const removed = this.solver.lastRemovedConstraintIds;
            if (removed.length > 0) {
                for (const id of removed) this.dimensionAnchors.delete(id);
                this.annotations.deselectConstraints(removed);
                PubSub.default.pub("statusBarTip", "sketch.externalRefTypeChanged");
            }
            this.refreshExternalDisplay();
            this.solve(true);
        }
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

    readonly view: IView;

    // ------------------------------------------------------------------ Picking — the surface the sketch commands drive

    get isPicking(): boolean {
        return this.pickRequest !== undefined;
    }

    /** The pending pick request, used by the event handler for hover feedback. */
    get activePick():
        | {
              kind: SketchPickKind;
              entityType?: SketchEntityTypeFilter;
              datum?: boolean;
              preview?: SketchPickPreview;
          }
        | undefined {
        return this.pickRequest;
    }

    pickPoint(
        prompt: I18nKeys,
        preview?: SketchPickPreview,
        controller?: AsyncController,
    ): Promise<SketchPointRef | undefined> {
        return this.startPick("point", prompt, undefined, undefined, preview, controller);
    }

    pickEntity(
        prompt: I18nKeys,
        type?: SketchEntityTypeFilter,
        options?: { datum?: boolean },
        controller?: AsyncController,
    ): Promise<number | undefined> {
        return this.startPick("entity", prompt, type, options?.datum, undefined, controller);
    }

    pickPosition(
        prompt: I18nKeys,
        preview?: SketchPickPreview,
        controller?: AsyncController,
    ): Promise<[number, number] | undefined> {
        return this.startPick("position", prompt, undefined, undefined, preview, controller);
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
            value = this.eventHandler.hitTestEntity(view, event, request.entityType, request.datum ?? false);
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

    // ------------------------------------------------------------------ Solving, commit and deletion

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

    /**
     * Deletes entities and/or external references in one transaction: every constraint
     * referencing them is removed (with its dimension anchor), then the change commits
     * (undoable — the refs serialize through `dataJson`, so undo restores them via the
     * solver's `reset`).
     */
    deleteEntities(entityIds: Iterable<number>): void {
        if (this.disposed) return;
        const ids = [...entityIds];
        if (ids.length === 0) return;
        const removedConstraints: number[] = [];
        for (const entityId of ids) {
            // external references are not regular solver entities — they remove through their own flow
            const removed = isExternalEntityId(entityId)
                ? this.solver.removeExternalEntity(entityId)
                : this.solver.removeEntity(entityId);
            for (const constraintId of removed) {
                this.dimensionAnchors.delete(constraintId);
                removedConstraints.push(constraintId);
            }
        }
        this.annotations.deselectConstraints(removedConstraints);
        this.annotations.setHighlightedEntities([]);
        if (ids.some(isExternalEntityId)) this.refreshExternalDisplay();
        this.solve(true);
        this.commit();
    }

    /**
     * Re-renders the session overlays that follow the solver's geometry — the
     * external references and the entity point markers — after refs were added,
     * removed or re-resolved.
     */
    refreshExternalDisplay(): void {
        this.eventHandler.refreshGeometryOverlays();
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
        // toData re-derives external-ref roles from the constraints — a flip
        // (dashed ↔ solid) shows up only when the session display re-renders
        this.refreshExternalDisplay();
        this.document.visual.update();
    }

    // ------------------------------------------------------------------ Datum value dialogs

    /**
     * Shows the datum input in a modal dialog; a valid confirm runs `apply`, re-solves and
     * commits. Invalid input keeps the dialog open with an error message; cancelling keeps the
     * current value and runs `onCancel`. The dialog itself is `datumPrompt.ts`.
     */
    promptDatum(
        initial: number,
        apply: (value: number) => void,
        onCancel?: () => void,
        options?: { positiveOnly?: boolean },
    ): void {
        datumPrompt.promptDatum(initial, apply, () => this.applyDatum(), onCancel, options);
    }

    /** Two-value variant of `promptDatum` for multi-datum constraints (Fix = X, Y). */
    promptDatumPair(initial: [number, number], apply: (x: number, y: number) => void): void {
        datumPrompt.promptDatumPair(initial, apply, () => this.applyDatum());
    }

    /** What a confirmed datum does to the session, whatever the dialog looked like. */
    private applyDatum(): void {
        this.solve(true);
        this.commit();
    }

    /** Re-opens the datum dialog of an existing dimension constraint (double-click edit). */
    editDatum(constraintId: number): void {
        const constraint = this.solver.toData().constraints.find((x) => x.id === constraintId);
        if (constraint?.datums !== undefined) {
            this.promptDatumPair([constraint.datums[0], constraint.datums[1]], (x, y) => {
                this.solver.setDatum(constraintId, x, 0);
                this.solver.setDatum(constraintId, y, 1);
            });
            return;
        }
        if (constraint?.datum === undefined) return;
        // point-line and horizontal/vertical distances are signed; other datums stay positive
        const signed =
            constraint.kind === ConstraintKind.P2LDistance ||
            constraint.kind === ConstraintKind.HorizontalDistance ||
            constraint.kind === ConstraintKind.VerticalDistance;
        this.promptDatum(
            toDisplayDatum(constraint.kind, constraint.datum),
            (value) => this.solver.setDatum(constraintId, toStorageDatum(constraint.kind, value)),
            undefined,
            { positiveOnly: !signed },
        );
    }

    // ------------------------------------------------------------------ Exit and view restoration

    /** Commits and disposes this session; clears the active-editor reference. */
    exit(): void {
        if (this.disposed) return;
        if (SketchEditor.activeEditor === this) SketchEditor.activeEditor = undefined;
        try {
            this.commit();
        } finally {
            // a commit failure must not strand the session teardown
            this.node.setShowProfileFaces(true);
            this.setNodeVisibleSilently(this.savedVisible);
            this.node.document.application.mainWindow?.ribbon.closeTab("ribbon.tab.sketch");
            this.dispose();
        }
    }

    /** Sets the sketch's visibility without recording an undo history record. */
    private setNodeVisibleSilently(visible: boolean): void {
        const history = this.node.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            this.node.visible = visible;
        } finally {
            history.disabled = disabled;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelPick();
        this.document.visual.context.setNodeOnTop([this.node], false);
        this.node.setEditingSession(false);
        this.node.removePropertyChanged(this.onNodeDataChanged);
        try {
            this.restoreRolledBackBodies();
        } finally {
            this.teardownSession();
        }
    }

    /**
     * Restoring the full chain. For the sketch this is an ordinary source-node rebuild: with
     * the session flag already cleared, refs that later features moved re-resolve and pull
     * their followers, so the off-session follow semantics resume exactly where the rollback
     * paused them.
     *
     * - **Order.** Sources restore before the bodies consuming them (`rollbackRestoreOrder`),
     *   so no body re-evaluates against another's session preview.
     * - **A body deleted mid-session is skipped** — replaying it would leak a shape on the
     *   disposed node.
     * - **A failing replay** must strand neither the bodies after it (per-body isolation, like
     *   `startSession`/`unwindSession`) nor the teardown. `disposed` is already set, so there is
     *   no retry.
     */
    private restoreRolledBackBodies(): void {
        for (const body of rollbackRestoreOrder(this.rollback)) {
            if (this.document.modelManager.findNode((n) => n === body) === undefined) continue;
            try {
                body.setRollbackIndex(undefined);
            } catch {
                // best effort — the body keeps displaying its last good shape
            }
        }
    }

    private teardownSession(): void {
        this.eventHandler.dispose();
        this.annotations.dispose();
        this.document.visual.eventHandler = this.savedHandler;
        this.restoreViewState();
        this.setCanRotate(true);
        this.solver.dispose();
        PubSub.default.pub("clearStatusBarTip");
        PubSub.default.remove("activeViewChanged", this.onActiveViewChanged);
    }

    private restoreViewState(): void {
        if (this.view.isClosed) return;
        this.view.workplane = this.savedWorkplane;
        const controller = this.view.cameraController;
        if (this.savedCamera.position && this.savedCamera.target && this.savedCamera.up) {
            controller.lookAt(this.savedCamera.position, this.savedCamera.target, this.savedCamera.up);
        }
        controller.cameraType = this.savedCamera.type;
    }

    private startPick<T>(
        kind: SketchPickKind,
        prompt: I18nKeys,
        entityType?: SketchEntityTypeFilter,
        datum?: boolean,
        preview?: SketchPickPreview,
        controller?: AsyncController,
    ): Promise<T> {
        this.cancelPick();
        PubSub.default.pub("statusBarTip", prompt);
        return new Promise<T>((resolve) => {
            this.pickRequest = { kind, entityType, datum, preview, resolve };
            this.eventHandler.setController(this.view, controller);
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
