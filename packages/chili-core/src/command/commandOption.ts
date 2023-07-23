// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export interface ButtonOption {
    readonly icon: string;
    readonly name: string;
    readonly onClick: () => void;
    readonly description?: string;
}

export interface OptionGroup {
    readonly name: string;
    readonly options: ButtonOption[];
}

export interface CommandOptions {
    name: string;
    groups: OptionGroup[];
}
