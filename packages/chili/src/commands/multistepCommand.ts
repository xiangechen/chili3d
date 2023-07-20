// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, AsyncState, ICommand, IDocument } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand implements ICommand {
    private token: AsyncState;

    protected restarting: boolean = false;
    protected stepDatas: SnapedData[] = [];

    constructor() {
        this.token = new AsyncState();
    }

    async restart() {
        this.restarting = true;
        this.token.cancel();
    }

    async excute(application: Application): Promise<void> {
        await this.excuteFrom(application.activeDocument!, 0);
    }

    protected async excuteFrom(document: IDocument, step: number): Promise<void> {
        if (this.restarting) {
            this.restarting = false;
            this.token.resetState();
        }
        if (
            (await this.beforeExcute(document, this.token)) &&
            (await this.collectStepDatas(document, step, this.token))
        ) {
            this.excuting(document);
            await this.afterExcute(document);
        } else if (this.restarting) {
            await this.excuteFrom(document, 0);
        }
    }

    private async collectStepDatas(
        document: IDocument,
        startIndex: number,
        token: AsyncState
    ): Promise<boolean> {
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            let data = await steps[i].perform(document, token);
            if (this.restarting || data === undefined) {
                this.stepDatas.length = 0;
                return false;
            }
            this.stepDatas.push(data);
            this.token.resetState();
        }
        return true;
    }

    protected abstract getSteps(): IStep[];

    protected abstract excuting(document: IDocument): void;

    protected beforeExcute(document: IDocument, token: AsyncState): Promise<boolean> {
        return Promise.resolve(true);
    }

    protected afterExcute(document: IDocument): Promise<void> {
        return Promise.resolve();
    }
}
