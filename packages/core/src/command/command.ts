// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "../application";
import { type AsyncController, type IDisposable, Observable, PubSub, type Result } from "../foundation";
import { EMPTY_SCOPE, type ParameterValue, resolveUnitSpec, type Scope } from "../parameters/expression";
import type { UnitSpec } from "../parameters/unitSpec";
import { type Property, PropertyUtils, property } from "../property";

export interface ICommand {
    execute(application: IApplication): Promise<void>;
}

export interface ICancelableCommand extends ICommand, IDisposable {
    cancel(): Promise<void>;
}

export function isCancelableCommand(command: ICommand): command is ICancelableCommand {
    return "cancel" in command;
}

export abstract class CancelableCommand extends Observable implements ICancelableCommand {
    private static readonly _propertiesCache: Map<string, any> = new Map();
    protected readonly disposeStack: Set<IDisposable> = new Set();

    private _isCompleted: boolean = false;
    get isCompleted() {
        return this._isCompleted;
    }

    private _isCanceled: boolean = false;
    get isCanceled() {
        return this._isCanceled;
    }

    private _application: IApplication | undefined;
    get application() {
        if (!this._application) {
            throw new Error("application is not set");
        }
        return this._application;
    }

    get document() {
        return this.application.activeView?.document!;
    }

    /**
     * One of the command's parameters resolved against the document's parameters. A field
     * declared with a `unit` holds what the user typed — a number or an expression — and
     * this is where the geometry reads the number it stands for.
     */
    protected resolveParameter(value: ParameterValue, expected: UnitSpec): Result<number> {
        return resolveUnitSpec(value, this.parameterScope(), expected);
    }

    /**
     * The parameters of the document this command runs against. A command can be configured
     * before it runs (and is, in tests), and only a running one has an application to reach
     * a document through — without one a literal still means what it says while an
     * expression simply has nothing to resolve against.
     */
    private parameterScope(): Scope {
        try {
            return this.document.variables.evaluate().scope;
        } catch {
            return EMPTY_SCOPE;
        }
    }

    #controller?: AsyncController;
    protected get controller() {
        return this.#controller;
    }
    protected set controller(value: AsyncController | undefined) {
        if (this.#controller === value) return;
        this.#controller?.dispose();
        this.#controller = value;
    }

    @property("common.cancel")
    async cancel() {
        this._isCanceled = true;

        this.controller?.cancel();
        while (!this._isCompleted) {
            await new Promise((r) => setTimeout(r, 30));
        }
    }

    get repeatOperation() {
        return this.getPrivateValue("repeatOperation", false);
    }

    set repeatOperation(value: boolean) {
        this.setProperty("repeatOperation", value);
    }

    protected _isRestarting: boolean = false;
    protected async restart() {
        this._isRestarting = true;
        await this.cancel();
    }

    protected onRestarting() {}

    async execute(application: IApplication): Promise<void> {
        if (!application.activeView?.document) return;
        this._application = application;

        await Promise.try(async () => {
            this.beforeExecute();

            await this.executeAsync();

            while (this._isRestarting || (!this.checkCanceled() && this.repeatOperation)) {
                this._isRestarting = false;

                this.onRestarting();
                await this.executeAsync();
            }
        }).finally(() => {
            this.afterExecute();
        });
    }

    protected checkCanceled() {
        if (this.isCanceled) {
            return true;
        }

        if (this.controller?.result?.status === "cancel") {
            return true;
        }

        return false;
    }

    protected abstract executeAsync(): Promise<void>;

    protected beforeExecute() {
        this.readProperties();
        PubSub.default.pub("openCommandContext", this);
    }

    protected afterExecute() {
        this.saveProperties();
        PubSub.default.pub("closeCommandContext");
        this.controller?.dispose();
        this.disposeStack.forEach((x) => x.dispose());
        this.disposeStack.clear();
        this._isCompleted = true;
    }

    private readProperties() {
        PropertyUtils.getProperties(this).forEach((x) => {
            const key = this.cacheKeyOfProperty(x);
            if (CancelableCommand._propertiesCache.has(key)) {
                this.setPrivateValue(key as keyof this, CancelableCommand._propertiesCache.get(key));
            }
        });
    }

    private saveProperties() {
        PropertyUtils.getProperties(this).forEach((x) => {
            const key = this.cacheKeyOfProperty(x);
            const prop = (this as any)[key];
            if (typeof prop === "function") return;
            CancelableCommand._propertiesCache.set(key, prop);
        });
    }

    private cacheKeyOfProperty(property: Property) {
        return property.name;
    }
}
