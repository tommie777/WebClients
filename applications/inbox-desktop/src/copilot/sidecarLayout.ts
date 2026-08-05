import type { Rectangle } from "electron";

export const COPILOT_WINDOW_MINIMUM_WIDTH = 1380;

export type CopilotSidecarLayout = {
    primary: Rectangle;
    divider: Rectangle;
    sidecar: Rectangle;
};

export const getCopilotSidecarLayout = (width: number, height: number): CopilotSidecarLayout => {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const sidecarWidth = Math.min(540, Math.max(420, Math.round(safeWidth * 0.34)));
    const dividerWidth = 1;
    const primaryWidth = Math.max(1, safeWidth - sidecarWidth - dividerWidth);

    return {
        primary: { x: 0, y: 0, width: primaryWidth, height: safeHeight },
        divider: { x: primaryWidth, y: 0, width: dividerWidth, height: safeHeight },
        sidecar: { x: primaryWidth + dividerWidth, y: 0, width: sidecarWidth, height: safeHeight },
    };
};
