// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, type Property, Texture, XY, XYZ } from "@chili3d/core";

/**
 * The machinery the property tools share: reading an entity's editable properties into the shapes
 * a model can work with, and turning a requested `{ name: value }` bag back into values its setters
 * take. The entities are nodes (`get_node_properties` / `set_node_properties`) and materials
 * (`get_material` / `set_material_properties`); both are edited through the same property metadata
 * the panel reads, so both go through here.
 */
export type PropertyKind =
    | "number"
    | "string"
    | "boolean"
    | "xyz"
    | "xy"
    | "color"
    | "materialId"
    | "texture"
    | "unsupported";

/**
 * The kinds the panel can render: it picks a control from `Property.type` first (color/materialId)
 * and from the value's class otherwise — a `Texture` slot gets the image editor — and warns +
 * skips anything else. The AI reads and writes the same set.
 */
export function kindOf(prop: Property, value: unknown): PropertyKind {
    if (prop.type === "color") return "color";
    if (prop.type === "materialId") return "materialId";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    if (typeof value === "boolean") return "boolean";
    if (value instanceof XYZ) return "xyz";
    if (value instanceof XY) return "xy";
    if (value instanceof Texture) return "texture";
    return "unsupported";
}

/** Plain-value form of a property, the same encodings the modeling tools take back. */
export function encodeValue(kind: PropertyKind, value: unknown): unknown {
    if (kind === "xyz") {
        const xyz = value as XYZ;
        return { x: xyz.x, y: xyz.y, z: xyz.z };
    }
    if (kind === "xy") {
        const xy = value as XY;
        return { x: xy.x, y: xy.y };
    }
    // A texture slot reads as the image it holds; "" is a slot with no image on it.
    if (kind === "texture") return (value as Texture).image;
    return kind === "unsupported" ? undefined : value;
}

/** Whether the panel offers this property for editing — a getter without a setter is read-only. */
export function hasSetter(entity: object, name: string): boolean {
    let target: object | null = entity;
    while (target !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (descriptor !== undefined) return typeof descriptor.set === "function";
        target = Object.getPrototypeOf(target);
    }
    return false;
}

export function availableMaterialIds(doc: IDocument): string[] {
    return doc.modelManager.materials.map((material) => material.id);
}

/** A rejected write, in the shape the tools' error responses take. */
function rejectValue(prop: Property, expected: string): { error: string } {
    return { error: `"${prop.name}" takes ${expected}` };
}

function rejectionOf(value: unknown): string | undefined {
    return value !== null && typeof value === "object" && "error" in value
        ? (value as { error: string }).error
        : undefined;
}

/** Builds the geometry class a point property's setter assigns, or the rejection for a bad point. */
function coercePoint(prop: Property, kind: "xyz" | "xy", value: unknown): unknown {
    const point = value as { x?: unknown; y?: unknown; z?: unknown };
    const expected = kind === "xyz" ? "a point {x,y,z}" : "a point {x,y}";
    if (typeof point?.x !== "number" || typeof point.y !== "number") return rejectValue(prop, expected);
    if (kind === "xy") return new XY(point.x, point.y);
    return typeof point.z === "number" ? new XYZ(point.x, point.y, point.z) : rejectValue(prop, expected);
}

/** A material property may only name materials this document actually has. */
function coerceMaterialId(doc: IDocument, prop: Property, value: unknown): unknown {
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length === 0 || !ids.every((id) => typeof id === "string")) {
        return rejectValue(prop, "a material id, or an array of them");
    }
    const known = availableMaterialIds(doc);
    const unknown = ids.filter((id) => !known.includes(id as string));
    return unknown.length > 0
        ? rejectValue(prop, `one of this document's materials (${known.join(", ")})`)
        : value;
}

/**
 * A property value from the model's JSON, coerced to what the property's setter expects. The
 * panel's converters do the same job for typed text; here the input is already JSON, so the
 * only real work is turning {x,y,z} into the geometry class the setter assigns.
 */
export function coerceValue(doc: IDocument, prop: Property, kind: PropertyKind, value: unknown): unknown {
    if (kind === "number") return typeof value === "number" ? value : rejectValue(prop, "a number");
    if (kind === "string") return typeof value === "string" ? value : rejectValue(prop, "a string");
    if (kind === "boolean") return typeof value === "boolean" ? value : rejectValue(prop, "true or false");
    if (kind === "xyz" || kind === "xy") return coercePoint(prop, kind, value);
    if (kind === "materialId") return coerceMaterialId(doc, prop, value);
    // Material.color takes 0xRRGGBB or a CSS color string, exactly as the panel's picker gives it.
    if (kind === "color") {
        return typeof value === "number" || typeof value === "string"
            ? value
            : rejectValue(prop, "a color as 0xRRGGBB or a CSS string");
    }
    if (kind === "texture") {
        return typeof value === "string"
            ? value
            : rejectValue(prop, 'a texture as an image URL, a data URL, or "" to remove it');
    }
    return rejectValue(prop, "a plain value — appearance properties are set with set_material");
}

/** The properties of an entity as the model sees them, in the order the panel shows them. */
export function describeProperties(entity: object, properties: Property[], doc: IDocument) {
    return properties.map((prop) => {
        const value = (entity as Record<string, unknown>)[prop.name];
        const kind = kindOf(prop, value);
        const encoded = encodeValue(kind, value);
        return {
            name: prop.name,
            label: I18n.translate(prop.display),
            kind,
            ...(encoded === undefined ? {} : { value: encoded }),
            ...(hasSetter(entity, prop.name) ? {} : { readOnly: true }),
            // A material property is useless to write without knowing what may be assigned.
            ...(kind === "materialId" ? { options: availableMaterialIds(doc) } : {}),
        };
    });
}

export function writableNames(properties: Property[], entity: object): string[] {
    return properties.filter((prop) => hasSetter(entity, prop.name)).map((prop) => prop.name);
}

/** One requested write after checking: the value to assign, or the error response to return. */
type Prepared = { value: unknown } | { error: string; available?: string[] };

function prepareUpdate(
    entity: object,
    doc: IDocument,
    properties: Property[],
    name: string,
    value: unknown,
    what: string,
): Prepared {
    const prop = properties.find((p) => p.name === name);
    if (prop === undefined) {
        return { error: `"${name}" is not a property of ${what}`, available: properties.map((p) => p.name) };
    }
    if (!hasSetter(entity, name)) {
        return { error: `"${name}" is read-only`, available: writableNames(properties, entity) };
    }
    const current = (entity as Record<string, unknown>)[name];
    const coerced = coerceValue(doc, prop, kindOf(prop, current), value);
    const rejection = rejectionOf(coerced);
    return rejection === undefined ? { value: coerced } : { error: rejection };
}

/**
 * Validate every requested write against the entity: the property has to exist, be writable, and
 * take the value given. Returns the values to assign, or the serialized error response.
 */
export function prepareUpdates(
    entity: object,
    properties: Property[],
    doc: IDocument,
    requested: Record<string, unknown>,
    what: string,
): Map<string, unknown> | string {
    const updates = new Map<string, unknown>();

    for (const [name, value] of Object.entries(requested)) {
        const prepared = prepareUpdate(entity, doc, properties, name, value, what);
        if ("error" in prepared) return JSON.stringify(prepared);
        updates.set(name, prepared.value);
    }

    if (updates.size === 0) {
        return JSON.stringify({ error: "no properties given", available: writableNames(properties, entity) });
    }
    return updates;
}
