import type { Rectangle } from "electron";

export const COPILOT_WINDOW_MINIMUM_WIDTH = 1380;
export const COPILOT_SIDECAR_MINIMUM_WIDTH = 360;
export const COPILOT_SIDECAR_MAXIMUM_WIDTH = 760;
export const COPILOT_PRIMARY_MINIMUM_WIDTH = 900;

export type CopilotSidecarLayout = {
    primary: Rectangle;
    divider: Rectangle;
    sidecar: Rectangle;
};

export const getCopilotSidecarLayout = (
    width: number,
    height: number,
    preferredSidecarWidth?: number,
): CopilotSidecarLayout => {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const dividerWidth = 2;
    const availableSidecarWidth = Math.max(1, safeWidth - COPILOT_PRIMARY_MINIMUM_WIDTH - dividerWidth);
    const maximumSidecarWidth = Math.min(COPILOT_SIDECAR_MAXIMUM_WIDTH, availableSidecarWidth);
    const minimumSidecarWidth = Math.min(COPILOT_SIDECAR_MINIMUM_WIDTH, maximumSidecarWidth);
    const requestedSidecarWidth = Number.isFinite(preferredSidecarWidth)
        ? Math.round(preferredSidecarWidth!)
        : Math.round(safeWidth * 0.34);
    const sidecarWidth = Math.max(minimumSidecarWidth, Math.min(maximumSidecarWidth, requestedSidecarWidth));
    const primaryWidth = Math.max(1, safeWidth - sidecarWidth - dividerWidth);

    return {
        primary: { x: 0, y: 0, width: primaryWidth, height: safeHeight },
        divider: { x: primaryWidth, y: 0, width: dividerWidth, height: safeHeight },
        sidecar: { x: primaryWidth + dividerWidth, y: 0, width: sidecarWidth, height: safeHeight },
    };
};
