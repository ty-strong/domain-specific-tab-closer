function createMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "closeSameDomain",
            title: "Close all tabs from this domain",
            contexts: ["all"]
        });
        // Only show this option if we are on a YouTube page
        chrome.contextMenus.create({
            id: "closeSameChannel",
            title: "Close all tabs from this YouTube Channel",
            contexts: ["all"],
            documentUrlPatterns: ["*://*.youtube.com/*"]
        });
    });
}

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

// Function to extract a clean identity (ID or Handle)
function getRawYouTubeId() {
    // 1. The ID is the gold standard
    const metaId = document.querySelector('meta[itemprop="channelId"]')?.content;
    if (metaId) return metaId;

    // 2. Fallback to the link under the video
    const channelLink = document.querySelector('#upload-info a.yt-simple-endpoint')?.href;
    if (channelLink) {
        // Extracts either the @handle or the UC... ID
        const match = channelLink.match(/(?:\/channel\/|\/user\/|\/)(UC[a-zA-Z0-9_-]{22}|@[a-zA-Z0-9_-]+)/);

        // A cleaner way to handle the fallback
        if (match) return match[1];

        // If no regex match, at least strip off the "?v=..." part of a URL if it exists
        return channelLink.split('?')[0].replace(/\/$/, "");
    }
    return null;
}

// Function to ask the user if they are sure
function confirmNuke(channelName) {
    return confirm(`Are you sure you want to close all tabs from ${channelName}?`);
}

async function closeYouTubeChannelTabs(activeTab) {
    // 1. Get the Channel ID and the visible Name
    const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
            const id = (function() {
                const metaId = document.querySelector('meta[itemprop="channelId"]')?.content;
                if (metaId) return metaId;
                const link = document.querySelector('#upload-info a.yt-simple-endpoint')?.href;
                const match = link?.match(/(?:\/channel\/|\/user\/|\/)(UC[a-zA-Z0-9_-]{22}|@[a-zA-Z0-9_-]+)/);
                return match ? match[1] : link;
            })();
            const name = document.querySelector('#upload-info #channel-name a')?.innerText || "this channel";
            return { id, name };
        }
    });

    const { id: targetId, name: channelName } = results[0].result;
    if (!targetId) return;

    // 2. Ask for confirmation
    const conf = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: confirmNuke,
        args: [channelName]
    });

    if (!conf[0].result) return; // User clicked 'Cancel'

    // 3. The Nuke
    const allTabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
    for (const tab of allTabs) {
        if (tab.id === activeTab.id) continue;
        try {
            const check = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getRawYouTubeId
            });
            if (check[0]?.result === targetId) {
                await chrome.tabs.remove(tab.id);
            }
        } catch (e) { continue; }
    }
}

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