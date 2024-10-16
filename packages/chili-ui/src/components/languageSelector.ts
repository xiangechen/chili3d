// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n } from "chili-core";
import { HTMLProps, option, select } from ".";

export const LanguageSelector = (props: HTMLProps<HTMLElement>) => {
    let languages: HTMLOptionElement[] = [];
    I18n.languages.forEach((language, index) =>
        languages.push(
            option({
                selected: index === I18n.currentLanguage(),
                textContent: language.display,
            }),
        ),
    );
    return select(
        {
            onchange: (e) => {
                let language = (e.target as HTMLSelectElement).selectedIndex;
                I18n.changeLanguage(language);
            },
            ...props,
        },
        ...languages,
    );
};
