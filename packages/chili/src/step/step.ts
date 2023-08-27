// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncController, I18nKeys, IDocument, XYZ } from "chili-core";

import { SnapedData, Snapper, SnapValidator } from "../snap";

export interface IStep {
    execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined>;
}

export interface ValidatorData {
    validators?: SnapValidator[];
}

export abstract class StepBase<D extends ValidatorData> implements IStep {
    constructor(
        readonly tip: I18nKeys,
        readonly handleData: () => D,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (data.validators === undefined) data.validators = [];
        data.validators.push((point) => this.validator(data, point));
        let snapper = this.snapper(data);
        return await snapper.snap(document, this.tip, controller);
    }

    protected abstract snapper(data: D): Snapper;

    protected abstract validator(data: D, point: XYZ): boolean;
}
