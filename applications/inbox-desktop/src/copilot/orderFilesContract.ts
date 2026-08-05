export const ORDER_FILES_BROWSE_CHANNEL = "colorspace-order-files:browse";
export const ORDER_FILES_OPEN_CHANNEL = "colorspace-order-files:open";
export const ORDER_FILES_REVEAL_CHANNEL = "colorspace-order-files:reveal";
export const ORDER_FILES_DRAG_CHANNEL = "colorspace-order-files:drag";

export type OrderFilesBrowseRequest = {
    segments?: string[];
    orderNumber?: string;
    orderDate?: string;
};

export type OrderFileEntry = {
    id: string | null;
    name: string;
    kind: "directory" | "file";
    segments: string[];
    extension: string;
    size: number | null;
    modifiedAt: string | null;
};

export type OrderFilesBrowseResult = {
    available: boolean;
    rootName: string;
    segments: string[];
    entries: OrderFileEntry[];
    resolvedOrder: boolean;
    message: string | null;
};

export type OrderFileActionResult = {
    ok: boolean;
    message: string | null;
};
