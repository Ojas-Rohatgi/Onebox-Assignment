# View ReachInbox README

# **ReachInbox Backend Assignment**

This project is a feature-rich, AI-powered email aggregator built for the ReachInbox Associate Backend Engineer assignment. It implements a full-stack solution with a Node.js backend, a Python AI microservice, and a React frontend.

## **Architecture Overview**

The system is composed of four main services that run concurrently:

**Node.js Backend (index.ts):** The central hub. It serves a REST API (for the frontend), manages real-time IMAP connections for multiple email accounts, and coordinates with the other services.

**Elasticsearch (docker-compose.yml):** The primary database. All emails are indexed here in real-time, making them instantly searchable.

**Python AI Service (ai_server.py):** A separate microservice that handles all heavy AI tasks. It exposes endpoints for email categorization and RAG-based reply generation, utilizing local Hugging Face models and a FAISS vector database.

**React Frontend (reachinbox-ui/):** A simple, single-page application that provides a UI to search, filter, read, and get AI-suggested replies for emails.

## **Implemented Features** 

 **1. Real-Time Email Synchronization:** Connects to multiple IMAP accounts specified in .env. Fetches the last 30 days of emails and uses persistent IDLE connections with an auto-reconnect and keep-alive (NOOP) mechanism for true real-time updates without polling.

 **2. Searchable Storage (Elasticsearch):** All emails are parsed and indexed into a local Elasticsearch container. The API supports full-text search and filtering by accountId.

 **3. AI-Based Email Categorization:** Emails are routed to the Python AI service (/categorize) and classified using a local facebook/bart-large-mnli zero-shot model.

 **4. Slack & Webhook Integration:** When an email is categorized as "Interested," the backend automatically sends a rich notification to a Slack channel and triggers an external webhook.

 **5. Frontend Interface:** A responsive React UI allows users to see all emails, perform full-text search, filter by account, view email categories, and read emails in a sandboxed iframe.

 **6. AI-Powered Suggested Replies:** The Python service builds a FAISS vector database from context.txt. The frontend's "Suggest Reply" button triggers a RAG pipeline that retrieves relevant context and uses a google/flan-t5-large LLM to generate a context-aware reply.

## **Setup & Running the Project**

You will need 4 separate terminals to run the complete application.

### **Prerequisites**

Node.js (v18+)

Python (3.10+) & pip

Docker & Docker Compose

**1. Backend & AI Setup (Terminal 1 & 2)**
```
# Clone the repository
git clone [your-repo-url]
cd ReachInbox

# 1. Install Node.js dependencies
npm install

# 2. Install Python dependencies
# (Create a virtual environment)
python3 -m venv ai_venv
source ai_venv/bin/activate
# (Install from requirements.txt, which you should create)
pip install fastapi uvicorn torch transformers sentence-transformers faiss-gpu numpy

# 3. Create your .env file
# (Copy dummy.env and fill in your details)
cp dummy.env .env
nano .env

# 4. Compile the TypeScript backend
npx tsc
```

**2. Run All Services**

**Terminal 1: Start Elasticsearch**
```
docker-compose up
```

(Wait for it to be ready)

**Terminal 2: Start the AI Service**
```
# Make sure your virtual environment is active
source ai_venv/bin/activate
uvicorn ai_server:app --host 0.0.0.0 --port 8000
```

_(Wait for all models to load)_

**Terminal 3: Start the Backend API & IMAP Sync**
```
# Run the compiled code
node dist/index.js
```

_(You should see it connect to Elasticsearch and your IMAP accounts)_

**Terminal 4: Start the Frontend**
```
# Navigate to the UI folder
cd ../reachinbox-ui

# Install dependencies
npm install

# Run the dev server
npm run dev
```

Open http://localhost:5173 in your browser.
