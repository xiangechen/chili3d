// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CancelableCommand,
    CommandStore,
    command,
    type IStep,
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    ShapeTypeUtils,
    type VisualShapeData,
} from "@chili3d/core";
import { SketchNode } from "../sketch/sketchNode";
import { cornerDragOf } from "./modifyCornerCommand";
import type { PickSettledCommand } from "./pickSettled";
import { type PressPullHandler, PressPullStep } from "./pressPullStep";
import { SELECTED_FACE_STATE } from "./selectedFaceState";

/** The command a Press Pull opens. It has no geometry and no feature of its own. */
export type PressPullTarget =
    | "feature.extrude"
    | "feature.offsetFace"
    | "feature.fillet"
    | "feature.chamfer"
    | "feature.modifyFillet"
    | "feature.modifyChamfer";

/** What a pick opens, and the field of that command the size goes into. */
interface PressPullOpening {
    readonly key: PressPullTarget;
    /**
     * Absent where this gesture measured no size to hand over: a sketch picked as a whole NODE is
     * extruded by Extrude's own drag, the only thing that knows its depth.
     */
    readonly field?: string;
    readonly value?: number;
    /**
     * Whether this gesture's pick and confirm stand for the target's own, for a target that speaks
     * that protocol (`PickSettledCommand`). Left UNDEFINED for one that does not — an edge's Fillet
     * or Chamfer reads the selection as answered through its own pick options, and a field it never
     * declared is a claim nothing honours (it would go stale the day that default changes).
     *
     * `false` is a value, not an absence: it tells a target that DOES speak it not to take the
     * selection as the answer, so its own pick stays open for the size the drag could not express
     * (see `cornerOpeningOf`).
     */
    readonly settled?: boolean;
}

/**
 * What a Press Pull on this pick opens.
 *
 * A sketch's face is extruded by the distance dragged; a body's face is offset by it — unless a
 * fillet or chamfer FEATURE built it, and then pushing it means editing that feature rather than
 * the surface it left behind (`cornerOpeningOf`). On an EDGE the SIGN of the distance is the
 * choice, and the size is its magnitude either way: a positive distance (out) rounds the edge, a
 * negative one (in) chamfers it.
 */
function openingOf(
    picked: readonly VisualShapeData[],
    distance: number,
    sizeOf: (value: ParameterValue) => number | undefined,
): PressPullOpening | undefined {
    const first = picked[0];
    if (first === undefined) return undefined;
    // One reading for the whole set, taken from the first of it: the pick admits one kind only.
    const type = first.shape.shapeType;
    if (ShapeTypeUtils.hasFace(type)) {
        if (first.owner.node instanceof SketchNode) {
            // The sketch's profile is what was dragged, so the distance IS the prism's depth — the
            // command builds it rather than asking for the same drag a second time.
            return { key: "feature.extrude", field: "depth", value: distance, settled: true };
        }
        return (
            cornerOpeningOf(first, distance, sizeOf) ?? {
                key: "feature.offsetFace",
                field: "distance",
                value: distance,
                settled: true,
            }
        );
    }
    if (ShapeTypeUtils.hasEdge(type)) {
        return distance < 0
            ? { key: "feature.chamfer", field: "value", value: -distance }
            : { key: "feature.fillet", field: "value", value: distance };
    }
    return undefined;
}

/**
 * The opening for a face a corner feature built, or undefined when no corner built it.
 *
 * Pushing a round is asking for a bigger round, not for the surface it left behind to be offset:
 * the fillet is what the user means, and editing it keeps the chain saying how the shape was made
 * (what Onshape's Press Pull does on a fillet face). What the drag amounts to is `cornerDragOf`'s
 * answer — the same one the gesture's own preview is built from, so what the user watched while
 * dragging is what the command writes.
 *
 * A drag that cannot be expressed as the feature's size — a chamfer in one of its asymmetric modes,
 * see `cornerDragOf` — is not translated at all: the command is still chosen for the user, but it
 * opens on its own size with its pick live, rather than a number being invented.
 */
function cornerOpeningOf(
    picked: VisualShapeData,
    distance: number,
    sizeOf: (value: ParameterValue) => number | undefined,
): PressPullOpening | undefined {
    const drag = cornerDragOf(picked, distance, sizeOf);
    if (drag === undefined) return undefined;

    const key = drag.feature.type === "fillet" ? "feature.modifyFillet" : "feature.modifyChamfer";
    return drag.size === undefined
        ? { key, settled: false }
        : { key, field: "value", value: drag.size, settled: true };
}

/**
 * Press Pull (Fusion's Press Pull, Onshape's Move Face): one command that does what pushing or
 * pulling the selection ought to do. It has no geometry and no feature of its own — it opens the
 * command that fits what is picked, which reads the pick up off the selection (every target
 * preselects from it) and asks for its size, or is handed the one this command was given
 * (`CancelableCommand.seedOptions`). The document records whatever the target builds — an Extrude,
 * an Offset Face, a Fillet, a Chamfer — never a "Press Pull".
 */
