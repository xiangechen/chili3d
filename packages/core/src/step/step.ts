// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { AsyncController } from "../foundation";
import type { I18nKeys } from "../i18n";
import type { XYZ } from "../math";
import type { SnapData, SnapEventHandler, SnapResult } from "../snap";
import type { CursorType } from "../visual";

export interface IStep {
    execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined>;
}

export abstract class SnapStep<D extends SnapData> implements IStep {
    protected cursor: CursorType = "draw";

    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => D,
        private readonly keepSelected: boolean = false,
        /**
         * Show the bare confirm/cancel bar while this step snaps, so a loop that keeps
         * calling it can be ended from the viewport instead of a button on the command
         * panel. Off by default: a step that takes one point per click needs no bar.
         */
        private readonly showConfirmControl: boolean = false,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        if (!this.keepSelected) {
            document.selection.clearSelection();
        }

        const data = this.handleStepData();
        if (data.beforeExecute) {
            data.beforeExecute();
        }

        this.setValidator(data);

        const executorHandler = this.getEventHandler(document, controller, data);
        await document.picker.pickAsync(
            executorHandler,
            this.tip,
            controller,
            this.showConfirmControl ? "confirm" : "none",
            this.cursor,
        );
        const snaped = executorHandler.snaped;

        executorHandler.dispose();
        if (data.afterExecute) {
            data.afterExecute();
        }

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
