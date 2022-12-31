// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand } from "../command";

export class ContextualControl {
    constructor(readonly header: string, readonly key: string) { }
}

export class ContextualInputControl extends ContextualControl {
    
}

export class ContextualCheckControl extends ContextualControl { }

export class ContextualComboControl extends ContextualControl {
    constructor(header: string, key: string, readonly items: string[]) {
        super(header, key);
    }
}

export namespace ContextualControl {
    export function get(ctor: new (...args: any[]) => ICommand): ContextualControl[] | undefined {
        return ctor.prototype.contextual
    }
}

export function contextual<T extends { new (...args: any[]): ICommand }>(controls: ContextualControl[]) {
    return (ctor: T) => {
        ctor.prototype.contextual = controls;
    };
}
