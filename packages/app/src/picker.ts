// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type CursorType,
    type I18nKeys,
    type IDocument,
    type IEventHandler,
    type IPicker,
    Logger,
    NodeSelectionHandler,
    type PickControl,
    type PickNodeOptions,
    type PickShapeOptions,
    PubSub,
    ShapeTypes,
    SubshapeSelectionHandler,
    type VisualNode,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";

export class Picker implements IPicker {
    constructor(readonly document: IDocument) {}

    async pickShape(
        prompt: I18nKeys,
        controller: AsyncController,
        options?: PickShapeOptions,
    ): Promise<VisualShapeData[]> {
        const shapeType = options?.shapeType ?? ShapeTypes.shape;
        const multi = options?.multi ?? false;
        const handler = new SubshapeSelectionHandler(
            this.document,
            shapeType,
            multi,
            controller,
            options?.shapeFilter,
            options?.nodeFilter,
        );
        // Face picks default to a filled-face tint; edge/vertex picks keep the outline states.
        const isFacePick = shapeType === ShapeTypes.face;
        handler.selectedState =
            options?.selectedState ?? (isFacePick ? VisualStates.faceSelected : VisualStates.edgeSelected);
        handler.highlightState =
            options?.highlightState ?? (isFacePick ? VisualStates.faceHighlight : VisualStates.edgeHighlight);
        handler.canFinish = options?.canFinish;
        handler.sortDetected = options?.sortDetected;
        await this.pickAsync(handler, prompt, controller, pickControl(multi, options));
        return this.document.selection.getSelectedShapes();
    }

    async pickNode(
        prompt: I18nKeys,
        controller: AsyncController,
        options?: PickNodeOptions,
    ): Promise<VisualNode[]> {
        const multi = options?.multi ?? false;
        const handler = new NodeSelectionHandler(this.document, multi, controller, options?.nodeFilter);
        await this.pickAsync(handler, prompt, controller, multi ? "selection" : "none");
        return this.document.selection.getSelectedNodes() as VisualNode[];
    }

    async pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        control: PickControl,
        cursor: CursorType = "select.default",
    ): Promise<void> {
        const oldHandler = this.document.visual.eventHandler;
        this.document.visual.eventHandler = handler;
        PubSub.default.pub("viewCursor", cursor);
        PubSub.default.pub("statusBarTip", prompt);
        if (control !== "none") PubSub.default.pub(bars[control], controller);

        try {
            await new Promise<void>((resolve, reject) => {
                controller.onCompleted(() => resolve());
                controller.onCancelled(() => {
                    Logger.debug("pick cancelled");
                    resolve();
                });
                controller.onFailed((e) => reject(e));
            });
        } catch (e: unknown) {
            Logger.warn("pick error: ", e);
        } finally {
            if (control !== "none") PubSub.default.pub("clearSelectionControl");
            PubSub.default.pub("clearStatusBarTip");
            // Only take back the handler this session installed. Something else may have
            // put its own in place while the session was open — a sketch session tearing
            // down under a nested drag restores the handler from *before* the sketch, and
            // writing `oldHandler` back over that would install a disposed handler the
            // viewport would keep dispatching into.
            if (this.document.visual.eventHandler === handler) {
                this.document.visual.eventHandler = oldHandler;
            }
            PubSub.default.pub("viewCursor", "default");
        }
    }
}

/** Both bars clear through `clearSelectionControl` — one bar is up at a time. */
const bars = {
    confirm: "showConfirmControl",
    selection: "showSelectionControl",
} as const;

/** A multi pick always reports its count; a single pick shows a bar only when asked. */
function pickControl(multi: boolean, options: PickShapeOptions | undefined): PickControl {
    if (multi) return "selection";
    return options?.showConfirmControl === true ? "confirm" : "none";
}
