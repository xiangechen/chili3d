// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, AsyncState, I18n, ICommand, IDocument, Property, PubSub } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

const PropertiesCache: Map<keyof I18n, any> = new Map();

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

    @Property.define("axis.z", "axis.y")
    continuousOperation: boolean = false;

    @Property.define("axis.x", "common.cancel")
    cancel() {
        this.token?.cancel();
    }

    async execute(application: Application): Promise<void> {
        await this.executeFromStep(application.activeDocument!, 0);
    }

    protected async executeFromStep(document: IDocument, stepIndex: number): Promise<void> {
        if (this.restarting) {
            this.restarting = false;
        }
        try {
            if ((await this.beforeExecute(document)) && (await this.executeSteps(document, stepIndex))) {
                this.executeMainTask(document);
            }
        } finally {
            await this.afterExecute(document);
        }
        if (this.restarting) {
            await this.executeFromStep(document, 0);
        }
    }

    private async executeSteps(document: IDocument, startIndex: number): Promise<boolean> {
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            this.token = new AsyncState();
            let data = await steps[i].execute(document, this.token);
            if (this.restarting || data === undefined) {
                this.stepDatas.length = 0;
                return false;
            }
            this.stepDatas.push(data);
        }
        return true;
    }

    protected abstract getSteps(): IStep[];

    protected abstract executeMainTask(document: IDocument): void;

    protected beforeExecute(document: IDocument): Promise<boolean> {
        this.readProperties();
        PubSub.default.pub("openContextTab", this);
        return Promise.resolve(true);
    }

    protected afterExecute(document: IDocument): Promise<void> {
        this.saveProperties();
        PubSub.default.pub("closeContextTab");
        this.token?.dispose();
        return Promise.resolve();
    }

    private readProperties() {
        Property.getProperties(this).forEach((x) => {
            if (PropertiesCache.has(x.display)) {
                (this as any)[x.display] = PropertiesCache.get(x.display);
            }
        });
    }

    private saveProperties() {
        Property.getProperties(this).forEach((x) => {
            let prop = (this as any)[x.display];
            if (typeof prop === "function") return;
            PropertiesCache.set(x.display, prop);
        });
    }
}
