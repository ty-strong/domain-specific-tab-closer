/**
 * @file background.js
 * @description Service worker for the "Close Domain Tabs" Firefox extension.
 * @version 2.6
 *
 * This script handles all core logic for the extension, including:
 * - Closing tabs by domain.
 * - Closing tabs by YouTube channel from regular videos and Shorts.
 * - Caching API responses to improve performance and reduce quota usage.
 * - Managing the browser action (toolbar button) and context menus.
 */

// --- Constants and Configuration ---

/** @const {string} The key used to store the YouTube video cache in browser.storage.local. */
const YOUTUBE_CACHE_KEY = 'youtubeVideoCache';

/** @const {number} The cache's Time-To-Live in milliseconds. Items older than this will be re-fetched. (24 hours) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --- Helper Functions: Small, reusable utility tools ---

/**
 * Extracts the hostname (e.g., "www.example.com") from a full URL string.
 * @param {string} urlString The URL to parse.
 * @returns {string|null} The hostname, or null if the URL is invalid.
 */
function getDomainFromUrl(urlString) {
  if (!urlString) return null;
  try { return new URL(urlString).hostname; } catch (error) { return null; }
}

/**
 * Displays a desktop notification to the user.
 * @param {string} message The message to display in the notification body.
 */
function showNotification(message) {
  browser.notifications.create({
    type: "basic", iconUrl: browser.runtime.getURL("icons/icon-48.png"),
    title: "Tab Closer", message: message,
  });
}

/**
 * Extracts a YouTube channel identifier (e.g., /@handle, /c/channel) from a channel page URL.
 * @param {URL} url The URL object to parse.
 * @returns {string|null} The channel identifier, or null if not a valid channel URL.
 */
function getYouTubeChannelFromUrl(url) {
  if (!url || !url.hostname.includes("youtube.com")) return null;
  // This regex looks for known YouTube channel URL patterns in the path.
  const match = url.pathname.match(/^\/(@[^/]+|c\/[^/]+|user\/[^/]+|channel\/[^/]+)/);
  return match ? match[1] : null;
}

/**
 * Extracts a video ID from a YouTube URL, supporting both regular videos and Shorts.
 * @param {URL} url The URL object to parse.
 * @returns {string|null} The video or Short ID, or null if not a valid content URL.
 */
function getVideoIdFromUrl(url) {
  if (!url) return null;
  // Handle regular videos: /watch?v=VIDEO_ID
  if (url.pathname === '/watch') {
    return url.searchParams.get('v');
  }
  // Handle Shorts: /shorts/SHORT_ID
  const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
  if (shortsMatch) {
    return shortsMatch[1]; // Return the captured ID part of the URL.
  }
  return null;
}

/**
 * A utility function to check if a URL points to a recognizable YouTube content page.
 * @param {URL} url The URL object to check.
 * @returns {boolean} True if the URL is a video, Short, or channel page.
 */
function isYouTubeContentPage(url) {
    return url.pathname === '/watch' || url.pathname.startsWith('/shorts/') || getYouTubeChannelFromUrl(url);
}

/**
 * Fetches video details from the cache or the YouTube Data API v3 if not found/expired.
 * This function is the core of the performance optimization. It handles API limits by "chunking" requests.
 * @param {string[]} videoIds - An array of YouTube video IDs to fetch details for.
 * @returns {Promise<Object[]|null>} A promise that resolves to an array of video "item" objects from the API.
 */
