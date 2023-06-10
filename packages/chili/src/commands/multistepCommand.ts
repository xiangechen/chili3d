// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, IDocument } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand implements ICommand {
    protected stepDatas: SnapedData[] = [];

    async excute(document: IDocument): Promise<void> {
        await this.excuteFrom(document, 0);
    }

    protected async excuteFrom(document: IDocument, step: number): Promise<void> {
        if (!(await this.beforeExcute(document))) return;
        if (!(await this.collectStepDatas(document, step))) return;
        this.excuting(document);
        await this.afterExcute(document);
    }

    private async collectStepDatas(document: IDocument, startIndex: number): Promise<boolean> {
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

    protected abstract excuting(document: IDocument): void;

    protected beforeExcute(document: IDocument): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected afterExcute(document: IDocument): Promise<void> {
        return Promise.resolve();
    }
}
