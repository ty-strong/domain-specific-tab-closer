# Domain Tab Closer

A lightweight Brave/Chrome extension built to help manage tab clutter. With a single click or context menu action, you can instantly close all open tabs belonging to the domain you are currently viewing.

## Features
* **One-Click Nuke:** Click the extension icon in the toolbar to close all tabs from the current domain.
* **Context Menu:** Right-click anywhere on a page to access the "Close all tabs from this domain" option.
* **Resource Friendly:** Built with Manifest V3 and Service Workers, ensuring zero battery or RAM drain when not in use.

## 🛠️ Installation (Developer Mode)
Since this extension is in development, you can load it manually into any Chromium-based browser (I created a version for Firefox initially, but I recommend not using it right now, since I plan to rework it, so we'll use Brave as an example):

1.  **Download/Clone** this repository to your local machine.
2.  Open Brave and navigate to `brave://extensions`.
3.  Toggle **Developer mode** (top right corner) to **ON**.
4.  Click the **Load unpacked** button.
5.  Select the folder containing the `manifest.json` and `background.js` files.
6.  (Optional) Click the **Puzzle Piece** icon in your toolbar and **Pin** the extension for easy access.

## How to Use
1.  Navigate to a site where you have many tabs open (e.g., YouTube).
2.  **Either:** Click the extension icon in the browser toolbar.
3.  **Or:** Right-click anywhere on the webpage and select **Close all tabs from this domain**.
