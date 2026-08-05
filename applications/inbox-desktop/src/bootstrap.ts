import { app } from "electron";
import { join } from "node:path";

import pkg from "../package.json";

// Establish an independent Electron identity before any store, logger or view
// module is loaded. This keeps the Colorspace fork completely separate from
// the official Proton Mail profile and its single-instance lock.
app.setName(pkg.productName);
const userDataPath = join(app.getPath("appData"), pkg.productName);
app.setPath("userData", userDataPath);
app.setPath("sessionData", join(userDataPath, "Session Data"));
app.setAppLogsPath(join(userDataPath, "logs"));

void import("./index");
