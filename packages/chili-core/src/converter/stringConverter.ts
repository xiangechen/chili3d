// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ConverterBase } from "./converter";

export class StringConverter extends ConverterBase<string> {
    convert(value: string): string | undefined {
        return value;
    }
    convertBack(value: string): string | undefined {
        return value;
    }
}
