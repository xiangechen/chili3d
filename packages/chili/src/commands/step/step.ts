// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDocument, IView, XYZ } from "chili-core";
import { SnapedData, Snapper } from "../../snap";

export interface IStep {
    perform(document: IDocument): Promise<SnapedData | undefined>;
}

export interface Validator {
    validator?: (view: IView, point: XYZ) => boolean;
}

export abstract class StepBase<D extends Validator> implements IStep {
    constructor(
        readonly S: new (data: D) => Snapper,
        readonly tip: keyof I18n,
        readonly handleData: () => D,
        readonly disableDefaultValidator = false
    ) {}

    async perform(document: IDocument): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (!this.disableDefaultValidator && data.validator === undefined) {
            data.validator = (v, p) => this.validator(v, data, p);
        }
        let snapper = new this.S(data);
        return await snapper.snap(document, this.tip);
    }

    protected abstract validator(view: IView, data: D, point: XYZ): boolean;
}
