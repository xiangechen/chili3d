// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IEventHandler,
    type INode,
    type IView,
    PubSub,
    type ShapeMeshData,
} from "@chili3d/core";

/** What a drag preview contributes: meshes to draw, and the nodes it stands in for. */
export interface DragPreview {
    meshes: ShapeMeshData[];
    /**
     * Nodes whose display the preview replaces — hidden for as long as it is shown.
     * A boolean preview *is* the target body with the operation applied, so the body
     * has to come down: drawn together, the two overlap and the result reads as a
     * ghost over the geometry it replaces instead of as the geometry itself.
     */
    hide?: INode[];
}

/**
 * Shared skeleton of a "preview hangs on the canvas until confirmed" handler: the temp-mesh
 * lifecycle, the confirm control, Enter/Space to commit and Escape to cancel. It has no
 * pointer gesture of its own — a subclass that wants one (an axis drag's arrow) layers it
 * on through the `refreshHandle`/`removeHandle` hooks and the pointer overrides.
 *
 * A subclass says what the preview looks like (`buildPreview`) and what may commit
 * (`canConfirm`); this class owns showing it and settling the controller.
 */
export abstract class PreviewConfirmHandler implements IEventHandler {
    isEnabled: boolean = true;

    /** The view that committed, handed back to the step. */
    commitView: IView | undefined;

    private _previewIds: number[] = [];
    /** Nodes the displayed preview hid (see `DragPreview.hide`). */
    private _hidden: INode[] = [];
    private _cleaned = false;

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
    ) {
        controller.onCancelled(() => this.cleanup());
        controller.onCompleted(() => this.cleanup());
        controller.onFailed(() => this.cleanup());
    }

    /**
     * Puts the preview on screen. The subclass calls this at the END of its own constructor,
     * once its state is in place — the hooks this triggers (`buildPreview`, ...) all read it,
     * and during `super(...)` the subclass's fields do not exist yet.
     */
    protected start(): void {
        this.refreshTempShapes(this.document.application.activeView);
        this.publishConfirmControl();
        this.onReady();
    }

    // ------------------------------------------------------------------ Subclass contract

    /** Preview geometry for the current value. */
    protected buildPreview(): DragPreview {
        return { meshes: [] };
    }
    /** Whether the current value may be committed. */
    protected canConfirm(): boolean {
        return true;
    }
    /** How opaque the preview meshes are drawn. */
    protected previewOpacity(): number {
        return 1;
    }
    /**
     * Whether the preview's faces keep their own colour instead of being shaded. Overlays
     * whose colour *is* the information (a handle's state, a marker) want this; previews that
     * stand in for geometry stay lit so they read as solids.
     */
    protected previewUnlit(): boolean {
        return false;
    }
    /**
     * Whether the preview ignores depth. A preview that stands in for a solid (a boolean
     * result) stays behind whatever is in front of it; a plane being placed does not.
     */
    protected previewOnTop(): boolean {
        return false;
    }
    /** Called once the handler is live and its first preview is up. */
    protected onReady(): void {}
    /** Runs after the preview meshes are up — ghosts, sibling display, ... */
    protected afterPreview(): void {}
    /**
     * Subclass teardown that must run BEFORE the temp meshes come down (the axis drag's
     * camera unhook, hover drop, ...). Called with the cleaned flag already set, so a
     * side effect that settles the controller re-enters `cleanup` harmlessly.
     */
    protected onCleanupStart(): void {}
    /** Extra teardown beyond the temp meshes this class owns, run after they come down. */
    protected onCleanup(): void {}
    /** A handle the gesture draws above the preview (an axis drag's arrow); a bare preview has none. */
    protected refreshHandle(_view?: IView): void {}
    /** Removes whatever `refreshHandle` drew. */
    protected removeHandle(): void {}

    /** Whether `cleanup` has run. */
    protected get cleaned(): boolean {
        return this._cleaned;
    }

    // ------------------------------------------------------------------ Pointer events

    pointerMove(_view: IView, _event: PointerEvent): void {}
    pointerDown(_view: IView, _event: PointerEvent): void {}
    pointerUp(_view: IView, _event: PointerEvent): void {}

    keyDown(_view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.controller.cancel();
        } else if (event.key === "Enter" || event.key === " ") {
            // Enter/Space confirms the pending value (and must not trigger HotKeyService).
            event.preventDefault();
            event.stopImmediatePropagation();
            this.confirm();
        }
    }

    dispose(): void {
        this.cleanup();
    }

    // ------------------------------------------------------------------ Command push-back

    /** The command asks for a preview rebuild after an option changed. */
    refresh(): void {
        this.refreshTempShapes();
    }

    protected confirm(): void {
        if (!this.canConfirm()) return;
        // The button/Enter has no pointer event to provide the view, so fall back to the
        // active view; without it the step returns undefined and the command closes as if
        // cancelled (e.g. confirming a cached value without dragging).
        if (this.commitView === undefined) {
            this.commitView = this.document.application.activeView;
        }
        this.controller.success();
    }

    /**
     * Shows the confirm/cancel buttons for the whole step, so a user who only edits the
     * options tab can still commit. The bare bar, not the selection one: there are no
     * picked shapes to count.
     */
    private publishConfirmControl(): void {
        PubSub.default.pub("showConfirmControl", {
            success: () => this.confirm(),
            cancel: () => this.controller.cancel(),
        } as unknown as AsyncController);
    }

    // ------------------------------------------------------------------ Temp meshes

    protected refreshTempShapes(view?: IView): void {
        this.refreshHandle(view);
        for (const id of this._previewIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._previewIds = [];
        this.restoreHiddenNodes();
        const preview = this.buildPreview();
        for (const mesh of preview.meshes) {
            this._previewIds.push(
                this.document.visual.context.displayMesh([mesh], {
                    meshOpacity: this.previewOpacity(),
                    onTop: this.previewOnTop(),
                    unlit: this.previewUnlit(),
                }),
            );
        }
        for (const node of preview.hide ?? []) {
            this.document.visual.context.setVisible(node, false);
            this._hidden.push(node);
        }
        this.afterPreview();
        this.document.visual.update();
    }

    /**
     * Brings back the nodes the displayed preview hid. Each goes back to what its own
     * flags say rather than to visible: a hidden body can still be the preview's target.
     */
    private restoreHiddenNodes(): void {
        for (const node of this._hidden) {
            this.document.visual.context.setVisible(node, node.visible && node.parentVisible);
        }
        this._hidden = [];
    }

    private removeTempShapes(): void {
        this.removeHandle();
        for (const id of this._previewIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._previewIds = [];
        this.restoreHiddenNodes();
    }

    /**
     * Tears the handler down exactly once: the flag goes up BEFORE any side effect runs,
     * so one that settles the controller (a PubSub notification, ...) re-enters harmlessly.
     * Never override this — subclass teardown goes in `onCleanupStart` (before the temp
     * meshes) or `onCleanup` (after); an override that ran its side effects ahead of
     * `super.cleanup()` would re-run them all on such a re-entry.
     */
    protected cleanup(): void {
        if (this._cleaned) return;
        this._cleaned = true;
        this.onCleanupStart();
        this.removeTempShapes();
        this.onCleanup();
        PubSub.default.pub("clearConfirmControl");
        this.document.visual.update();
    }
}
