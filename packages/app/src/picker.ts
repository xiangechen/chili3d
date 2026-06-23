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
        handler.selectedState = options?.selectedState ?? VisualStates.edgeSelected;
        handler.highlightState = options?.highlightState ?? VisualStates.edgeHighlight;
        await this.pickAsync(handler, prompt, controller, multi);
        return this.document.selection.getSelectedShapes();
    }

    async pickNode(
        prompt: I18nKeys,
        controller: AsyncController,
        options?: PickNodeOptions,
    ): Promise<VisualNode[]> {
        const multi = options?.multi ?? false;
        const handler = new NodeSelectionHandler(this.document, multi, controller, options?.nodeFilter);
        await this.pickAsync(handler, prompt, controller, multi);
        return this.document.selection.getSelectedNodes() as VisualNode[];
    }

    async pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = "select.default",
    ): Promise<void> {
        const oldHandler = this.document.visual.eventHandler;
        this.document.visual.eventHandler = handler;
        PubSub.default.pub("viewCursor", cursor);
        PubSub.default.pub("statusBarTip", prompt);
        if (showControl) PubSub.default.pub("showSelectionControl", controller);

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
            if (showControl) PubSub.default.pub("clearSelectionControl");
            PubSub.default.pub("clearStatusBarTip");
            this.document.visual.eventHandler = oldHandler;
            PubSub.default.pub("viewCursor", "default");
        }
    }
}
