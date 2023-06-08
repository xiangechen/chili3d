// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, IDocument, GeometryModel, Transaction } from "chili-core";

import { SnapedData } from "../../snap";
import { IStep } from "../../step";

export abstract class CreateCommand implements ICommand {
    protected stepDatas: SnapedData[] = [];

    async excute(document: IDocument): Promise<void> {
        await this.excuteFromStep(document, 0);
    }

    protected async excuteFromStep(document: IDocument, step: number): Promise<void> {
        if (!(await this.performSteps(document, step))) return;
        this.createModel(document);
        await this.afterExcute(document);
    }

    private async performSteps(document: IDocument, startIndex: number): Promise<boolean> {
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            let data = await steps[i].perform(document);
            if (data === undefined) {
                this.stepDatas.length = 0;
                return false;
            } else {
                this.stepDatas.push(data);
            }
        }
        return true;
    }

    protected abstract getSteps(): IStep[];

    private createModel(document: IDocument) {
        Transaction.excute(document, `add model`, () => {
            let model = this.create(document);
            document.addNode(model);
            document.visual.viewer.redraw();
        });
    }

    protected abstract create(document: IDocument): GeometryModel;

    protected afterExcute(document: IDocument): Promise<void> {
        /* 空 */
        return Promise.resolve();
    }
}
