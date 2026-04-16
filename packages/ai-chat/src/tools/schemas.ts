import { z } from "zod";

const vec3 = z.tuple([z.number(), z.number(), z.number()]).describe("[x, y, z] in document units (mm)");

export const schemas = {
    new_document: z.object({
        name: z.string().optional().describe("Optional document name"),
    }),

    save_document: z.object({}),

    get_document_state: z
        .object({})
        .describe("Returns active document metadata + a compact list of top-level nodes."),

    get_application_state: z.object({}).describe("Returns open documents and the active one."),

    get_selection: z.object({}).describe("Returns the currently selected nodes in the active document."),

    select_nodes: z.object({
        nodeIds: z.array(z.string()).describe("Node ids to select"),
        toggle: z.boolean().optional().describe("If true, toggle instead of replace"),
    }),

    fit_view: z.object({}),

    get_camera_state: z
        .object({})
        .describe(
            "Current camera pose: { eye, target, up } in world coordinates, plus type (perspective|orthographic).",
        ),

    set_camera: z
        .object({
            eye: vec3.optional().describe("Camera position. Omit to keep current."),
            target: vec3.optional().describe("Look-at point. Omit to keep current."),
            up: vec3.optional().describe("Up vector. Omit to keep current."),
            type: z
                .enum(["perspective", "orthographic"])
                .optional()
                .describe("Projection type. Omit to keep current."),
        })
        .describe(
            "Partial camera update. Any omitted field retains its current value so you can e.g. set just the eye.",
        ),

    view_from: z
        .object({
            direction: z.enum(["top", "bottom", "front", "back", "left", "right", "iso"]),
            nodeIds: z
                .array(z.string())
                .optional()
                .describe("Frame only these nodes. Defaults to the whole scene."),
            padding: z
                .number()
                .positive()
                .optional()
                .describe("Distance multiplier (1.5 ≈ comfortable framing). Defaults to 1.5."),
        })
        .describe(
            "Named orthogonal or isometric view. Computes eye position from the bounding box so the subject is framed, not just aligned.",
        ),

    frame_nodes: z
        .object({
            nodeIds: z.array(z.string()).min(1),
            padding: z.number().positive().optional(),
        })
        .describe("Fit the camera to the bounding box of the given nodes (preserves current direction)."),

    capture_view: z
        .object({
            maxSize: z
                .number()
                .int()
                .min(256)
                .max(2048)
                .optional()
                .describe("Max pixels on longest edge. Defaults to 1280."),
            format: z
                .enum(["jpeg", "png"])
                .optional()
                .describe("Defaults to jpeg (smaller). Use png when you need exact colours."),
            quality: z.number().min(0.3).max(1).optional().describe("JPEG quality 0-1. Defaults to 0.82."),
        })
        .describe(
            "Take a screenshot of the current viewport and return it as an image that you can see. Expensive: image tokens are charged on this call AND on every subsequent turn because the screenshot stays in conversation history. Only call this when (a) the user explicitly asks you to look at the model, or (b) you actually need visual confirmation to decide what to do next — e.g. diagnosing a bug the user reported or verifying geometry before claiming a non-trivial plan is complete. Do not call it after routine create/modify operations to 'check the result' — the tool-call JSON results already tell you what happened.",
        ),

    create_box: z.object({
        dx: z.number().describe("Extent in X axis"),
        dy: z.number().describe("Extent in Y axis"),
        dz: z.number().describe("Extent in Z axis"),
        origin: vec3.optional().describe("Box origin (one corner). Defaults to [0,0,0]."),
        name: z.string().optional(),
    }),

    create_sphere: z.object({
        center: vec3,
        radius: z.number().positive(),
        name: z.string().optional(),
    }),

    create_cylinder: z.object({
        center: vec3.describe("Base center of the cylinder"),
        radius: z.number().positive(),
        height: z.number().describe("Extrude distance along normal; may be negative"),
        normal: vec3.optional().describe("Axis direction. Defaults to [0,0,1]."),
        name: z.string().optional(),
    }),

    create_cone: z.object({
        center: vec3.describe("Base center"),
        radius: z.number().positive().describe("Base radius"),
        height: z.number().describe("Height along normal; may be negative"),
        normal: vec3.optional(),
        name: z.string().optional(),
    }),

    create_rect: z.object({
        origin: vec3,
        dx: z.number(),
        dy: z.number(),
        plane: z.enum(["XY", "YZ", "ZX"]).optional().describe("Defaults to XY"),
        name: z.string().optional(),
    }),

    create_circle: z.object({
        center: vec3,
        radius: z.number().positive(),
        normal: vec3.optional().describe("Defaults to [0,0,1]"),
        name: z.string().optional(),
    }),

    create_line: z.object({
        start: vec3,
        end: vec3,
        name: z.string().optional(),
    }),

    delete_nodes: z.object({
        nodeIds: z
            .array(z.string())
            .describe("Node ids to delete. Pass an empty array to delete the current selection."),
    }),

    move_nodes: z.object({
        nodeIds: z.array(z.string()),
        offset: vec3,
    }),

    boolean_union: z.object({
        nodeIds: z.array(z.string()).min(2).describe("Shape node ids to fuse"),
    }),

    boolean_subtract: z.object({
        subjectNodeId: z.string().describe("Shape to cut from"),
        toolNodeIds: z.array(z.string()).min(1).describe("Shapes to subtract"),
    }),

    boolean_intersect: z.object({
        nodeIds: z.array(z.string()).min(2),
    }),

    list_materials: z.object({}).describe("List materials defined in the active document."),

    create_material: z.object({
        name: z.string().describe("Human-readable name, e.g. 'wood', 'steel-polished'"),
        color: z.string().describe("CSS color string: '#RRGGBB', '#RGB', or a named color like 'red'"),
        opacity: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("0 = fully transparent, 1 = fully opaque. Defaults to 1."),
        kind: z
            .enum(["basic", "phong", "physical"])
            .optional()
            .describe(
                "basic = matte color only (default); phong = specular highlights; physical = PBR (metalness/roughness).",
            ),
        metalness: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("PBR only (kind='physical'). 0 = non-metal, 1 = fully metallic."),
        roughness: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe("PBR only (kind='physical'). 0 = mirror, 1 = fully diffuse."),
    }),

    update_material: z.object({
        materialId: z.string(),
        name: z.string().optional(),
        color: z.string().optional().describe("CSS color string"),
        opacity: z.number().min(0).max(1).optional(),
    }),

    assign_material: z.object({
        nodeIds: z.array(z.string()).min(1),
        materialId: z.string(),
    }),

    delete_material: z
        .object({ materialId: z.string() })
        .describe("Remove a material from the document. Fails if any node still references it."),

    execute_command: z
        .object({
            key: z.string().describe("Chili command key, e.g. 'create.box', 'modify.fillet'"),
        })
        .describe(
            "Escape hatch: dispatches a built-in command through the UI. Interactive commands will prompt the user for input. Prefer the dedicated create_* / modify_* tools when available.",
        ),
} as const;

