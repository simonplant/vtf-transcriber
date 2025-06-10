# How to Debug the VTF Audio Transcriber Extension

Debugging a Chrome Extension can be tricky because its code runs in several different places. Logs and errors **will not appear** in the normal JavaScript console of a web page.

Here's where to find the logs for each part of the extension:

### 1. The Background Service Worker (`background.js`)

This is the **most important** console. It's the brain of the extension, handling state, API calls, and tab capture logic.

1.  Open Chrome and navigate to `chrome://extensions`.
2.  Make sure "Developer mode" is toggled **on** in the top-right corner.
3.  Find the "VTF Audio Transcriber" extension card.
4.  Click on the **`service worker`** link.
5.  A new DevTools window will open. All logs from `background.js` will appear in the `Console` tab here.

[![Service Worker Link](https://developer.chrome.com/docs/extensions/mv3/assets/tutorials/debugging/service-worker.png)](https://developer.chrome.com/docs/extensions/mv3/assets/tutorials/debugging/service-worker.png)

### 2. The Popup Window (`popup.js`)

The popup has its own, separate developer console.

1.  Click on the extension's icon in the Chrome toolbar to open the popup.
2.  **Right-click** anywhere inside the popup window.
3.  Select **`Inspect`** from the context menu.
4.  A new DevTools window will open. The `Console` tab will show all logs and UI-related errors from `popup.js`.

### 3. The Offscreen Document (`offscreen.js`)

The offscreen document also has its own console where audio recording logs appear.

1.  First, open the Service Worker console (see section 1).
2.  In the Service Worker console, you will see logs related to the offscreen document being created when you start a capture.
3.  To inspect it directly, navigate to `chrome://extensions/?id=YOUR_EXTENSION_ID` (you can find your extension's ID on the `chrome://extensions` page).
4.  Under the "Inspect views" section, you should see a link for `offscreen.html`. Click it to open its dedicated DevTools.

By using these three consoles, you will have a complete picture of everything happening inside the extension. The Service Worker console is where you'll spend most of your time. 