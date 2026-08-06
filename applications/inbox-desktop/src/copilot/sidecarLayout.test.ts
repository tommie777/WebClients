import { COPILOT_WINDOW_MINIMUM_WIDTH, getCopilotSidecarLayout } from "./sidecarLayout";

describe("getCopilotSidecarLayout", () => {
    it("keeps enough room for Proton at the minimum window width", () => {
        const layout = getCopilotSidecarLayout(COPILOT_WINDOW_MINIMUM_WIDTH, 900);

        expect(layout.primary.width).toBeGreaterThanOrEqual(900);
        expect(layout.sidecar.width).toBeGreaterThanOrEqual(360);
        expect(layout.primary.x + layout.primary.width).toBeLessThanOrEqual(layout.sidecar.x);
        expect(layout.sidecar.x + layout.sidecar.width).toBeLessThan(COPILOT_WINDOW_MINIMUM_WIDTH);
        expect(layout.sidecar.y).toBeGreaterThan(0);
        expect(layout.sidecar.height).toBeLessThan(900);
    });

    it("caps the sidecar on wide windows", () => {
        const layout = getCopilotSidecarLayout(2200, 1100);

        expect(layout.sidecar).toEqual({ x: 1434, y: 15, width: 748, height: 1070 });
        expect(layout.divider).toEqual({ x: 1421, y: 0, width: 13, height: 1100 });
        expect(layout.backdrop).toEqual({ x: 1430, y: 13, width: 756, height: 1076 });
    });

    it("honors a preferred width while protecting Proton's workspace", () => {
        expect(getCopilotSidecarLayout(1900, 900, 620).sidecar.width).toBe(620);
        expect(getCopilotSidecarLayout(1380, 900, 900).sidecar.width).toBe(459);
        expect(getCopilotSidecarLayout(1900, 900, 100).sidecar.width).toBe(360);
    });

    it("keeps the inset panel separate from Proton at every supported size", () => {
        for (const [width, height] of [
            [1380, 760],
            [1720, 940],
            [2560, 1400],
        ]) {
            const layout = getCopilotSidecarLayout(width, height);
            expect(layout.primary.x + layout.primary.width).toBeLessThanOrEqual(layout.divider.x);
            expect(layout.divider.x + layout.divider.width).toBe(layout.sidecar.x);
            expect(layout.sidecar.x + layout.sidecar.width).toBeLessThan(width);
            expect(layout.sidecar.y + layout.sidecar.height).toBeLessThan(height);
        }
    });
});