async function fetchVideoDetails(videoIds) {
  // Pre-flight check for the API key to fail fast and provide a clear error.
  if (typeof YOUTUBE_API_KEY === 'undefined' || YOUTUBE_API_KEY === "YOUR_API_KEY_HERE") {
    showNotification("Error: YouTube API key is missing or invalid. Please check config.js.");
    return null;
  }
  if (!videoIds || videoIds.length === 0) return [];

  const cache = (await browser.storage.local.get(YOUTUBE_CACHE_KEY))[YOUTUBE_CACHE_KEY] || {};
  const freshDetailsFromCache = [];
  const idsToFetchFromApi = [];
  const now = Date.now();

  // 1. Partition the requested IDs: check the cache for each ID.
  for (const videoId of videoIds) {
    const cachedItem = cache[videoId];
    // If a valid, non-expired item exists in the cache, use it.
    if (cachedItem && (now - cachedItem.timestamp < CACHE_TTL_MS)) {
      freshDetailsFromCache.push(cachedItem.data);
    } else {
      // Otherwise, add it to the list of IDs we need to fetch from the API.
      idsToFetchFromApi.push(videoId);
    }
  }

  // 2. Fetch missing data from the API in chunks if necessary.
  let newlyFetchedDetails = [];
  if (idsToFetchFromApi.length > 0) {
    const chunkSize = 50; // The official YouTube API limit for the videos endpoint.
    for (let i = 0; i < idsToFetchFromApi.length; i += chunkSize) {
      const chunk = idsToFetchFromApi.slice(i, i + chunkSize);
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(',')}&key=${YOUTUBE_API_KEY}`;
      try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`API chunk request failed: ${response.statusText}`);
        const data = await response.json();
        if (data.items) newlyFetchedDetails.push(...data.items);
      } catch (error) {
        console.error("Failed to fetch a chunk of video details:", error);
        showNotification("Error fetching some data from YouTube API.");
      }
    }
    // 3. Update the cache with the newly fetched data.
    if (newlyFetchedDetails.length > 0) {
      for (const item of newlyFetchedDetails) {
        cache[item.id] = { timestamp: now, data: item };
      }
    }
  }

  // 4. Prune old entries from the cache to prevent it from growing indefinitely.
  for (const videoId in cache) {
    if (now - cache[videoId].timestamp > CACHE_TTL_MS) delete cache[videoId];
  }
  
  // 5. Save the updated cache and return the combined results from both cache and API.
  await browser.storage.local.set({ [YOUTUBE_CACHE_KEY]: cache });
  return [...freshDetailsFromCache, ...newlyFetchedDetails];
}

// --- Core Logic: The main actions of the extension ---

/**
 * Closes all tabs belonging to a specific domain.
 * @param {string} domain - The domain to close tabs for (e.g., "google.com").
 */
async function closeTabsForDomain(domain) {
  if (!domain) return;
  const tabs = await browser.tabs.query({ url: `*://${domain}/*` });
  if (tabs.length > 0) {
    browser.tabs.remove(tabs.map(t => t.id));
    showNotification(`Closed ${tabs.length} tab(s) from ${domain}.`);
  } else {
    showNotification(`No open tabs found for domain: ${domain}.`);
  }
}

/**
 * Orchestrates the closing of all tabs related to a specific YouTube Channel ID.
 * This is the primary workhorse for the YouTube feature, handling both videos and Shorts.
 * @param {string} targetChannelId - The official YouTube Channel ID (e.g., UCBJycsmduvYEL83R_U4JriQ).
 * @param {string} sourceTitle - The display name of the channel, used for notifications.
 */
async function closeTabsByChannel(targetChannelId, sourceTitle) {
  if (!targetChannelId) return;
  let tabsToClose = new Set();
  
  // Step 1: Find tabs that are on the channel's own pages (e.g., /channel/ID/videos).
  const directChannelTabs = await browser.tabs.query({ url: `*://*.youtube.com/channel/${targetChannelId}*` });
  directChannelTabs.forEach(tab => tabsToClose.add(tab.id));

  // Step 2: Find all open YouTube tabs to check if they are videos or Shorts.
  const allYouTubeTabs = await browser.tabs.query({ url: "*://*.youtube.com/*" });
  const videoIdsToCheck = [];
  const tabsWithVideoIds = [];
  
  for (const tab of allYouTubeTabs) {
    const videoId = getVideoIdFromUrl(new URL(tab.url));
    if (videoId) {
      videoIdsToCheck.push(videoId);
      tabsWithVideoIds.push(tab);
    }
  }

  // Step 3: Use our cache-aware helper to get details for all videos. This is the potentially slow part.
  const videoDetails = await fetchVideoDetails(videoIdsToCheck);

  // Step 4: Cross-reference the API results with our list of open tabs.
  if (videoDetails) {
    videoDetails.forEach(video => {
      // If a video's channel ID matches our target...
      if (video.snippet.channelId === targetChannelId) {
        // ...find the corresponding open tab and add it to our set for closing.
        const matchingTab = tabsWithVideoIds.find(tab => tab.url.includes(video.id));
        if (matchingTab) tabsToClose.add(matchingTab.id);
      }
    });
  }

  // Step 5: Close all collected tabs.
  const finalTabIds = Array.from(tabsToClose);
  if (finalTabIds.length > 0) {
    browser.tabs.remove(finalTabIds);
    showNotification(`Closed ${finalTabIds.length} tab(s) for channel: ${sourceTitle}.`);
  } else {
    showNotification(`No open tabs found for channel: ${sourceTitle}.`);
  }
}

/**
 * An entry point function that determines a channel's ID from a source URL and initiates the closing process.
 * @param {string} sourceUrl - The URL of the tab the user clicked on.
 */
async function getChannelIdAndClose(sourceUrl) {
    const url = new URL(sourceUrl);
    const videoId = getVideoIdFromUrl(url); // This now works for Shorts too.

    if (videoId) {
        // Get the video details for this single video to find its channel ID.
        const videoDetails = await fetchVideoDetails([videoId]);
        if (videoDetails && videoDetails.length > 0) {
            const channelId = videoDetails[0].snippet.channelId;
            const channelTitle = videoDetails[0].snippet.channelTitle;
            // Now that we have the official ID, start the main closing process.
            closeTabsByChannel(channelId, channelTitle);
        }
    } else {
        // Converting a channel handle (e.g., @MKBHD) to a channel ID requires another API endpoint (Search).
        // For simplicity and to conserve API quota, we guide the user to a more reliable path.
        showNotification("This feature works best when started from a video or Shorts page.");
    }
}

// --- Event Listeners: Attaching logic to browser events and user actions ---

/**
 * Handles clicks on the main browser action (toolbar button).
 * Implements "smart" logic to decide which action to take based on the active tab's URL.
 */
browser.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.url) return;
    const url = new URL(tab.url);

    // If on a relevant YouTube page, perform the YouTube action.
    if (url.hostname.includes("youtube.com") && isYouTubeContentPage(url)) {
        getChannelIdAndClose(tab.url);
    } else {
        // Otherwise, perform the default action of closing by domain.
        closeTabsForDomain(getDomainFromUrl(tab.url));
    }
});

