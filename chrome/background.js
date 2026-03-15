function createMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "closeSameDomain",
            title: "Close all tabs from this domain",
            contexts: ["all"]
        });
    });
}

function closeTabsFromDomain(activeTab) {
    if (activeTab.url) {
        try {
            const targetDomain = new URL(activeTab.url).hostname;

            chrome.tabs.query({ currentWindow: true }, (allTabs) => {
                const idsToRemove = allTabs
                    .filter(t => t.url && t.url.includes(targetDomain))
                    .map(t => t.id);

                chrome.tabs.remove(idsToRemove);
            });
        } catch (e) {
            console.error("Invalid URL:", e);
        }
    }
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

// Clicking the Toolbar Icon
chrome.action.onClicked.addListener((tab) => {
    closeTabsFromDomain(tab);
});

// Clicking via the Context Menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "closeSameDomain") {
        closeTabsFromDomain(tab);
    }
});