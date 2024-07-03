// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18nKeys, IDocument, XYZ } from "chili-core";
import { SnapData, SnapEventHandler, SnapedData } from "../snap";

export interface IStep {
    execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined>;
}

export abstract class Step<D extends SnapData> implements IStep {
    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => D,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        let data = this.handleStepData();
        if (data.validators === undefined) data.validators = [];
        data.validators.push((point) => this.validator(data, point));
        let executorHandler = this.getEventHandler(document, controller, data);
        await document.selection.pickAsync(executorHandler, this.tip, controller, false, "draw");
        return controller.result?.status === "success" ? executorHandler.snaped : undefined;
    }

    protected abstract getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: D,
    ): SnapEventHandler;

    protected abstract validator(data: D, point: XYZ): boolean;
}
