// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Label } from "../components";
import { Control } from "../components/control";
import style from "./card.module.css";

export class Card extends Control {
    constructor({ name, time, image }: { name: string; time: Date; image: string }) {
        super();
        this.addClass(style.panel);
        this.append(this.initImage(image), new Label().text(name), new Label().text(time.toISOString()));
    }

    private initImage(image: string) {
        let img = document.createElement("img");
        img.className = style.image;
        img.src = image;
        return img;
    }
}

customElements.define("chili-card", Card);
