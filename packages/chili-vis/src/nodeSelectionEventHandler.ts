// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    IDocument,
    INode,
    INodeFilter,
    IView,
    IVisualObject,
    ShapeType,
    VisualNode,
    VisualState,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class NodeSelectionHandler extends SelectionHandler {
    private _highlights: IVisualObject[] | undefined;
    private _detectAtMouse: IVisualObject[] | undefined;
    private _lockDetected: IVisualObject | undefined; // 用于切换捕获的对象

    nodes(): VisualNode[] {
        return this.document.selection.getSelectedNodes() as VisualNode[];
    }

    constructor(
        document: IDocument,
        multiMode: boolean,
        controller?: AsyncController,
        readonly filter?: INodeFilter,
    ) {
        super(document, multiMode, controller);
    }

    protected override select(view: IView, event: PointerEvent): number {
        if (!this._highlights?.length) {
            this.clearSelected(this.document);
            return 0;
        }
        const models = this._highlights
            .map((x) => view.document.visual.context.getNode(x))
            .filter((x): x is INode => x !== undefined);
        this.document.selection.setSelection(models, event.shiftKey);
        return models.length;
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === 4) {
            return;
        }
        this._detectAtMouse = undefined;
        if (this.rect) {
            this.updateRect(this.rect, event);
        }
        let detecteds = this.getDetecteds(view, event);
        this.setHighlight(view, detecteds);
    }

    getDetecteds(view: IView, event: PointerEvent) {
        if (this.rect && this.mouse.x !== event.offsetX && this.mouse.y !== event.offsetY) {
            return view.detectVisualRect(
                this.mouse.x,
                this.mouse.y,
                event.offsetX,
                event.offsetY,
                this.filter,
            );
        }
        this._detectAtMouse = view.detectVisual(event.offsetX, event.offsetY, this.filter);
        const detected = this.getDetecting();
        return detected ? [detected] : [];
    }

    private getDetecting() {
        if (!this._detectAtMouse) return undefined;
        const index = this._lockDetected ? this.getDetcedtingIndex() : 0;
        return this._detectAtMouse[index] || undefined;
    }

    private getDetcedtingIndex() {
        if (!this._detectAtMouse) return -1;
        for (let i = 0; i < this._detectAtMouse.length; i++) {
            if (this._lockDetected === this._detectAtMouse[i]) {
                return i;
            }
        }
        return -1;
    }

    private setHighlight(view: IView, detecteds: IVisualObject[]) {
        this.cleanHighlights();
        detecteds.forEach((x) => {
            view.document.visual.highlighter.addState(x, VisualState.edgeHighlight, ShapeType.Shape);
        });
        this._highlights = detecteds;
        view.update();
    }

    protected override cleanHighlights(): void {
        this._highlights?.forEach((x) => {
            this.document.visual.highlighter.removeState(x, VisualState.edgeHighlight, ShapeType.Shape);
        });
        this._highlights = undefined;
    }

    protected override highlightNext(view: IView): void {
        if (this._detectAtMouse && this._detectAtMouse.length > 1) {
            const index = this._lockDetected
                ? (this.getDetcedtingIndex() + 1) % this._detectAtMouse.length
                : 1;
            this._lockDetected = this._detectAtMouse[index];
            const detected = this.getDetecting();
            if (detected) this.setHighlight(view, [detected]);
        }
    }

    override clearSelected(document: IDocument): void {
        document.selection.clearSelection();
    }
}
