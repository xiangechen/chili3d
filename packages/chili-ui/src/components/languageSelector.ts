// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Language } from "chili-core";
import { Options, div, option, select } from "../controls";

export const LanguageSelector = (o: Options) =>
    div(
        select(
            {
                onchange: (e) => Language.set((e.target as HTMLSelectElement).selectedIndex),
                ...option,
            },
            ...Language.Languages.map((lng) => option(lng))
        )
    );
