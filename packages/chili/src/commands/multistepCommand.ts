// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, AsyncState, CommandOptions, ICommand, IDocument, PubSub } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

export abstract class MultistepCommand implements ICommand {
    protected restarting: boolean = false;
    protected stepDatas: SnapedData[] = [];

    private _token?: AsyncState;
    protected get token() {
        return this._token;
    }
    protected set token(value: AsyncState | undefined) {
        if (this._token === value) return;
        this._token?.dispose();
        this._token = value;
    }

    protected restart() {
        this.restarting = true;
        this.token?.cancel();
    }

    protected cancel() {
        this.token?.cancel();
    }

    async excute(application: Application): Promise<void> {
        await this.excuteFrom(application.activeDocument!, 0);
    }

    protected async excuteFrom(document: IDocument, step: number): Promise<void> {
        if (this.restarting) {
            this.restarting = false;
        }
        if ((await this.beforeExcute(document)) && (await this.collectStepDatas(document, step))) {
            this.excuting(document);
        }
        await this.afterExcute(document);
        if (this.restarting) {
            await this.excuteFrom(document, 0);
        }
    }

    private async collectStepDatas(document: IDocument, startIndex: number): Promise<boolean> {
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            this.token = new AsyncState();
            let data = await steps[i].perform(document, this.token);
            if (this.restarting || data === undefined) {
                this.stepDatas.length = 0;
                return false;
            }
            this.stepDatas.push(data);
        }
        return true;
    }

    protected abstract getSteps(): IStep[];

    protected abstract excuting(document: IDocument): void;

    protected options(): CommandOptions | undefined {
        return undefined;
    }

    protected beforeExcute(document: IDocument): Promise<boolean> {
        let options = this.options();
        if (options) PubSub.default.pub("openContextTab", options);
        return Promise.resolve(true);
    }

    protected afterExcute(document: IDocument): Promise<void> {
        PubSub.default.pub("closeContextTab");
        this.token?.dispose();
        return Promise.resolve();
    }
}