/**
 * Sets up the context menus when the extension is first installed or updated.
 */
browser.runtime.onInstalled.addListener(() => {
    // removeAll() is crucial to ensure a clean state and apply updates to menu titles/properties.
    browser.contextMenus.removeAll().then(() => {
        // General domain-closing menu item, available on all pages.
        browser.contextMenus.create({ id: "close-domain", title: "Close all tabs from this domain", contexts: ["page", "tab"] });
        
        // YouTube-specific menu item.
        browser.contextMenus.create({
            id: "close-yt-channel",
            title: "Close all tabs for this YouTube channel",
            contexts: ["page", "tab"],
            // This ensures the menu item only appears on relevant YouTube pages.
            documentUrlPatterns: [
                "*://*.youtube.com/watch*",
                "*://*.youtube.com/shorts/*", // Added support for Shorts
                "*://*.youtube.com/@*",
                "*://*.youtube.com/c/*",
                "*://*.youtube.com/user/*",
                "*://*.youtube.com/channel/*"
            ],
        });
    });
});

/**
 * Handles clicks on any of our created context menu items.
 */
browser.contextMenus.onClicked.addListener((info, tab) => {
    const url = tab?.url || info.pageUrl;
    switch (info.menuItemId) {
        case "close-domain":
            closeTabsForDomain(getDomainFromUrl(url));
            break;
        case "close-yt-channel":
            getChannelIdAndClose(url);
            break;
    }
});

/**
 * Updates the browser action's tooltip (title) to be context-aware.
 * @param {number} tabId - The ID of the tab to update the title for.
 */
async function updateActionTitle(tabId) {
    try {
        const tab = await browser.tabs.get(tabId);
        // Do nothing for special browser pages like about:debugging that don't have standard URLs.
        if (!tab || !tab.url || !tab.url.startsWith("http")) {
            browser.action.setTitle({ tabId, title: "Close Tabs" }); return;
        }
        const url = new URL(tab.url);
        let title = `Close all tabs from ${url.hostname}`; // Default title.

        // Provide a more specific, helpful title for YouTube pages.
        if (url.hostname.includes("youtube.com") && isYouTubeContentPage(url)) {
            title = "Close all tabs for this YouTube channel";
        }
        browser.action.setTitle({ tabId, title });
    } catch (e) {
      // This can fail if the tab was closed while the update was pending, so we safely ignore the error.
    }
}

/**
 * These two listeners ensure the toolbar title is always up-to-date.
 */
// Fired when a tab finishes loading.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) updateActionTitle(tabId);
});
// Fired when the user switches to a different tab.
browser.tabs.onActivated.addListener((activeInfo) => {
    updateActionTitle(activeInfo.tabId);
});