@command({ key: "feature.pressPull", icon: "icon-pressPull" })
export class PressPullCommand extends MultistepCommand {
    /**
     * The size the opened command gets: a distance for a face, a radius for a round, a length for
     * a chamfer. On an EDGE its sign picks which of the two it is — see `openingOf`.
     */
    @property("option.command.distance", { unit: LENGTH_UNITS })
    get distance(): ParameterValue {
        return this.getPrivateValue("distance", 2);
    }
    set distance(value: ParameterValue) {
        this.setProperty("distance", value);
        if (this._arrow === undefined || this._fromArrow) return;
        const resolved = this.resolveParameter(value, LENGTH_UNITS);
        if (resolved.isOk) this._arrow.setValue(resolved.value);
    }

    /** The distance as a number, or 0 when the expression the panel holds does not resolve. */
    private get gripValue(): number {
        const resolved = this.resolveParameter(this.distance, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : 0;
    }

    protected override getSteps(): IStep[] {
        // ONE step: the gesture picks the faces or edges, stands the arrow on them and drags the
        // distance, all in one session, so the user confirms once (`PressPullStep`).
        return [
            new PressPullStep(
                () => this.gripValue,
                (value) => {
                    // The drag is writing this value, so its own setter must not push it back (see
                    // `distance`); the guard is the round trip's, not the value's.
                    this._fromArrow = true;
                    this.distance = value;
                    this._fromArrow = false;
                },
                (handler) => this.onArrowReady(handler),
                () => this.onArrowDone(),
            ),
        ];
    }

    /** The arrow the gesture has live, so a distance typed into the panel can reach it. */
    private _arrow: PressPullHandler | undefined;
    /** Whether the drag itself is writing `distance` — the one value its setter must not push back. */
    private _fromArrow = false;

    protected onArrowReady(handler: PressPullHandler): void {
        this._arrow = handler;
    }

    protected onArrowDone(): void {
        this._arrow = undefined;
    }

    /** The hand-off `executeMainTask` starts, awaited by `executeAsync` (see both). */
    private opening: Promise<void> | undefined;

    protected override async executeAsync(): Promise<void> {
        // A selected sketch is an extrude, and Extrude reads its own profiles off the selection —
        // no pick of ours. Nothing else the app's selection holds is pushable (it holds nodes, not
        // faces or edges), so everything else goes through the pick below.
        if (this.document.selection.getSelectedNodes().some((x) => x instanceof SketchNode)) {
            await this.open("feature.extrude");
            return;
        }
        await super.executeAsync();
        // The base calls `executeMainTask` WITHOUT awaiting it — the opened command lives as long
        // as its own pick session does — so this is where the hand-off is actually waited on.
        await this.opening;
    }

    protected override executeMainTask(): void {
        this.opening = this.openFromPick();
    }

    private async openFromPick(): Promise<void> {
        const picked = this.stepDatas[0]?.shapes ?? [];
        if (picked.length === 0) return;
        // The dragged value when the arrow was used — the panel already holds it, so one read
        // covers both ways of setting it — and that is what the opened command is given.
        const dragged = this.stepDatas[0]?.distance;
        const size = this.resolveParameter(dragged ?? this.distance, LENGTH_UNITS);
        if (!size.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", "Invalid distance");
            return;
        }
        const opening = openingOf(picked, size.value, (value) => {
            const resolved = this.resolveParameter(value, LENGTH_UNITS);
            return resolved.isOk ? resolved.value : undefined;
        });
        if (opening === undefined) {
            PubSub.default.pub("showToast", "prompt.pressPull");
            return;
        }
        // `executeSteps` clears the selection as it finishes, and the pick it made is the whole
        // point — so the WHOLE set goes back before the target runs, whose own step preselects
        // from it (they are all multi picks themselves).
        this.document.selection.setSelectedShapes(picked, SELECTED_FACE_STATE, false);
        await this.open(opening);
    }

    /**
     * Runs the opened command HERE rather than through `PubSub.pub("executeCommand", …)`: that
     * channel first cancels whatever is executing (`CommandService.checking`), and a
     * CancelableCommand's `cancel` waits on `isCompleted` — which this command cannot reach while
     * it is still on the stack waiting for the target. Running it directly keeps one unit of work
     * in flight instead of two, and it leaves the service's own bookkeeping to name THIS command
     * last, so "repeat last" repeats Press Pull.
     *
     * `executingCommand` is handed to the target so the app's cancel paths (Escape, a view change)
     * reach what the user is actually looking at.
     */
    private async open(target: PressPullTarget | PressPullOpening): Promise<void> {
        const opening = typeof target === "string" ? { key: target } : target;
        const ctor = CommandStore.getCommand(opening.key);
        if (ctor === undefined) return;
        if (opening.field !== undefined && opening.value !== undefined) {
            CancelableCommand.seedOptions(opening.key, { [opening.field]: opening.value });
        }
        const opened = new ctor();
        // This pick and its confirm stand for the target's own (`PickSettledCommand`), unless the
        // opening could not translate the drag into that command's size — then its own pick has to
        // run for the user to set one.
        // Only for a target that declares the protocol. A bare edge's Fillet/Chamfer does not
        // (`EdgeCornerFeatureCommand`), and its pick already answers from the selection — writing a
        // field it never reads would look like the hand-off was wired when it was not.
        if (opening.settled !== undefined) {
            (opened as PickSettledCommand).pickSettled = opening.settled;
        }
        this.application.executingCommand = opened;
        try {
            await opened.execute(this.application);
        } finally {
            this.application.executingCommand = undefined;
        }
    }
}
