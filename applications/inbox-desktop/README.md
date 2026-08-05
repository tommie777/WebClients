<p align="center">
  <img src="assets/icons/icon.png" width="256" height="256">
</p>

# Proton Desktop

Proton Desktop is an [Electron](https://electronjs.org)-based project that offers a native desktop experience for Proton Mail and Proton Calendar.

## Colorspace Mail Copilot bridge

This fork can connect the currently opened Proton conversation to the separate,
local Colorspace Mail Copilot. Start that app on `127.0.0.1:3210`, then launch
this desktop app with:

```bash
COLORSPACE_COPILOT_SELECTION_URL=http://127.0.0.1:3210/api/proton/selection \
COLORSPACE_COPILOT_BRIDGE_TOKEN='<same local token as the Copilot app>' \
  yarn workspace proton-inbox-desktop start
```

The bridge reads only messages that are currently opened/expanded in the
selected conversation. It sends them over the loopback interface, waits for a
reviewed draft, and inserts that draft into the active reply composer. It never
presses Send. Missing or unavailable Copilot configuration must not interrupt
normal Proton Mail operation.
