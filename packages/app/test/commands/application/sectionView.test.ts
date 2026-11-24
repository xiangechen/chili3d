// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FolderNode,
    type IView,
    MultistepCommand,
    Plane,
    PubSub,
    SectionPlaneNode,
    type SnapResult,
    sectionPlaneNodes,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockDocument,
    createMockView,
    TestDocument,
} from "@chili3d/core/test-utils";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import {
    type SectionOffsetDragData,
    SectionOffsetDragHandler,
} from "../../../src/commands/application/sectionOffsetDrag";
import { SectionPlanePickStep } from "../../../src/commands/application/sectionPlanePick";
import { ensureViewFolder, SectionViewCommand } from "../../../src/commands/application/sectionView";
import { CommandService } from "../../../src/services/commandService";

type SectionTestView = IView & { sectionPlane: Plane | undefined };

function createSectionView(): SectionTestView {
    const document = new TestDocument();
    document.selection = createMockDocument().selection;
    const view = createMockView({ document }) as SectionTestView;
    Object.defineProperty(view, "sectionPlane", {
        get: () => sectionPlaneNodes(view.document)[0]?.plane,
        set: (plane: Plane | undefined) => {
            const nodes = sectionPlaneNodes(view.document);
            if (plane === undefined) {
                for (const node of nodes) node.parent?.remove(node);
            } else if (nodes[0]) {
                nodes[0].plane = plane;
            } else {
                ensureViewFolder(view.document).add(new SectionPlaneNode({ document: view.document, plane }));
            }
        },
    });
    return view;
}

