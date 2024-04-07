// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication } from "../application";
import { AsyncController, Observable, PubSub } from "../foundation";
import { Property } from "../property";

export interface ICommand {
    execute(application: IApplication): Promise<void>;
}

export interface ICanclableCommand extends ICommand {
    cancel(): Promise<void>;
}

export namespace ICommand {
    export function isCanclableCommand(command: ICommand): command is ICanclableCommand {
        return "cancel" in command;
    }
}

export abstract class CancelableCommand extends Observable implements ICanclableCommand {
    private static readonly _propertiesCache: Map<string, any> = new Map(); // 所有命令共享

    private _isCompleted: boolean = false;
    get isCompleted() {
        return this._isCompleted;
    }

    private _application: IApplication | undefined;
    get application() {
        if (!this._application) {
            throw new Error("application is not set");
        }
        return this._application;
    }

    get document() {
        return this._application!.activeView?.document!;
    }

    private _controller?: AsyncController;
    protected get controller() {
        return this._controller;
    }
    protected set controller(value: AsyncController | undefined) {
        if (this._controller === value) return;
        this._controller?.dispose();
        this._controller = value;
    }

    @Property.define("common.cancel")
    async cancel() {
        this.controller?.cancel();
        await new Promise(async (resolve) => {
            while (true) {
                if (this._isCompleted) {
                    break;
                }
                await new Promise((r) => setTimeout(r, 50));
            }
            resolve(true);
        });
    }

    async execute(application: IApplication): Promise<void> {
        if (!application.activeView?.document) return;
        this._application = application;
        try {
            let canExcute = await this.beforeExecute();
            if (canExcute) {
                await this.executeAsync();
            }
        } finally {
            await this.afterExecute();
        }
    }

    protected abstract executeAsync(): Promise<void>;

    protected beforeExecute(): Promise<boolean> {
        this.readProperties();
        PubSub.default.pub("openCommandContext", this);
        return Promise.resolve(true);
    }

    protected afterExecute(): Promise<void> {
        this.saveProperties();
        PubSub.default.pub("closeCommandContext");
        this.controller?.dispose();
        this._isCompleted = true;
        return Promise.resolve();
    }

    private readProperties() {
        Property.getProperties(this).forEach((x) => {
            let key = this.cacheKeyOfProperty(x);
            if (CancelableCommand._propertiesCache.has(key)) {
                (this as any)[key] = CancelableCommand._propertiesCache.get(key);
            }
        });
    }

    private saveProperties() {
        Property.getProperties(this).forEach((x) => {
            let key = this.cacheKeyOfProperty(x);
            let prop = (this as any)[key];
            if (typeof prop === "function") return;
            CancelableCommand._propertiesCache.set(key, prop);
        });
    }

    private cacheKeyOfProperty(property: Property) {
        return property.name;
    }
}
