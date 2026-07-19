import os
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from openai import OpenAI
import json

# Initialize FastAPI
app = FastAPI(title="Semantic Bookmark Manager API")

# Initialize OpenAI
# Assumes OPENAI_API_KEY is set in your environment
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

# --- Helper Functions ---

def scrape_website_text(url: str) -> str:
    """Fetches the URL and extracts the main text using BeautifulSoup."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Remove script and style elements
        for script_or_style in soup(["script", "style", "nav", "footer"]):
            script_or_style.decompose()
            
        text = soup.get_text(separator=' ', strip=True)
        # Limit text to roughly 2000 words to save tokens and focus on main content
        return text[:10000]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to scrape URL: {str(e)}")

def generate_metadata_with_ai(text: str) -> BookmarkMetadata:
    """Uses GPT-4o-mini to extract structured metadata from the scraped text."""
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
            model="openrouter/free",
            response_format={ "type": "json_object" },
            messages=[
                {"role": "system", "content": "You are a helpful assistant designed to output strict JSON."},
                {"role": "user", "content": prompt.format(text=text)}
            ]
        )
        
        # Parse the JSON string returned by the model
        result_json = json.loads(response.choices[0].message.content)
        return BookmarkMetadata(**result_json)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Metadata Generation failed: {str(e)}")

def generate_embedding(text: str) -> list[float]:
    """Generates a 2048-dimensional vector embedding for the given text."""
    try:
        response = client.embeddings.create(
            model="nvidia/nemotron-3-embed-1b:free",
            input=text
        )
        return response.data[0].embedding
    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Embedding Generation failed: {str(e)}")


# --- Main Endpoints ---

@app.post("/bookmark")
def add_bookmark(request: BookmarkRequest):
    """
    The main ingestion endpoint.
    1. Scrapes URL
    2. Generates Metadata
    3. Generates Embeddings
    4. Saves to Supabase
    """
    
    # 1. Scrape the URL
    print(f"Scraping: {request.url}...")
    page_text = scrape_website_text(request.url)
    
    # 2. Get Metadata via AI
    print("Generating AI Metadata...")
    metadata = generate_metadata_with_ai(page_text)
    
    # 3. Create Vector Embedding
    print("Generating Vector Embedding...")
    # We embed the description and tags combined, as that holds the best semantic meaning
    text_to_embed = f"{metadata.description} " + " ".join(metadata.tags)
    embedding_vector = generate_embedding(text_to_embed)
    
    # 4. Save to Database
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
        # Insert into the 'bookmarks' table
        result = supabase.table("bookmarks").insert(data_to_insert).execute()
        return {"status": "success", "data": result.data[0]}
    except Exception as e:
        # Catch duplicate URL errors or other DB issues
        raise HTTPException(status_code=500, detail=f"Database insertion failed: {str(e)}")

# Run the server with: uvicorn main:app --reload
