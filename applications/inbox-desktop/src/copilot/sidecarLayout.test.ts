import { COPILOT_WINDOW_MINIMUM_WIDTH, getCopilotSidecarLayout } from "./sidecarLayout";

describe("getCopilotSidecarLayout", () => {
    it("keeps enough room for Proton at the minimum window width", () => {
        const layout = getCopilotSidecarLayout(COPILOT_WINDOW_MINIMUM_WIDTH, 900);

        expect(layout.primary.width).toBeGreaterThanOrEqual(900);
        expect(layout.sidecar.width).toBeGreaterThanOrEqual(420);
        expect(layout.primary.width + layout.divider.width + layout.sidecar.width).toBe(COPILOT_WINDOW_MINIMUM_WIDTH);
    });

    it("caps the sidecar on wide windows", () => {
        const layout = getCopilotSidecarLayout(2200, 1100);

        expect(layout.sidecar).toEqual({ x: 1660, y: 0, width: 540, height: 1100 });
        expect(layout.divider).toEqual({ x: 1659, y: 0, width: 1, height: 1100 });
    });
});
