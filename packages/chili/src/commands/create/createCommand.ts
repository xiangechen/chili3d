// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, IDocument, Model, Transaction } from "chili-core";
import { SnapedData } from "../../snap";
import { IStep } from "../step/step";

export abstract class CreateCommand implements ICommand {
    protected snapedDatas: SnapedData[];

    constructor() {
        this.snapedDatas = [];
    }

    protected abstract getSteps(): IStep[];

    protected abstract create(document: IDocument): Model;

    async excute(document: IDocument): Promise<void> {
        this.excuteFromStep(document, 0);
    }

    protected async excuteFromStep(document: IDocument, step: number): Promise<void> {
        let isSuccess = await this.performSteps(document, step);
        if (!isSuccess) return;
        let model = this.create(document);
        Transaction.excute(document, `add model ${model.name}`, () => {
            document.addModel(model);
            document.viewer.redraw();
        });
        this.afterExcute(document);
    }

    protected afterExcute(document: IDocument) {}

    private async performSteps(document: IDocument, startStep: number): Promise<boolean> {
        let steps = this.getSteps();
        for (let index = startStep; index < steps.length; index++) {
            const step = steps[index];
            let snaped = await step.perform(document);
            if (snaped === undefined) {
                this.snapedDatas.length = 0;
                return false;
            } else {
                this.snapedDatas.push(snaped);
            }
        }
        return true;
    }
}
