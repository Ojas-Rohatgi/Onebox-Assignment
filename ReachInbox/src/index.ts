import dotenv from 'dotenv';
dotenv.config(); // Must be the first line to load environment variables

console.log('--- Checking Environment Variables ---');
console.log('Slack URL Loaded:  ', !!process.env.SLACK_WEBHOOK_URL);
console.log('Webhook URL Loaded:', !!process.env.WEBHOOK_SITE_URL);
console.log('------------------------------------');

// Polyfill 'File' for Node.js v18 to prevent Elastic/Undici crash
import { File } from 'node:buffer';
if (typeof (global as any).File === 'undefined') { (global as any).File = File; }

import express from 'express';
import cors from 'cors';

import { ImapService } from './services/imap.service';
import type { IAccountConfig } from './interfaces/account.interface';
import { esService } from './services/elasticsearch.service';
import { Client } from '@elastic/elasticsearch';
import { aiService } from './services/ai.service';

const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing for the React frontend
app.use(express.json()); // Enable JSON body parsing for API requests

const PORT = process.env.PORT || 3000;

/**
 * API Endpoint: GET /api/emails
 * Fetches and searches emails from Elasticsearch.
 *
 * Query Params:
 * - `q`: A full-text search query (searches subject, body, from).
 * - `accountId`: Filters emails by a specific account ID (e.g., "account_1_gmail").
 */
app.get('/api/emails', async (req, res) => {
  try {
    const { q, accountId } = req.query;

    let esQuery: any = {
      match_all: {}, // Default query: get all documents
    };

    const queryFilters: any[] = [];

    // Add full-text search filter
    if (q) {
      queryFilters.push({
        multi_match: {
          query: q as string,
          fields: ['subject', 'body', 'from'],
        },
      });
    }

    // Add account ID filter
    if (accountId) {
      queryFilters.push({
        term: {
          // .keyword ensures we match the exact string, not tokenized text
          'accountId.keyword': accountId as string,
        },
      });
    }

    // If any filters exist, combine them into a 'bool' query
    if (queryFilters.length > 0) {
      esQuery = {
        bool: {
          must: queryFilters,
        },
      };
    }

    // Get the raw Elasticsearch client from our service
    const esClient = (esService as any).client as Client;

    // Execute the search against the 'emails' index
    const result = await esClient.search({
      index: 'emails',
      query: esQuery,
      size: 100, // Return up to 100 results
      sort: [{ receivedAt: 'desc' }], // Sort by newest first
    });

    // Format the response for the frontend
    const emails = result.hits.hits.map((hit: any) => ({
      id: hit._id,
      ...hit._source,
    }));

    res.json(emails);
  } catch (error: any) {
    console.error('[API /api/emails] Error fetching emails:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * API Endpoint: POST /api/emails/:id/suggest-reply
 * Generates an AI-powered reply suggestion for a specific email.
 */
app.post('/api/emails/:id/suggest-reply', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Get the full email from Elasticsearch to get its body
    const esClient = (esService as any).client as Client;
    const emailResult = await esClient.get({
      index: 'emails',
      id: id,
    });

    if (!emailResult._source) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const emailBody = (emailResult._source as any).body || '';
    const emailCategory = (emailResult._source as any).aiCategory;

    // 2. Call the AI service to get a suggestion
    const suggestion = await aiService.getReplySuggestion(emailBody, emailCategory);

    // 3. Send the suggestion back to the frontend
    res.json({ suggestion: suggestion });

  } catch (error: any) {
    console.error('[API /suggest-reply] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Main application startup function.
 * Initializes services and starts the API server.
 */
const startApp = async () => {
  try {
    // 1. Initialize Elasticsearch (check connection, create index)
    await esService.initialize();
  } catch (error) {
    console.error("Failed to initialize Elasticsearch. Exiting.", error);
    process.exit(1);
  }

  // 2. Start IMAP Sync services in the background
  const imapAccountsConfig = process.env.IMAP_ACCOUNTS;
  if (!imapAccountsConfig) {
    console.error("IMAP_ACCOUNTS env not set. IMAP sync disabled.");
  } else {
    try {
      const accounts: IAccountConfig[] = JSON.parse(imapAccountsConfig);
      console.log(`Found ${accounts.length} account(s) to sync.`);
      // Start one ImapService for each account
      accounts.forEach(accountConfig => {
        const imapService = new ImapService(accountConfig);
        imapService.startSync();
      });
    } catch (error) {
      console.error("Failed to parse IMAP_ACCOUNTS.", error);
    }
  }

  // 3. Start the Express API server
  app.listen(PORT, () => {
    console.log(`API Server running at http://localhost:${PORT}`);
  });
};

// Run the application
startApp();