// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type Material,
    type Property,
    PropertyUtils,
    Texture,
    Transaction,
} from "@chili3d/core";
import type { Tool } from "../llm/types";
import { requireDocument } from "./documentContext";
import { describeProperties, prepareUpdates } from "./propertyBag";

/**
 * The tools that read and write a document material itself. `set_material` styles a *node* and
 * shares a material between nodes with equal values; these edit one material in place, which is
 * what every node using it sees.
 */

/** The properties the material editor shows, in its order. */
function materialProperties(material: Material): Property[] {
    return PropertyUtils.getProperties(material);
}

function findMaterial(doc: IDocument, id: string): Material | undefined {
    return doc.modelManager.materials.find((x) => x.id === id);
}

function describeMaterial(material: Material, doc: IDocument) {
    return {
        id: material.id,
        name: material.name,
        properties: describeProperties(material, materialProperties(material), doc),
    };
}

function listMaterialsTool(): Tool {
    return {
        name: "list_materials",
        description:
            "List the document's materials and what they look like. Each row carries the id, the name and the values that shape the surface (colour, opacity, roughness, metalness). Materials are shared — a node points at one by id — so this is the one place to see what a surface is, or whether one already exists before adding another.",
        parameters: { type: "object", properties: {} },
        handler: listMaterialsHandler,
    };
}

const listMaterialsHandler: Tool["handler"] = async () => {
    const doc = requireDocument();
    if (typeof doc === "string") return doc;

    return JSON.stringify({
        materials: doc.modelManager.materials.map((m) => ({
            id: m.id,
            name: m.name,
            color: m.color,
            opacity: m.opacity,
            roughness: m.roughness,
            metalness: m.metalness,
        })),
    });
};

function getMaterialTool(): Tool {
    return {
        name: "get_material",
        description:
            "Read one material's editable properties. That is what the material editor shows: colour, opacity, roughness, metalness, emissive, the texture slots, …. Use it to answer what a surface currently is, or before set_material_properties to see the writable names. A node's material id is the `materialId` row of get_node_properties, or an id from list_materials.",
        parameters: {
            type: "object",
            properties: { id: { type: "string", description: "Material id" } },
            required: ["id"],
        },
        handler: getMaterialHandler,
    };
}

const getMaterialHandler: Tool["handler"] = async (args) => {
    const doc = requireDocument();
    if (typeof doc === "string") return doc;

    const id = args["id"] as string;
    const material = findMaterial(doc, id);
    if (material === undefined) {
        return JSON.stringify({
            error: `material not found: ${id}`,
            available: doc.modelManager.materials.map((m) => ({ id: m.id, name: m.name })),
        });
    }
    return JSON.stringify({ material: describeMaterial(material, doc) });
};

function setMaterialPropertiesTool(): Tool {
    return {
        name: "set_material_properties",
        description:
            'Change a material\'s properties, for every node wearing it. The edit is in place, on the material itself — that is the difference from set_material, which styles one node and shares a material with matching values. Typical: roughness and metalness for how shiny or metallic a surface is, emissive for something that looks lit, or a texture slot. Read the writable names with get_material first. A texture slot takes an image URL, a data URL, or "" to clear it.',
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "Material id (from list_materials or a node's materialId)",
                },
                properties: {
                    type: "object",
                    description:
                        'Property name to new value, e.g. { "roughness": 0.2, "metalness": 1 }. A texture slot takes an image URL or "".',
                },
            },
            required: ["id", "properties"],
        },
        handler: setMaterialPropertiesHandler,
    };
}

const setMaterialPropertiesHandler: Tool["handler"] = async (args) => {
    const doc = requireDocument();
    if (typeof doc === "string") return doc;

    const id = args["id"] as string;
    const material = findMaterial(doc, id);
    if (material === undefined) {
        return JSON.stringify({
            error: `material not found: ${id}`,
            available: doc.modelManager.materials.map((m) => ({ id: m.id, name: m.name })),
        });
    }

    const requested = (args["properties"] ?? {}) as Record<string, unknown>;
    const updates = prepareUpdates(material, materialProperties(material), doc, requested, "this material");
    if (typeof updates === "string") return updates;

    // One transaction, so the whole edit is a single undo step. No `showProperties` republish
    // here: the material editor and the material strip bind to the material and follow it, while
    // that event is what the panel rebuilds on — and what closes the editor.
    Transaction.execute(doc, "AI set material properties", () => {
        for (const [name, value] of updates) {
            const current = (material as unknown as Record<string, unknown>)[name];
            // A texture slot holds a Texture; the model gives an image for it to hold.
            if (current instanceof Texture) current.image = value as string;
            else (material as unknown as Record<string, unknown>)[name] = value;
        }
        doc.visual.update();
    });

    return JSON.stringify({
        id,
        updated: describeProperties(material, materialProperties(material), doc).filter((p) =>
            updates.has(p.name),
        ),
    });
};

export function buildMaterialTools(): Tool[] {
    return [listMaterialsTool(), getMaterialTool(), setMaterialPropertiesTool()];
}
