// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Application, AsyncState, ICommand, IDocument, Observable, Property, PubSub } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "../step";

const PropertiesCache: Map<string, any> = new Map(); // 所有命令共享

export abstract class MultistepCommand extends Observable implements ICommand {
    protected stepDatas: SnapedData[] = [];

    private _restarting: boolean = false;
    protected get restarting() {
        return this._restarting;
    }

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
        this._restarting = true;
        this.token?.cancel();
    }

    @Property.define("common.cancel", "common.mode", "icon-cancel")
    cancel() {
        this.token?.cancel();
    }

    private _continuousOperation: boolean = false;
    @Property.define("common.repeat", "common.mode", "icon-rotate")
    get continuousOperation() {
        return this._continuousOperation;
    }

    set continuousOperation(value: boolean) {
        this.setProperty("continuousOperation", value);
    }

    async execute(application: Application): Promise<void> {
        await this.executeFromStep(application.activeDocument!, 0);
    }

    protected async executeFromStep(document: IDocument, stepIndex: number): Promise<void> {
        if (this._restarting) {
            this._restarting = false;
        }
        let isCancel = false;
        try {
            if ((await this.beforeExecute(document)) && (await this.executeSteps(document, stepIndex))) {
                this.executeMainTask(document);
            } else {
                isCancel = true;
            }
        } finally {
            await this.afterExecute(document);
        }
        if (this._restarting || (this.continuousOperation && !isCancel)) {
            await this.executeFromStep(document, 0);
        }
    }

    private async executeSteps(document: IDocument, startIndex: number): Promise<boolean> {
        this.stepDatas.length = 0;
        let steps = this.getSteps();
        for (let i = startIndex; i < steps.length; i++) {
            this.token = new AsyncState();
            let data = await steps[i].execute(document, this.token);
            if (this._restarting || data === undefined) {
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
            let key = this.cacheKeyOfProperty(x);
            if (PropertiesCache.has(key)) {
                (this as any)[key] = PropertiesCache.get(key);
            }
        });
    }

    private saveProperties() {
        Property.getProperties(this).forEach((x) => {
            let key = this.cacheKeyOfProperty(x);
            let prop = (this as any)[key];
            if (typeof prop === "function") return;
            PropertiesCache.set(key, prop);
        });
    }

    private cacheKeyOfProperty(property: Property) {
        return property.name;
    }
}
