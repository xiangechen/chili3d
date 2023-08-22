// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

export type Commands =
    | `app.doc.new`
    | "app.doc.save"
    | "app.doc.open"
    | "doc.cmd.last"
    | "doc.cmd.undo"
    | "doc.cmd.redo"
    | "doc.create.box"
    | "doc.create.line"
    | "doc.create.circle"
    | "doc.create.rect"
    | "doc.create.folder"
    | "doc.create.group"
    | "doc.create.polygon"
    | "doc.modify.array"
    | "doc.modify.move"
    | "doc.modify.rotate"
    | "doc.modify.mirror"
    | "doc.modify.delete";
