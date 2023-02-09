// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, IDocument, Model, Transaction } from "chili-core";
import { SnapedData } from "../../snap";
import { IStep } from "../step/step";

export abstract class CreateCommand implements ICommand {
    protected snapedDatas: SnapedData[] = [];

    async excute(document: IDocument): Promise<void> {
        this.excuteFromStep(document, 0);
    }

    protected async excuteFromStep(document: IDocument, step: number): Promise<void> {
        if (!(await this.performSteps(document, step))) return;
        this.createModel(document);
        this.afterExcute(document);
    }

    private async performSteps(document: IDocument, startIndex: number): Promise<boolean> {
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            let snaped = await steps[i].perform(document);
            if (snaped === undefined) {
                this.snapedDatas.length = 0;
                return false;
            } else {
                this.snapedDatas.push(snaped);
            }
        }
        return true;
    }

    protected abstract getSteps(): IStep[];

    private createModel(document: IDocument) {
        Transaction.excute(document, `add model`, () => {
            let model = this.create(document);
            document.addModel(model);
            document.viewer.redraw();
        });
    }

    protected abstract create(document: IDocument): Model;

    protected afterExcute(document: IDocument) {}
}
