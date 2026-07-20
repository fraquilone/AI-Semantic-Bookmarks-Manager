// --- CONFIGURATION ---
// IMPORTANT: Replace this with your actual Render URL
const API_BASE_URL = "https://YOUR-APP-NAME.onrender.com";

document.addEventListener("DOMContentLoaded", async () => {
    // UI Elements
    const tabSave = document.getElementById("tab-save");
    const tabSearch = document.getElementById("tab-search");
    const secSave = document.getElementById("section-save");
    const secSearch = document.getElementById("section-search");
    
    const urlInput = document.getElementById("current-url");
    const btnSave = document.getElementById("btn-save");
    const saveStatus = document.getElementById("save-status");

    const searchInput = document.getElementById("search-query");
    const thresholdSlider = document.getElementById("threshold-slider");
    const thresholdVal = document.getElementById("threshold-val");
    const btnSearch = document.getElementById("btn-search");
    const searchStatus = document.getElementById("search-status");
    const searchResults = document.getElementById("search-results");

    // --- Tab Switching Logic ---
    tabSave.addEventListener("click", () => {
        tabSave.classList.add("active");
        tabSearch.classList.remove("active");
        secSave.classList.add("active");
        secSearch.classList.remove("active");
    });

    tabSearch.addEventListener("click", () => {
        tabSearch.classList.add("active");
        tabSave.classList.remove("active");
        secSearch.classList.add("active");
        secSave.classList.remove("active");
    });

    // --- Auto-fill Current URL ---
    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            urlInput.value = tab.url;
        }
    } catch (e) {
        urlInput.value = "Unable to get URL";
    }

    // --- Threshold Slider Update ---
    thresholdSlider.addEventListener("input", (e) => {
        thresholdVal.textContent = parseFloat(e.target.value).toFixed(1);
    });

    // --- Save Bookmark Logic ---
    btnSave.addEventListener("click", async () => {
        const url = urlInput.value;
        if (!url || !url.startsWith("http")) {
            showStatus(saveStatus, "Invalid URL.", "error");
            return;
        }

        btnSave.disabled = true;
        showStatus(saveStatus, "Scraping & generating AI metadata...", "loading");

        try {
            const response = await fetch(`${API_BASE_URL}/bookmark`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });

            const data = await response.json();
            
            if (response.ok) {
                showStatus(saveStatus, "Successfully bookmarked!", "success");
            } else {
                showStatus(saveStatus, `Error: ${data.detail || 'Unknown error'}`, "error");
            }
        } catch (error) {
            showStatus(saveStatus, `Connection error: ${error.message}`, "error");
        } finally {
            btnSave.disabled = false;
        }
    });

    // --- Search Logic ---
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
            
            if (response.ok) {
                if (data.results && data.results.length > 0) {
                    showStatus(searchStatus, `Found ${data.results.length} matches.`, "success");
                    renderResults(data.results);
                } else {
                    showStatus(searchStatus, "No results found. Try lowering the threshold.", "error");
                }
            } else {
                showStatus(searchStatus, `Error: ${data.detail || 'Unknown error'}`, "error");
            }
        } catch (error) {
            showStatus(searchStatus, `Connection error: ${error.message}`, "error");
        } finally {
            btnSearch.disabled = false;
        }
    });

    // --- Helper Functions ---
    function showStatus(element, message, type) {
        element.textContent = message;
        element.className = `status-message ${type}`;
    }

    function renderResults(results) {
        results.forEach(res => {
            const card = document.createElement("div");
            card.className = "result-card";

            const tagsHtml = (res.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
            
            card.innerHTML = `
                <p class="result-title">${res.title || 'Unknown Title'}</p>
                <a href="${res.url}" class="result-url" target="_blank">${res.url}</a>
                <p class="result-desc">${res.description || 'No description available.'}</p>
                <div style="margin-bottom: 6px;">${tagsHtml}</div>
                <div class="result-meta">
                    <span>${res.category || 'Uncategorized'}</span>
                    <span>Score: ${res.similarity.toFixed(2)}</span>
                </div>
            `;
            searchResults.appendChild(card);
        });
    }
});
