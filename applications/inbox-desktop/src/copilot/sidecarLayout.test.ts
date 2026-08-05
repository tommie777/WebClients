import { COPILOT_WINDOW_MINIMUM_WIDTH, getCopilotSidecarLayout } from "./sidecarLayout";

describe("getCopilotSidecarLayout", () => {
    it("keeps enough room for Proton at the minimum window width", () => {
        const layout = getCopilotSidecarLayout(COPILOT_WINDOW_MINIMUM_WIDTH, 900);

        expect(layout.primary.width).toBeGreaterThanOrEqual(900);
        expect(layout.sidecar.width).toBeGreaterThanOrEqual(360);
        expect(layout.primary.width + layout.divider.width + layout.sidecar.width).toBe(COPILOT_WINDOW_MINIMUM_WIDTH);
    });

    it("caps the sidecar on wide windows", () => {
        const layout = getCopilotSidecarLayout(2200, 1100);

        expect(layout.sidecar).toEqual({ x: 1452, y: 0, width: 748, height: 1100 });
        expect(layout.divider).toEqual({ x: 1450, y: 0, width: 2, height: 1100 });
    });

    it("honors a preferred width while protecting Proton's workspace", () => {
        expect(getCopilotSidecarLayout(1900, 900, 620).sidecar.width).toBe(620);
        expect(getCopilotSidecarLayout(1380, 900, 900).sidecar.width).toBe(478);
        expect(getCopilotSidecarLayout(1900, 900, 100).sidecar.width).toBe(360);
    });
});
