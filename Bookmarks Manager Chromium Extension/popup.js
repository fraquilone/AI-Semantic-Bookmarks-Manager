// --- CONFIGURATION ---
// Replace this with your actual Render URL
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

    // Save UI
    const urlInput = document.getElementById("current-url");
    const btnSave = document.getElementById("btn-save");
    const btnRegen = document.getElementById("btn-regen");
    const saveStatus = document.getElementById("save-status");
    const savePreview = document.getElementById("save-preview");

    // Search UI
    const searchInput = document.getElementById("search-query");
    const thresholdSlider = document.getElementById("threshold-slider");
    const thresholdVal = document.getElementById("threshold-val");
    const btnSearch = document.getElementById("btn-search");
    const searchStatus = document.getElementById("search-status");
    const searchResults = document.getElementById("search-results");

    // Manage UI
    const manageSearch = document.getElementById("manage-search");
    const manageLimit = document.getElementById("manage-limit");
    const manageSort = document.getElementById("manage-sort");
    const manageStatus = document.getElementById("manage-status");
    const manageResults = document.getElementById("manage-results");

    // --- Tab Switching ---
    function switchTab(target) {
        Object.keys(tabs).forEach(key => {
            if (key === target) {
                tabs[key].classList.add("active");
                sections[key].classList.add("active");
            } else {
                tabs[key].classList.remove("active");
                sections[key].classList.remove("active");
            }
        });
        if (target === "manage") fetchManageBookmarks();
    }

    tabs.save.addEventListener("click", () => switchTab("save"));
    tabs.search.addEventListener("click", () => switchTab("search"));
    tabs.manage.addEventListener("click", () => switchTab("manage"));

    // --- Auto-fill Current URL ---
    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) urlInput.value = tab.url;
    } catch (e) {
        urlInput.value = "Unable to get URL";
    }

    // --- Threshold Slider (0.01 precision) ---
    thresholdSlider.addEventListener("input", (e) => {
        thresholdVal.textContent = parseFloat(e.target.value).toFixed(2);
    });

    // --- Save & Regenerate Bookmark ---
    async function processBookmark() {
        const url = urlInput.value;
        if (!url || !url.startsWith("http")) {
            showStatus(saveStatus, "Invalid URL.", "error");
            return;
        }

        btnSave.disabled = true;
        btnRegen.disabled = true;
        savePreview.innerHTML = "";
        showStatus(saveStatus, "Scraping & generating AI metadata...", "loading");

        try {
            const response = await fetch(`${API_BASE_URL}/bookmark`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });

            const data = await response.json();
            
            if (response.ok) {
                showStatus(saveStatus, "Bookmark saved successfully!", "success");
                btnRegen.classList.remove("hidden"); // Show regenerate option
                renderPreview(data.data);
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

    function renderPreview(bookmark) {
        const tagsHtml = (bookmark.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
        savePreview.innerHTML = `
            <div class="result-card">
                <p class="result-title">${bookmark.title || 'Untitled'}</p>
                <a href="${bookmark.url}" class="result-url" target="_blank">${bookmark.url}</a>
                <p class="result-desc">${bookmark.description || ''}</p>
                <div style="margin-bottom: 6px;">${tagsHtml}</div>
                <div class="result-meta">
                    <span>Category: ${bookmark.category || 'N/A'}</span>
                </div>
            </div>
        `;
    }

    // --- Semantic Search ---
    btnSearch.addEventListener("click", async () => {
        const query = searchInput.value.trim();
        const threshold = parseFloat(thresholdSlider.value);
        
        if (!query) {
            showStatus(searchStatus, "Please enter a search term.", "error");
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
                renderSearchResults(data.results);
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

    function renderSearchResults(results) {
        results.forEach(res => {
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
    }

    // --- Manage Bookmarks (View, Filter, Sort, Delete) ---
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
                renderManageList(data.data);
            } else if (response.ok) {
                showStatus(manageStatus, "No bookmarks found.", "error");
            } else {
                showStatus(manageStatus, `Error: ${data.detail}`, "error");
            }
        } catch (error) {
            showStatus(manageStatus, `Error: ${error.message}`, "error");
        }
    }

    // Debounced listeners for filtering/sorting
    manageSearch.addEventListener("input", debounce(fetchManageBookmarks, 300));
    manageLimit.addEventListener("change", fetchManageBookmarks);
    manageSort.addEventListener("change", fetchManageBookmarks);

    function renderManageList(bookmarks) {
        bookmarks.forEach(b => {
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

            // Attach Delete Event Listener
            card.querySelector(".delete-btn").addEventListener("click", async (e) => {
                const id = e.target.getAttribute("data-id");
                if (confirm("Are you sure you want to delete this bookmark?")) {
                    await deleteBookmark(id, card);
                }
            });

            manageResults.appendChild(card);
        });
    }

    async function deleteBookmark(id, cardElement) {
        try {
            const response = await fetch(`${API_BASE_URL}/bookmark/${id}`, { method: "DELETE" });
            if (response.ok) {
                cardElement.remove();
                showStatus(manageStatus, "Bookmark deleted.", "success");
            } else {
                alert("Failed to delete bookmark.");
            }
        } catch (err) {
            alert(`Error deleting: ${err.message}`);
        }
    }

    // Helper: Debounce function for live search input
    function debounce(func, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => func.apply(this, args), delay);
        };
    }

    function showStatus(element, message, type) {
        element.textContent = message;
        element.className = `status-message ${type}`;
    }
});
