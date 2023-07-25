// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, I18n, IDocument, XYZ } from "chili-core";

import { SnapedData, Snapper, SnapValidator } from "../snap";

export interface IStep {
    execute(document: IDocument, token: AsyncState): Promise<SnapedData | undefined>;
}

export interface ValidatorData {
    validator?: SnapValidator;
}

export abstract class StepBase<D extends ValidatorData> implements IStep {
    constructor(
        readonly tip: keyof I18n,
        readonly handleData: () => D,
        readonly disableDefaultValidator = false
    ) {}

    async execute(document: IDocument, token: AsyncState): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (!this.disableDefaultValidator && data.validator === undefined) {
            data.validator = (p) => this.validator(data, p);
        }
        let snapper = this.snapper(data);
        return await snapper.snap(document, this.tip, token);
    }

    protected abstract snapper(data: D): Snapper;

    protected abstract validator(data: D, point: XYZ): boolean;
}
