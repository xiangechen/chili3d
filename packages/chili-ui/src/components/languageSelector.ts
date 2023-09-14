// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n } from "chili-core";
import { Props, option, select } from "../controls";

export const LanguageSelector = (props: Props) => {
    return select(
        {
            onchange: (e) => I18n.changeLanguage((e.target as HTMLSelectElement).selectedIndex),
            ...props,
        },
        ...I18n.languages.map((lng, index) =>
            option({
                selected: index === I18n.currentIndex(),
                textContent: lng.language,
            }),
        ),
    );
};
