from fastapi import FastAPI
from pydantic import BaseModel
from transformers import pipeline
import torch
import os
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

app = FastAPI(title="AI Email Assistant", version="2.0")

# ============================================================
# --- CONFIGURATION ---
# ============================================================
CONFIDENCE_THRESHOLD = 0.3
HYPOTHESIS_TEMPLATE = "This email is about {}."
CATEGORIES = [
    'interest',
    'a meeting being booked',
    'a lack of interest',
    'spam',
    'an out of office reply',
    'something general'
]
LABEL_MAP = {
    'interest': 'Interested',
    'a meeting being booked': 'Meeting Booked',
    'a lack of interest': 'Not Interested',
    'spam': 'Spam',
    'an out of office reply': 'Out of Office',
    'something general': 'General'
}
CONTEXT_FILE = "context.txt"
TOP_K = 3  # Retrieve top 3 most relevant contexts

device_to_use = 0 if torch.cuda.is_available() else -1
device_name = "CUDA" if device_to_use == 0 else "CPU"

# ============================================================
# --- MODEL LOADING (On Startup) ---
# ============================================================

print(f"Loading models on {device_name}...")

# 1. Categorization Model (Zero-Shot)
classifier = pipeline(
    "zero-shot-classification",
    model="facebook/bart-large-mnli",
    device=device_to_use
)
print("Categorization model loaded.")

# 2. Embedding Model (for RAG Retrieval)
embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L12-v2", device=device_to_use)
print("Embedding model loaded.")

# 3. Generator Model (for RAG Generation)
generator = pipeline("text2text-generation", model="google/flan-t5-large", device=device_to_use)
print("Text generation model loaded.")
print("AI service is ready.")

# ============================================================
# --- CONTEXT INGESTION (On Startup) ---
# ============================================================

context_data = []
vector_db = None

if not os.path.exists(CONTEXT_FILE):
    print(f"Warning: '{CONTEXT_FILE}' not found. RAG will run without context.")
else:
    with open(CONTEXT_FILE, "r") as f:
        context_data = [line.strip() for line in f if line.strip()]

    if context_data:
        print(f"Embedding {len(context_data)} context snippets...")
        # Create vector embeddings
        context_embeddings = embedder.encode(context_data, convert_to_numpy=True)
        d = context_embeddings.shape[1]  # Get vector dimension
        # Build a FAISS (vector database) index
        vector_db = faiss.IndexFlatL2(d)
        vector_db.add(context_embeddings.astype(np.float32))
        print("Vector DB created in memory.")
    else:
        print("Context file empty. No RAG grounding available.")


# ============================================================
# --- DATA MODELS ---
# ============================================================

class EmailInput(BaseModel):
    subject: str
    body: str


class ReplyInput(BaseModel):
    body: str
    category: str | None = None  # optional hint from node.js


# ============================================================
# --- API ENDPOINTS ---
# ============================================================

@app.post("/categorize")
def categorize_email(email: EmailInput):
    """
    Categorizes an email into one of the predefined labels.
    """
    text_to_classify = f"{email.subject} {email.body[:1000]}"
    result = classifier(text_to_classify, CATEGORIES, hypothesis_template=HYPOTHESIS_TEMPLATE)

    top_label_raw = result["labels"][0]
    score = result["scores"][0]

    # Default to 'General' if confidence is below the threshold
    final_category = LABEL_MAP.get(top_label_raw, "General") if score >= CONFIDENCE_THRESHOLD else "General"
    print(f"[Categorizer] '{email.subject}' → {final_category} (Score: {score:.2f})")

    return {"category": final_category, "confidence": round(score, 3)}


@app.post("/suggest-reply")
def suggest_reply(email: ReplyInput):
    """
    Generates a reply suggestion using a RAG pipeline.
    """
    if vector_db is None or not context_data:
        print("RAG not initialized (missing context).")
        return {"reply": "Error: Vector DB not initialized. Check 'context.txt'."}

    email_text = email.body[:2000]

    # 1. RETRIEVE: Convert email to vector and search DB
    email_embedding = embedder.encode([email_text], convert_to_numpy=True).astype(np.float32)
    D, I = vector_db.search(email_embedding, TOP_K)  # Find top 3 contexts
    retrieved_contexts = [context_data[idx] for idx in I[0] if idx < len(context_data)]

    # 2. AUGMENT: Construct a rule-based prompt
    prompt = f"""
        **Task:** Write a professional reply to the email.

        **Rules:**
        1.  Read the **Context** to find specific information (like links, names, skills).
        2.  Read the **Email** to understand exactly what the sender wants.
        3.  Your reply **must use the information from the Context** to answer the Email.
        4.  If the Email is asking for a meeting, and the Context has a link, **you must include the link.**
        5.  If the Email is not relevant to the Context (e.g., it's a newsletter or spam), just write the words: "No suggestion."
        6.  The reply should be polite, professional, and ready to send.

        **Context:**
        {retrieved_contexts}

        **Email:**
        {email.body}

        **Reply:**
        """

    # 3. GENERATE: Pass the prompt to the LLM
    reply = generator(prompt.strip(), max_length=180, num_return_sequences=1)[0]["generated_text"].strip()
    print(f"[RAG] Retrieved {len(retrieved_contexts)} contexts.")
    print(f"[RAG] Reply generated: {reply}")

    if "no suggestion" in reply.lower():
        reply = "No suggestion available for this email."

    return {"reply": reply}