import type { Rectangle } from "electron";

export const COPILOT_WINDOW_MINIMUM_WIDTH = 1380;
export const COPILOT_SIDECAR_MINIMUM_WIDTH = 360;
export const COPILOT_SIDECAR_MAXIMUM_WIDTH = 760;
export const COPILOT_PRIMARY_MINIMUM_WIDTH = 900;

export type CopilotSidecarLayout = {
    primary: Rectangle;
    divider: Rectangle;
    backdrop: Rectangle;
    sidecar: Rectangle;
};

const clamp = (minimum: number, value: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export const getCopilotSidecarLayout = (
    width: number,
    height: number,
    preferredSidecarWidth?: number,
): CopilotSidecarLayout => {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const rightInset = clamp(10, Math.round(safeWidth * 0.008), 18);
    const verticalInset = clamp(10, Math.round(safeHeight * 0.014), 18);
    const dividerWidth = clamp(10, Math.round(safeWidth * 0.006), 16);
    const availableSidecarWidth = Math.max(1, safeWidth - COPILOT_PRIMARY_MINIMUM_WIDTH - dividerWidth - rightInset);
    const maximumSidecarWidth = Math.min(COPILOT_SIDECAR_MAXIMUM_WIDTH, availableSidecarWidth);
    const minimumSidecarWidth = Math.min(COPILOT_SIDECAR_MINIMUM_WIDTH, maximumSidecarWidth);
    const requestedSidecarWidth = Number.isFinite(preferredSidecarWidth)
        ? Math.round(preferredSidecarWidth!)
        : Math.round(safeWidth * 0.34);
    const sidecarWidth = Math.max(minimumSidecarWidth, Math.min(maximumSidecarWidth, requestedSidecarWidth));
    const primaryWidth = Math.max(1, safeWidth - sidecarWidth - dividerWidth - rightInset);
    const sidecar = {
        x: primaryWidth + dividerWidth,
        y: verticalInset,
        width: sidecarWidth,
        height: Math.max(1, safeHeight - verticalInset * 2),
    };
    const edgeSpread = 2;

    return {
        primary: { x: 0, y: 0, width: primaryWidth, height: safeHeight },
        divider: { x: primaryWidth, y: 0, width: dividerWidth, height: safeHeight },
        backdrop: {
            x: sidecar.x - edgeSpread,
            y: sidecar.y - 2,
            width: sidecar.width + edgeSpread * 2,
            height: sidecar.height + edgeSpread * 2,
        },
        sidecar,
    };
};
