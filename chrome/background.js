/**
 * Setup Context Menus
 */
function createMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "closeSameDomain",
            title: "Close all tabs from this domain",
            contexts: ["all"]
        });
        chrome.contextMenus.create({
            id: "closeSameChannel",
            title: "Close all tabs from this YouTube Channel",
            contexts: ["all"],
            documentUrlPatterns: ["*://*.youtube.com/*"]
        });
    });
}

/**
 * Logic for Domain Closing (Toolbar Icon & Menu)
 */
async function closeTabsFromDomain(activeTab) {
    if (!activeTab.url) return;
    try {
        const targetDomain = new URL(activeTab.url).hostname;
        const allTabs = await chrome.tabs.query({ currentWindow: true });

        const idsToRemove = allTabs
            .filter(t => t.url && t.url.includes(targetDomain))
            .map(t => t.id);

        if (idsToRemove.length > 0) {
            await chrome.tabs.remove(idsToRemove);
        }
    } catch (e) {
        console.error("Domain close failed:", e);
    }
}

/**
 * Script injected into YouTube tabs to find the Channel Identifier
 */
function getRawYouTubeId() {
    // 1. Permanent ID from meta tag
    const metaId = document.querySelector('meta[itemprop="channelId"]')?.content;

    // 2. Visible Channel Link (More reliable on SPAs)
    const channelLink = document.querySelector('#upload-info a.yt-simple-endpoint')?.href;

    // 3. Visible Channel Name (For the confirmation dialog)
    const channelName = document.querySelector('#upload-info #channel-name a')?.innerText || "this channel";

    let id = metaId;
    if (!id && channelLink) {
        const match = channelLink.match(/(?:\/channel\/|\/user\/|\/)(UC[a-zA-Z0-9_-]{22}|@[a-zA-Z0-9_-]+)/);
        id = match ? match[1] : channelLink.split('?')[0].replace(/\/$/, "");
    }

    return { id, name: channelName };
}

function confirmNuke(channelName) {
    return confirm(`Are you sure you want to close all tabs from ${channelName}?`);
}

/**
 * Logic for YouTube Channel Closing
 */
async function closeYouTubeChannelTabs(activeTab) {
    // Phase 1: Identify the target channel
    const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: getRawYouTubeId
    });

    const { id: targetId, name: channelName } = results[0]?.result || {};
    if (!targetId) return;

    // Phase 2: Confirmation
    const conf = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: confirmNuke,
        args: [channelName]
    });

    if (!conf[0].result) return;

    // Phase 3: Collects tabs to delete
    const allTabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
    const idsToRemove = [];

    for (const tab of allTabs) {
        try {
            const check = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getRawYouTubeId
            });

            if (check[0]?.result?.id === targetId) {
                idsToRemove.push(tab.id);
            }
        } catch (e) {
            continue; // Skip crashed or protected tabs
        }
    }

    // Phase 4: Removes any tabs to be deleted
    if (idsToRemove.length > 0) {
        await chrome.tabs.remove(idsToRemove);
    }
}

/**
 * Event Listeners
 */
chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);
chrome.action.onClicked.addListener(closeTabsFromDomain);

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "closeSameDomain") {
        closeTabsFromDomain(tab);
    } else if (info.menuItemId === "closeSameChannel") {
        closeYouTubeChannelTabs(tab);
    }
});