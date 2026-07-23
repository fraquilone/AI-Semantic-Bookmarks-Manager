import os
import json
import requests
import numpy as np
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from openai import OpenAI

# Initialize FastAPI
app = FastAPI(title="Semantic Bookmark Manager API")

# MIDDLEWARE CONFIGURATION
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows requests from any extension or website
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, GET, OPTIONS, etc.
    allow_headers=["*"],
)

# Initialize OpenAI
client = OpenAI(
    base_url="https://openrouter.ai/api/v1"
)

# Initialize Supabase
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
if not url or not key:
    raise ValueError("Missing Supabase URL or Key in environment variables")
supabase: Client = create_client(url, key)

# --- Data Models ---

class BookmarkRequest(BaseModel):
    url: str

class BookmarkMetadata(BaseModel):
    website_name: str
    description: str
    category: str
    tags: list[str]

class SearchRequest(BaseModel):
    query: str
    match_threshold: float = 0.2  # Only return somewhat relevant results
    match_count: int = 5

# --- Helper Functions ---

def scrape_website_text(url: str) -> str:
    """Fetches the URL and extracts the main text using BeautifulSoup."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        for script_or_style in soup(["script", "style", "nav", "footer"]):
            script_or_style.decompose()
            
        text = soup.get_text(separator=' ', strip=True)
        return text[:10000]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to scrape URL: {str(e)}")

def generate_metadata_with_ai(text: str) -> BookmarkMetadata:
    """Uses OpenRouter to extract structured metadata from the scraped text."""
    prompt = """
    Analyze the following webpage text. Provide a JSON response containing:
    - 'website_name': The title or brand name of the site.
    - 'description': A concise, 1-2 sentence description of what this page is about.
    - 'category': A single broad category (e.g., 'Tool', 'Blog', 'Reference', 'Video').
    - 'tags': A list of 3-5 highly relevant tags.

    Webpage Text:
    {text}
    """
    
    try:
        response = client.chat.completions.create(
            model="google/gemma-4-26b-a4b-it:free", 
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": "You are a helpful assistant designed to output strict JSON."},
                {"role": "user", "content": prompt.format(text=text)}
            ]
        )
        
        raw_content = response.choices[0].message.content
        
        # Strip markdown blocks in case the LLM includes them
        clean_content = raw_content.strip()
        if clean_content.startswith("```json"):
            clean_content = clean_content[7:]
        if clean_content.endswith("```"):
            clean_content = clean_content[:-3]
            
        result_json = json.loads(clean_content.strip())
        return BookmarkMetadata(**result_json)
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON formatting.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Metadata Generation failed: {str(e)}")

def generate_embedding(text: str) -> list[float]:
    """Generates a 1536-dimensional vector embedding for the given text."""
    # Failsafe: if the text is empty, the API will reject it
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text for embedding is empty.")

    try:
        response = client.embeddings.create(
            model="nvidia/nemotron-3-embed-1b:free",
            input=text,
            encoding_format="float" # Overrides the SDK's hidden Base64 default
        )
        
        # Validate that data actually exists in the response
        if not hasattr(response, 'data') or len(response.data) == 0:
            raise ValueError(f"OpenRouter returned empty data. Raw response: {response}")

        full_embedding = np.array(response.data[0].embedding)
        
        # Slicing to 1536 (Note: ensure Nemotron actually outputs >= 1536 dims!)
        sliced_embedding = full_embedding[:1536] 

        # L2 Normalize using numpy
        norm = np.linalg.norm(sliced_embedding)
        normalized_embedding = (sliced_embedding / norm) if norm > 0 else sliced_embedding

        return normalized_embedding.tolist()

    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Embedding Generation failed: {str(e)}")


# --- Main Endpoints ---

@app.post("/bookmark")
def add_bookmark(request: BookmarkRequest):
    print(f"Scraping: {request.url}...")
    page_text = scrape_website_text(request.url)
    
    print("Generating AI Metadata...")
    metadata = generate_metadata_with_ai(page_text)
    
    print("Generating Vector Embedding...")
    text_to_embed = f"{metadata.description} " + " ".join(metadata.tags)
    embedding_vector = generate_embedding(text_to_embed)
    
    print("Saving to Supabase...")
    data_to_insert = {
        "url": request.url,
        "title": metadata.website_name,
        "description": metadata.description,
        "category": metadata.category,
        "tags": metadata.tags,
        "embedding": embedding_vector 
    }
    
    try:
        result = supabase.table("bookmarks").upsert(data_to_insert, on_conflict="url").execute()
        return {"status": "success", "data": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database insertion failed: {str(e)}")

@app.post("/search")
def search_bookmarks(request: SearchRequest):
    """
    1. Embeds the user's search query
    2. Calls the Supabase Postgres function to find similar vectors
    """
    print(f"Generating embedding for query: {request.query}")
    
    # Turn the search query into a vector using the exact same model
    query_embedding = generate_embedding(request.query)
    
    print("Searching Supabase...")
    try:
        # Call your Postgres function via RPC
        result = supabase.rpc(
            "match_bookmarks",
            {
                "query_embedding": query_embedding,
                "match_threshold": request.match_threshold,
                "match_count": request.match_count
            }
        ).execute()
        
        return {"status": "success", "results": result.data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database search failed: {str(e)}")


@app.get("/bookmarks")
def get_bookmarks(
    limit: int = 10,
    search: str = None,
    sort_by: str = "created_at",
    order: str = "desc"
):
    """
    Fetches stored bookmarks with limit, sorting, and keyword searching across fields.
    """
    try:
        desc_bool = True if order.lower() == "desc" else False
        
        # Fetch records excluding vectors to save bandwidth
        query = supabase.table("bookmarks") \
            .select("id, url, title, description, category, tags, created_at") \
            .order(sort_by, desc=desc_bool) \
            .limit(limit)
            
        result = query.execute()
        bookmarks = result.data
        
        # Python-side filtering for search query across name, url, category, and tags
        if search:
            s = search.lower()
            filtered = []
            for b in bookmarks:
                title_match = s in (b.get("title") or "").lower()
                url_match = s in (b.get("url") or "").lower()
                cat_match = s in (b.get("category") or "").lower()
                tags_match = any(s in tag.lower() for tag in (b.get("tags") or []))
                
                if title_match or url_match or cat_match or tags_match:
                    filtered.append(b)
            bookmarks = filtered
            
        return {"status": "success", "data": bookmarks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch bookmarks: {str(e)}")


@app.get("/bookmark/check")
def check_bookmark(url: str):
    """Checks if a URL already exists in the Supabase database."""
    try:
        result = supabase.table("bookmarks") \
            .select("id, url, title, description, category, tags, created_at") \
            .eq("url", url) \
            .execute()
            
        if result.data:
            return {"exists": True, "data": result.data[0]}
        return {"exists": False, "data": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Check failed: {str(e)}")


@app.delete("/bookmark/{bookmark_id}")
def delete_bookmark(bookmark_id: str):
    """Deletes a bookmark by its UUID."""
    try:
        supabase.table("bookmarks").delete().eq("id", bookmark_id).execute()
        return {"status": "success", "message": f"Bookmark {bookmark_id} deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")
