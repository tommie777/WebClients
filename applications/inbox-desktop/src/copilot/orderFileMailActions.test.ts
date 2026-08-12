import type { WebContents } from "electron";

import { attachOrderFilesToComposer } from "./orderFileMailActions";

describe("attachOrderFilesToComposer", () => {
    it("sets the active Proton composer file input through the browser protocol", async () => {
        const sendCommand = jest
            .fn()
            .mockResolvedValueOnce({ result: { objectId: "composer-input" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const detach = jest.fn();
        const contents = {
            isDestroyed: () => false,
            debugger: {
                isAttached: jest.fn().mockReturnValueOnce(false).mockReturnValue(true),
                attach: jest.fn(),
                detach,
                sendCommand,
            },
        } as unknown as WebContents;

        await expect(attachOrderFilesToComposer(contents, ["/orders/proefdruk.pdf"])).resolves.toEqual({
            ok: true,
            message: "1 bestand is aan de e-mail toegevoegd.",
        });
        expect(sendCommand).toHaveBeenNthCalledWith(2, "DOM.setFileInputFiles", {
            files: ["/orders/proefdruk.pdf"],
            objectId: "composer-input",
        });
        expect(detach).toHaveBeenCalled();
    });

    it("reports that a composer must be opened", async () => {
        const contents = {
            isDestroyed: () => false,
            debugger: {
                isAttached: jest.fn().mockReturnValueOnce(false).mockReturnValue(true),
                attach: jest.fn(),
                detach: jest.fn(),
                sendCommand: jest
                    .fn()
                    .mockResolvedValueOnce({ result: { subtype: "null" } })
                    .mockResolvedValueOnce({}),
            },
        } as unknown as WebContents;

        await expect(attachOrderFilesToComposer(contents, ["/orders/proefdruk.pdf"])).resolves.toEqual({
            ok: false,
            message: "Open eerst een antwoord of nieuwe e-mail in Proton.",
        });
    });
});
