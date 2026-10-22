// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    ObservableCollection,
    type PushButton,
    type RibbonButton,
    type RibbonCommand,
    type RibbonGroupProfile,
    type RibbonTabKeys,
    type RibbonTabProfile,
} from "@chili3d/core";

export const DefaultRibbon: RibbonTabProfile[] = [
    {
        tabName: "ribbon.tab.model",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    "create.line",
                    {
                        type: "split",
                        items: ["create.rect", "create.circle", "create.ellipse", "create.regularPolygon"],
                    },
                    {
                        type: "split",
                        items: ["create.arc", "create.arc2point", "create.arc3point", "create.arcTTR"],
                    },
                    {
                        type: "split",
                        items: [
                            "create.box",
                            "create.sphere",
                            "create.cylinder",
                            "create.cone",
                            "create.pyramid",
                        ],
                    },
                    "create.extrude",
                    ["create.loft", "create.sweep", "create.revol"],
                ],
                collapsedItems: [
                    "create.point",
                    "create.polygon",
                    "create.bezier",
                    "create.helix",
                    "create.pipe",
                    "create.text",
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: [
                    "modify.move",
                    ["modify.rotate", "modify.mirror", "modify.array"],
                    ["modify.trim", "modify.extend", "modify.shell"],
                    ["modify.split", "modify.sew", "modify.simplifyShape"],
                    ["modify.fillet", "modify.chamfer", "modify.explode"],
                    ["modify.deleteNode", "modify.removeShapes", "modify.removeFeature"],
                ],
                collapsedItems: [
                    "modify.break",
                    "modify.paintBucket",
                    "modify.brushAdd",
                    "modify.brushRemove",
                    "modify.brushClear",
                ],
            },
            {
                groupName: "ribbon.group.converter",
                items: [
                    "convert.toWire",
                    "convert.toCompound",
                    ["convert.toFace", "convert.toShell", "convert.toSolid"],
                ],
            },
            {
                groupName: "ribbon.group.boolean",
                items: [["boolean.common", "boolean.cut", "boolean.join"]],
            },
            {
                groupName: "ribbon.group.workingPlane",
                items: [
                    "workingPlane.toggleDynamic",
                    ["workingPlane.set", "workingPlane.alignToPlane", "workingPlane.fromSection"],
                ],
            },
            {
                groupName: "ribbon.group.tools",
                items: [
                    "convert.curveProjection",
                    "create.group",
                    ["create.section", "create.offset", "create.copyShape"],
                ],
                collapsedItems: ["modify.repairShape", "modify.checkShape"],
            },
            {
                groupName: "ribbon.group.measure",
                items: [["measure.length", "measure.angle", "measure.select"]],
            },
            {
                groupName: "ribbon.group.annotation",
                items: [
                    "annotate.dimension",
                    ["annotate.radius", "annotate.diameter", "annotate.angle"],
                    "annotate.text",
                ],
            },
            {
                groupName: "ribbon.group.act",
                items: ["act.alignCamera"],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export"],
            },
            {
                groupName: "ribbon.group.other",
                items: ["wechat.group", "ai.toggleChat"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.manager",
        groups: [
            {
                groupName: "ribbon.group.other",
                items: ["test.performance"],
            },
        ],
    },
];

/** Extras may request insertion before an existing tab instead of appending. */
export type RibbonProfileExtra = RibbonTabProfile & { before?: RibbonTabKeys };

/**
 * Ribbon contributions of the parametric module, applied by `AppBuilder.useParametric`.
 * Feature commands join the parametric tab next to the sketch group, split the way Fusion splits
 * its panels: what BUILDS geometry out of a profile, then what REWRITES geometry that is already
 * there.
 */
export const ParametricRibbonProfiles: RibbonProfileExtra[] = [
    {
        tabName: "ribbon.tab.parametric",
        before: "ribbon.tab.manager",
        groups: [
            {
                groupName: "ribbon.group.create",
                items: [
                    "feature.plane",
                    {
                        type: "split",
                        items: [
                            "feature.primitiveBox",
                            "feature.primitiveCylinder",
                            "feature.primitiveSphere",
                            "feature.primitiveCone",
                        ],
                    },
                    "feature.extrude",
                    ["feature.revolve", "feature.loft", "feature.sweep"],
                    ["feature.thicken", "feature.rib", "feature.helix"],
                ],
            },
            {
                groupName: "ribbon.group.feature",
                items: [
                    "feature.pressPull",
                    [
                        {
                            type: "split",
                            items: [
                                "feature.fillet",
                                "feature.chamfer",
                                "feature.modifyFillet",
                                "feature.modifyChamfer",
                            ],
                        },
                        "feature.draft",
                        "feature.shell",
                    ],
                    ["feature.offsetFace", "feature.split", "feature.hole"],
                    [
                        "feature.removeFeature",
                        {
                            type: "split",
                            items: [
                                "feature.patternLinear",
                                "feature.patternCircular",
                                "feature.patternCurve",
                            ],
                        },
                        "feature.mirror",
                    ],
                ],
            },
            {
                groupName: "ribbon.group.boolean",
                items: [["feature.fuse", "feature.cut", "feature.common"]],
            },
            {
                groupName: "ribbon.group.node",
                items: [
                    "modify.move",
                    ["modify.rotate", "modify.mirror", "modify.detach"],
                    ["modify.deleteNode", "modify.paintBucket", "modify.array"],
                ],
            },
            {
                groupName: "ribbon.group.annotation",
                items: [
                    "annotate.dimension",
                    ["annotate.radius", "annotate.diameter", "annotate.angle"],
                    "annotate.text",
                ],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export"],
            },
            {
                groupName: "ribbon.group.other",
                items: ["feature.variable", "wechat.group", "ai.toggleChat"],
            },
        ],
    },
];

/**
 * Returns a new profile list with `extras` merged into a copy of `base`: extra
 * items are prepended to the matching group (contributions land first), unknown
 * groups are appended, and new tabs are inserted before their `before` tab or
 * appended. The copy is deep — neither `base` nor `extras` is referenced by the
 * result, so merging twice or editing the result cannot grow the module-level
 * profiles.
 */
export function mergeRibbonProfiles(
    base: RibbonTabProfile[],
    extras: RibbonProfileExtra[],
): RibbonTabProfile[] {
    const result = base.map(copyTabProfile);
    for (const extra of extras) {
        mergeTab(result, extra);
    }
    return result;
}

function copyTabProfile(tab: RibbonTabProfile): RibbonTabProfile {
    return { ...tab, groups: tab.groups.map(copyGroupProfile) };
}

function copyGroupProfile(group: RibbonGroupProfile): RibbonGroupProfile {
    return {
        ...group,
        items: group.items.map(copyItem),
        collapsedItems: group.collapsedItems === undefined ? undefined : [...group.collapsedItems],
    };
}

function copyItem(item: RibbonCommand | RibbonButton[]): RibbonCommand | RibbonButton[] {
    if (Array.isArray(item)) return item.map(copyButton);
    // An ObservableCollection is a runtime value, not static layout — share it.
    if (item instanceof ObservableCollection) return item;
    return copyButton(item);
}

function copyButton(button: RibbonButton): RibbonButton {
    if (typeof button === "string") return button;
    if (button.type === "push") return { ...button };
    return { ...button, items: button.items.map(copyButtonItem) };
}

function copyButtonItem(item: PushButton | CommandKeys): PushButton | CommandKeys {
    return typeof item === "string" ? item : { ...item };
}

function mergeTab(result: RibbonTabProfile[], extra: RibbonProfileExtra): void {
    const tab = result.find((t) => t.tabName === extra.tabName);
    if (tab === undefined) {
        const beforeIndex = result.findIndex((t) => t.tabName === extra.before);
        if (beforeIndex < 0) {
            result.push(copyTabProfile(extra));
        } else {
            result.splice(beforeIndex, 0, copyTabProfile(extra));
        }
        return;
    }
    tab.contextual = tab.contextual || extra.contextual;
    for (const group of extra.groups) {
        const existing = tab.groups.find((g) => g.groupName === group.groupName);
        if (existing === undefined) {
            tab.groups.push(copyGroupProfile(group));
        } else {
            existing.items.unshift(...group.items.map(copyItem));
            if (group.collapsedItems !== undefined) {
                existing.collapsedItems = [...group.collapsedItems, ...(existing.collapsedItems ?? [])];
            }
        }
    }
}