describe("SectionViewCommand", () => {
    const running = new Set<SectionViewCommand>();

    async function startWithPlane(
        application: ReturnType<typeof createMockApplication>,
        view: SectionTestView,
        plane: Plane,
        point = plane.origin,
    ) {
        const previousPlane = view.sectionPlane;
        rs.spyOn(SectionOffsetDragHandler.prototype, "refreshArrow").mockImplementation(() => {});
        const pick = rs
            .spyOn(SectionPlanePickStep.prototype, "execute")
            .mockImplementation(async (_document, controller): Promise<SnapResult> => {
                expect(view.sectionPlane).toBe(previousPlane);
                controller.success();
                return { view, shapes: [], type: "input", plane, point };
            });
        const command = new SectionViewCommand();
        running.add(command);
        const execution = command.execute(application);
        await rs.waitFor(() => expect(pick).toHaveBeenCalledOnce());
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { command, execution, pick };
    }

    afterEach(async () => {
        for (const command of running) {
            if (!command.isCompleted) await command.cancel();
        }
        running.clear();
        rs.restoreAllMocks();
    });

    test("has command metadata and does nothing without an active view", async () => {
        const data = (
            SectionViewCommand as unknown as {
                prototype: { data: { key: string; icon: string; toggleOnExecute: boolean } };
            }
        ).prototype.data;
        expect(data.key).toBe("act.sectionView");
        expect(data.icon).toBe("icon-sectionView");
        expect(data.toggleOnExecute).toBe(true);
        expect(new SectionViewCommand()).toBeInstanceOf(MultistepCommand);

        const app = createMockApplication();
        await new SectionViewCommand().execute(app);
        expect(app.executingCommand).toBeUndefined();
    });

    test("selects a plane immediately and keeps the section when the command closes", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { command, execution, pick } = await startWithPlane(app, view, Plane.XY);

        expect(pick).toHaveBeenCalledOnce();
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(sectionPlaneNodes(view.document)[0].parent?.name).toBe("Views");

        await command.cancel();
        await execution;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("updates offset and flip without removing the section on cancel", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { command, execution } = await startWithPlane(app, view, Plane.YZ);

        command.offset = 5;
        expect(view.sectionPlane?.origin.isEqualTo(new XYZ(5, 0, 0))).toBe(true);
        command.flipped = true;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNX)).toBe(true);
        command.offset = -5;
        expect(view.sectionPlane?.origin.isEqualTo(new XYZ(-5, 0, 0))).toBe(true);

        await command.cancel();
        await execution;
        expect(view.sectionPlane?.origin.isEqualTo(new XYZ(-5, 0, 0))).toBe(true);
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNX)).toBe(true);
    });

    test("records a whole drag gesture as one undo step", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { command, execution } = await startWithPlane(app, view, Plane.XY);
        const node = sectionPlaneNodes(view.document)[0];
        const history = view.document.history;
        const initialCount = history.undoCount();
        const handler = view.document.visual.eventHandler as SectionOffsetDragHandler;
        const data = (handler as unknown as { data: SectionOffsetDragData }).data;
        expect(data.onDragStart).toBeDefined();
        expect(data.onDragEnd).toBeDefined();

        data.onDragStart!();
        command.offset = 1;
        command.offset = 2;
        command.offset = 3;
        expect(history.undoCount()).toBe(initialCount);
        data.onDragEnd!();

        expect(history.undoCount()).toBe(initialCount + 1);
        history.undo();
        expect(node.plane.origin.isEqualTo(XYZ.zero)).toBe(true);
        history.redo();
        expect(node.plane.origin.isEqualTo(new XYZ(0, 0, 3))).toBe(true);
        await command.cancel();
        await execution;
    });

    test("rotates the section around the reference plane's local axes", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { command, execution } = await startWithPlane(app, view, Plane.XY);

        command.offset = 3;
        command.angleX = 90;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNY)).toBe(true);
        command.angleY = 90;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNY)).toBe(true);
        expect(view.sectionPlane?.xvec.isEqualTo(XYZ.unitNZ)).toBe(true);
        expect(view.sectionPlane?.origin.isEqualTo(new XYZ(0, 0, 3))).toBe(true);
        command.angleX = 0;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitX)).toBe(true);
        command.flipped = true;
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNX)).toBe(true);

        await command.cancel();
        await execution;
    });

    test("rotates around the picked point instead of the face UV origin", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const anchor = new XYZ(20, 15, 20);
        const { command, execution } = await startWithPlane(
            app,
            view,
            Plane.XY.translateTo(new XYZ(0, 0, 20)),
            new XYZ(20, 15, 24),
        );

        command.angleX = 90;

        expect(view.sectionPlane?.origin.isEqualTo(anchor)).toBe(true);
        expect(view.sectionPlane?.normal.isEqualTo(XYZ.unitNY)).toBe(true);

        await command.cancel();
        await execution;
    });

    test("keeps existing sections while another one is being picked", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        const previousPlane = Plane.XY.translateTo(new XYZ(0, 0, 10));
        view.sectionPlane = previousPlane;
        app.activeView = view;
        const { command, execution, pick } = await startWithPlane(app, view, Plane.YZ);

        expect(pick).toHaveBeenCalledOnce();
        const nodes = sectionPlaneNodes(view.document);
        expect(nodes).toHaveLength(2);
        expect(nodes[0].plane).toBe(previousPlane);
        expect(nodes[1].plane.normal.isEqualTo(XYZ.unitX)).toBe(true);

        await command.cancel();
        await execution;
        expect(sectionPlaneNodes(view.document)).toHaveLength(2);
        expect(sectionPlaneNodes(view.document)[0].plane).toBe(previousPlane);
    });

    test("installs the arrow handler while editing and restores the previous handler on close", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const previousHandler = view.document.visual.eventHandler;
        const { command, execution } = await startWithPlane(app, view, Plane.XY);

        expect(view.document.visual.eventHandler).toBeInstanceOf(SectionOffsetDragHandler);
        expect(view.document.visual.eventHandler).not.toBe(previousHandler);

        await command.cancel();
        await execution;
        expect(view.document.visual.eventHandler).toBe(previousHandler);
    });

    test("double-clicking a section node edits its current plane without picking another", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        Object.assign(view.document, { application: app });
        view.sectionPlane = Plane.YZ;
        rs.spyOn(SectionOffsetDragHandler.prototype, "refreshArrow").mockImplementation(() => {});
        const pick = rs.spyOn(SectionPlanePickStep.prototype, "execute");
        PubSub.default.pub("nodeDoubleClicked", sectionPlaneNodes(view.document)[0]);
        const command = new SectionViewCommand(sectionPlaneNodes(view.document)[0]);
        running.add(command);

        const execution = command.execute(app);
        await rs.waitFor(() =>
            expect(view.document.visual.eventHandler).toBeInstanceOf(SectionOffsetDragHandler),
        );

        expect(pick).not.toHaveBeenCalled();
        expect(view.sectionPlane).toBe(Plane.YZ);
        await command.cancel();
        await execution;
        expect(view.sectionPlane).toBe(Plane.YZ);
    });

    test("does not retain an edit request when the command is refused", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        Object.assign(view.document, { application: app });
        view.sectionPlane = Plane.YZ;
        const pub = rs.spyOn(PubSub.default, "pub");

        PubSub.default.pub("nodeDoubleClicked", sectionPlaneNodes(view.document)[0]);

        expect(pub).toHaveBeenCalledWith(
            "executeCommand",
            "act.sectionView",
            sectionPlaneNodes(view.document)[0],
        );
        const { command, execution, pick } = await startWithPlane(app, view, Plane.XY);
        expect(pick).toHaveBeenCalledOnce();
        await command.cancel();
        await execution;
    });

    test("drops a rejected edit through the real command service before the next create", async () => {
        const app = createMockApplication();
        const firstView = createSectionView();
        const secondView = createSectionView();
        Object.assign(firstView.document, { application: app });
        Object.assign(secondView.document, { application: app });
        secondView.sectionPlane = Plane.YZ;
        app.activeView = firstView;
        rs.spyOn(SectionOffsetDragHandler.prototype, "refreshArrow").mockImplementation(() => {});
        const pick = rs
            .spyOn(SectionPlanePickStep.prototype, "execute")
            .mockImplementation(async (document, controller) => {
                controller.success();
                return {
                    view: document.application.activeView!,
                    shapes: [],
                    type: "input",
                    plane: Plane.XY,
                    point: XYZ.zero,
                };
            });
        const service = new CommandService();
        service.register(app);
        service.start();

        try {
            PubSub.default.pub("executeCommand", "act.sectionView");
            await rs.waitFor(() =>
                expect(firstView.document.visual.eventHandler).toBeInstanceOf(SectionOffsetDragHandler),
            );
            const firstCommand = app.executingCommand as SectionViewCommand;
            app.activeView = secondView;

            PubSub.default.pub("nodeDoubleClicked", sectionPlaneNodes(secondView.document)[0]);
            await rs.waitFor(() => expect(firstCommand.isCompleted).toBe(true));
            await rs.waitFor(() => expect(app.executingCommand).toBeUndefined());
            expect(pick).toHaveBeenCalledOnce();

            PubSub.default.pub("executeCommand", "act.sectionView");
            await rs.waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
            await rs.waitFor(() =>
                expect(secondView.document.visual.eventHandler).toBeInstanceOf(SectionOffsetDragHandler),
            );
        } finally {
            if (app.executingCommand instanceof SectionViewCommand) await app.executingCommand.cancel();
            service.stop();
        }
    });

    test("reuses a Views folder moved into another folder", () => {
        const view = createSectionView();
        const document = view.document;
        const views = ensureViewFolder(document);
        const group = new FolderNode({ document, name: "Group" });
        document.modelManager.rootNode.add(group);
        document.modelManager.rootNode.move(views, group);

        expect(ensureViewFolder(document)).toBe(views);
        expect(
            document.modelManager.findNodes((node) => node instanceof FolderNode && node.name === "Views"),
        ).toHaveLength(1);
    });

    test("creates another section without replacing the existing one", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        view.sectionPlane = Plane.XY;
        const first = sectionPlaneNodes(view.document)[0];
        app.activeView = view;
        const { command, execution } = await startWithPlane(app, view, Plane.YZ);

        const nodes = sectionPlaneNodes(view.document);
        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toBe(first);
        expect(nodes[0].plane).toBe(Plane.XY);
        expect(nodes[1].plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(nodes[1].parent).toBe(nodes[0].parent);
        expect(
            view.document.modelManager.findNodes(
                (node) => node instanceof FolderNode && node.name === "Views",
            ),
        ).toHaveLength(1);

        await command.cancel();
        await execution;
        expect(sectionPlaneNodes(view.document)).toHaveLength(2);
    });

    test("preserves a retained section when plane picking fails", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        const previousPlane = Plane.XY;
        view.sectionPlane = previousPlane;
        app.activeView = view;
        rs.spyOn(SectionPlanePickStep.prototype, "execute").mockRejectedValue(new Error("invalid plane"));
        const command = new SectionViewCommand();
        running.add(command);

        await expect(command.execute(app)).rejects.toThrow("invalid plane");

        expect(view.sectionPlane).toBe(previousPlane);
    });

    test("closes quietly and forgets the session when its view is closed", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { execution } = await startWithPlane(app, view, Plane.XY);
        const plane = view.sectionPlane;

        PubSub.default.pub("viewClosed", view);
        await execution;

        expect(view.sectionPlane).toBe(plane);

        const reopened = await startWithPlane(app, view, Plane.YZ);
        expect(reopened.command.isCompleted).toBe(false);
    });

    test("reuses the command instance after its view was closed", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { command, execution, pick } = await startWithPlane(app, view, Plane.XY);
        PubSub.default.pub("viewClosed", view);
        await execution;
        pick.mockImplementation(async (_document, controller): Promise<SnapResult> => {
            controller.success();
            return { view, shapes: [], type: "input", plane: Plane.YZ };
        });

        const reopened = command.execute(app);
        await rs.waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
        await rs.waitFor(() =>
            expect(view.document.visual.eventHandler).toBeInstanceOf(SectionOffsetDragHandler),
        );
        const nodes = sectionPlaneNodes(view.document);
        expect(nodes).toHaveLength(2);
        expect(nodes[1].plane.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(command.isCompleted).toBe(false);
        expect(command.isCanceled).toBe(false);

        await command.cancel();
        await reopened;
    });

    test("a second execution closes the editor but preserves the section", async () => {
        const app = createMockApplication();
        const view = createSectionView();
        app.activeView = view;
        const { execution } = await startWithPlane(app, view, Plane.XY);
        const plane = view.sectionPlane;

        await new SectionViewCommand().execute(app);
        await execution;

        expect(view.sectionPlane).toBe(plane);
    });
});
