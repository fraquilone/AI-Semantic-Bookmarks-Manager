// --- CONFIGURATION ---
const API_BASE_URL = "https://YOUR-APP-NAME.onrender.com";

document.addEventListener("DOMContentLoaded", async () => {
    // Tabs & Sections
    const tabs = {
        save: document.getElementById("tab-save"),
        search: document.getElementById("tab-search"),
        manage: document.getElementById("tab-manage")
    };
    const sections = {
        save: document.getElementById("section-save"),
        search: document.getElementById("section-search"),
        manage: document.getElementById("section-manage")
    };

    // Save Section Elements
    const urlInput = document.getElementById("current-url");
    const saveStatus = document.getElementById("save-status");
    const existingContainer = document.getElementById("existing-container");
    const existingCard = document.getElementById("existing-card");
    const newContainer = document.getElementById("new-container");
    const btnSave = document.getElementById("btn-save");
    const btnRegen = document.getElementById("btn-regen");
    const btnDeleteSave = document.getElementById("btn-delete-save");

    // Search Section Elements
    const searchInput = document.getElementById("search-query");
    const thresholdSlider = document.getElementById("threshold-slider");
    const thresholdVal = document.getElementById("threshold-val");
    const btnSearch = document.getElementById("btn-search");
    const searchStatus = document.getElementById("search-status");
    const searchResults = document.getElementById("search-results");

    // Manage Section Elements
    const manageSearch = document.getElementById("manage-search");
    const manageLimit = document.getElementById("manage-limit");
    const manageSort = document.getElementById("manage-sort");
    const manageStatus = document.getElementById("manage-status");
    const manageResults = document.getElementById("manage-results");

    let activeBookmarkId = null; // Stores ID if current page exists in DB

    // --- Tab Switching ---
    function switchTab(target) {
        Object.keys(tabs).forEach(key => {
            if (tabs[key] && sections[key]) {
                if (key === target) {
                    tabs[key].classList.add("active");
                    sections[key].classList.add("active");
                } else {
                    tabs[key].classList.remove("active");
                    sections[key].classList.remove("active");
                }
            }
        });
        if (target === "manage" && typeof fetchManageBookmarks === "function") {
            fetchManageBookmarks();
        }
    }

    tabs.save?.addEventListener("click", () => switchTab("save"));
    tabs.search?.addEventListener("click", () => switchTab("search"));
    tabs.manage?.addEventListener("click", () => switchTab("manage"));

    // --- Threshold Slider (0.01 Precision) ---
    thresholdSlider?.addEventListener("input", (e) => {
        thresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
    });

    // --- Startup Check for Current Tab ---
    async function initSaveTab() {
        try {
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.startsWith("http")) {
                urlInput.value = tab.url;
                await checkExistingBookmark(tab.url);
            } else {
                urlInput.value = tab?.url || "Unable to get URL";
                showStatus(saveStatus, "Cannot bookmark non-web pages.", "error");
            }
        } catch (e) {
            urlInput.value = "Unable to get URL";
            showStatus(saveStatus, `Error: ${e.message}`, "error");
        }
    }

    // --- Query Backend for Existing URL ---
    async function checkExistingBookmark(url) {
        showStatus(saveStatus, "Checking database...", "loading");
        try {
            const res = await fetch(`${API_BASE_URL}/bookmark/check?url=${encodeURIComponent(url)}`);
            const data = await res.json();

            if (res.ok && data.exists) {
                showStatus(saveStatus, "Bookmark already saved!", "success");
                activeBookmarkId = data.data.id;
                renderExistingCard(data.data);
                existingContainer.classList.remove("hidden");
                newContainer.classList.add("hidden");
            } else {
                showStatus(saveStatus, "", ""); // Clear status
                activeBookmarkId = null;
                existingContainer.classList.add("hidden");
                newContainer.classList.remove("hidden");
            }
        } catch (err) {
            showStatus(saveStatus, "Failed to connect to backend.", "error");
            newContainer.classList.remove("hidden");
        }
    }

    function renderExistingCard(b) {
        const tagsHtml = (b.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
        existingCard.innerHTML = `
            <div class="result-card">
                <p class="result-title">${b.title || 'Untitled'}</p>
                <a href="${b.url}" class="result-url" target="_blank">${b.url}</a>
                <p class="result-desc">${b.description || 'No description available.'}</p>
                <div style="margin-bottom: 6px;">${tagsHtml}</div>
                <div class="result-meta">
                    <span>Category: ${b.category || 'N/A'}</span>
                </div>
            </div>
        `;
    }

    // --- Save / Regenerate Bookmark ---
    async function processBookmark() {
        const url = urlInput.value;
        if (!url || !url.startsWith("http")) {
            showStatus(saveStatus, "Invalid URL.", "error");
            return;
        }

        btnSave.disabled = true;
        btnRegen.disabled = true;
        showStatus(saveStatus, "Scraping page & generating AI embeddings...", "loading");

        try {
            const response = await fetch(`${API_BASE_URL}/bookmark`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });

            const data = await response.json();
            
            if (response.ok) {
                showStatus(saveStatus, "Successfully updated bookmark!", "success");
                activeBookmarkId = data.data.id;
                renderExistingCard(data.data);
                existingContainer.classList.remove("hidden");
                newContainer.classList.add("hidden");
            } else {
                showStatus(saveStatus, `Error: ${data.detail || 'Unknown error'}`, "error");
            }
        } catch (error) {
            showStatus(saveStatus, `Connection error: ${error.message}`, "error");
        } finally {
            btnSave.disabled = false;
            btnRegen.disabled = false;
        }
    }

    btnSave.addEventListener("click", processBookmark);
    btnRegen.addEventListener("click", processBookmark);

    // --- Delete Bookmark from Save View ---
    btnDeleteSave.addEventListener("click", async () => {
        if (!activeBookmarkId) return;
        if (!confirm("Are you sure you want to delete this bookmark?")) return;

        btnDeleteSave.disabled = true;
        showStatus(saveStatus, "Deleting bookmark...", "loading");

        try {
            const res = await fetch(`${API_BASE_URL}/bookmark/${activeBookmarkId}`, { method: "DELETE" });
            if (res.ok) {
                showStatus(saveStatus, "Bookmark deleted.", "success");
                activeBookmarkId = null;
                existingContainer.classList.add("hidden");
                newContainer.classList.remove("hidden");
            } else {
                showStatus(saveStatus, "Failed to delete bookmark.", "error");
            }
        } catch (err) {
            showStatus(saveStatus, `Error: ${err.message}`, "error");
        } finally {
            btnDeleteSave.disabled = false;
        }
    });

    // --- Search Tab Handler ---
    btnSearch?.addEventListener("click", async () => {
        const query = searchInput.value.trim();
        const threshold = parseFloat(thresholdSlider.value);
        
        if (!query) {
            showStatus(searchStatus, "Please enter a search query.", "error");
            return;
        }

        btnSearch.disabled = true;
        searchResults.innerHTML = "";
        showStatus(searchStatus, "Searching semantic database...", "loading");

        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: query,
                    match_threshold: threshold,
                    match_count: 5
                })
            });

            const data = await response.json();
            
            if (response.ok && data.results.length > 0) {
                showStatus(searchStatus, `Found ${data.results.length} matches.`, "success");
                data.results.forEach(res => {
                    const card = document.createElement("div");
                    card.className = "result-card";
                    const tagsHtml = (res.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
                    card.innerHTML = `
                        <p class="result-title">${res.title || 'Untitled'}</p>
                        <a href="${res.url}" class="result-url" target="_blank">${res.url}</a>
                        <p class="result-desc">${res.description || ''}</p>
                        <div style="margin-bottom: 6px;">${tagsHtml}</div>
                        <div class="result-meta">
                            <span>${res.category || ''}</span>
                            <span>Score: ${res.similarity.toFixed(2)}</span>
                        </div>
                    `;
                    searchResults.appendChild(card);
                });
            } else if (response.ok) {
                showStatus(searchStatus, "No results found. Try lowering threshold.", "error");
            } else {
                showStatus(searchStatus, `Error: ${data.detail}`, "error");
            }
        } catch (error) {
            showStatus(searchStatus, `Error: ${error.message}`, "error");
        } finally {
            btnSearch.disabled = false;
        }
    });

    // --- Manage Tab Handler ---
    async function fetchManageBookmarks() {
        const limit = manageLimit.value || 10;
        const search = manageSearch.value.trim();
        const [sortBy, order] = manageSort.value.split(":");

        manageResults.innerHTML = "";
        showStatus(manageStatus, "Loading bookmarks...", "loading");

        try {
            let url = `${API_BASE_URL}/bookmarks?limit=${limit}&sort_by=${sortBy}&order=${order}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;

            const response = await fetch(url);
            const data = await response.json();

            if (response.ok && data.data.length > 0) {
                showStatus(manageStatus, `Showing ${data.data.length} bookmarks.`, "success");
                data.data.forEach(b => {
                    const card = document.createElement("div");
                    card.className = "result-card";
                    const tagsHtml = (b.tags || []).map(t => `<span class="tag">${t}</span>`).join("");

                    card.innerHTML = `
                        <button class="delete-btn" data-id="${b.id}">✕</button>
                        <p class="result-title">${b.title || 'Untitled'}</p>
                        <a href="${b.url}" class="result-url" target="_blank">${b.url}</a>
                        <p class="result-desc">${b.description || ''}</p>
                        <div style="margin-bottom: 6px;">${tagsHtml}</div>
                        <div class="result-meta">
                            <span>${b.category || 'Uncategorized'}</span>
                        </div>
                    `;

                    card.querySelector(".delete-btn").addEventListener("click", async (e) => {
                        const id = e.target.getAttribute("data-id");
                        if (confirm("Delete this bookmark?")) {
                            await fetch(`${API_BASE_URL}/bookmark/${id}`, { method: "DELETE" });
                            card.remove();
                            // If we deleted the current active page bookmark, update save tab
                            if (id === activeBookmarkId) {
                                initSaveTab();
                            }
                        }
                    });

                    manageResults.appendChild(card);
                });
            } else if (response.ok) {
                showStatus(manageStatus, "No bookmarks found.", "error");
            } else {
                showStatus(manageStatus, `Error: ${data.detail}`, "error");
            }
        } catch (error) {
            showStatus(manageStatus, `Error: ${error.message}`, "error");
        }
    }

    manageSearch?.addEventListener("input", debounce(fetchManageBookmarks, 300));
    manageLimit?.addEventListener("change", fetchManageBookmarks);
    manageSort?.addEventListener("change", fetchManageBookmarks);

    function debounce(func, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function showStatus(element, message, type) {
        if (!element) return;
        element.textContent = message;
        element.className = `status-message ${type}`;
    }

    // Run tab initialization on load
    initSaveTab();
});