export type ToolName = keyof typeof schemas;
export type ToolInput<T extends ToolName> = z.infer<(typeof schemas)[T]>;

export const toolDescriptions: Record<ToolName, string> = {
    new_document:
        "Create a new empty document. Call this first if there is no active document — use get_application_state to check.",
    save_document: "Persist the active document to storage.",
    get_document_state:
        "Summary of the active document (id, name, top-level nodes). Use this before modifying existing geometry to resolve node ids.",
    get_application_state: "List of open documents and the active document id.",
    get_selection:
        "Currently selected node ids and names. Use this before modifying existing geometry when the user refers to 'the selected' or 'this' object.",
    select_nodes: "Replace (or toggle) the selection by node ids.",
    fit_view:
        "Fit the camera so all geometry is visible. Call this after creating, moving, or otherwise changing geometry so the user can see the result, especially when the new geometry isn't near the origin — without it the camera is often pointed at empty space. When you make several changes in a row, one fit_view at the end is enough.",
    get_camera_state: "Read the current camera pose (eye/target/up + projection type).",
    set_camera: "Apply a partial camera update. Any omitted field keeps its current value.",
    view_from:
        "Named orthogonal/isometric view ('top', 'front', 'iso', …) framed on the scene or a subset of nodes.",
    frame_nodes: "Fit the camera to a specific subset of nodes by id. Like fit_view but scoped.",
    capture_view:
        "Take a screenshot of the current viewport and return the image so you can see it. Use sparingly.",
    create_box: "Create a box (cuboid) at an origin with dx/dy/dz extents.",
    create_sphere: "Create a sphere at a center point with a given radius.",
    create_cylinder: "Create a cylinder with a base center, radius, height, and optional axis.",
    create_cone: "Create a cone at a base center with a radius and height.",
    create_rect: "Create a planar rectangle face at an origin on the specified plane.",
    create_circle: "Create a circular edge at a center with a radius.",
    create_line: "Create a straight edge from start to end.",
    delete_nodes: "Delete nodes by id. Empty list deletes the current selection.",
    move_nodes: "Translate nodes by an [x,y,z] offset.",
    boolean_union: "Fuse (OR) two or more solid nodes into one.",
    boolean_subtract: "Cut toolNodeIds from subjectNodeId, producing a single new solid.",
    boolean_intersect: "Keep only the common (AND) volume of two or more solids.",
    list_materials:
        "List the materials defined in the active document. Use this before create_material so you can reuse an existing material whose color matches.",
    create_material:
        "Create a new material in the active document. Returns its id. Reuse existing materials via list_materials when possible instead of creating duplicates.",
    update_material:
        "Mutate an existing material's name / color / opacity. All nodes that reference it update automatically.",
    assign_material:
        "Point nodes at a material id. Use this to change the display color/look of existing geometry.",
    delete_material: "Delete a material from the active document. Fails if nodes still reference it.",
    execute_command: "Escape hatch: dispatch any chili3d command by key via the existing UI.",
};
