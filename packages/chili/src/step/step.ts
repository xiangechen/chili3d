// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CursorType, I18nKeys, IDocument, XYZ } from "chili-core";
import { SnapData, SnapEventHandler, SnapResult } from "../snap";

export interface IStep {
    execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined>;
}

export abstract class SnapStep<D extends SnapData> implements IStep {
    protected cursor: CursorType = "draw";

    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => D,
        private readonly keepSelected: boolean = false,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        if (!this.keepSelected) {
            document.selection.clearSelection();
            document.visual.highlighter.clear();
        }

        const data = this.handleStepData();
        this.setValidator(data);

        const executorHandler = this.getEventHandler(document, controller, data);
        await document.selection.pickAsync(executorHandler, this.tip, controller, false, this.cursor);
        const snaped = executorHandler.snaped;
        
        executorHandler.dispose();

        return controller.result?.status === "success" ? snaped : undefined;
    }

    private setValidator(data: D) {
        const oldValidator = data.validator;
        data.validator = (point) => {
            if (oldValidator) {
                return oldValidator(point) && this.validator(data, point);
            }
            return this.validator(data, point);
        };
    }

    protected abstract getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: D,
    ): SnapEventHandler;

    protected abstract validator(data: D, point: XYZ): boolean;
}
