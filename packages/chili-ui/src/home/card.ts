// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { div, img } from "../controls";
import style from "./card.module.css";

export const Card = (src: string) => {
    return div({ className: style.root }, img({ src }), div({ className: style.title }));
};
