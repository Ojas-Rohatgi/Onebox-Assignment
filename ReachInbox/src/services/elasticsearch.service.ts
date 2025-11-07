import { Client } from '@elastic/elasticsearch';
import type { ParsedMail } from 'mailparser';
import { aiService } from './ai.service';
import { notificationService } from './notification.service';

/**
 * Defines the structure of an email document to be stored in Elasticsearch.
 */
export interface EmailDocument {
  accountId: string;
  messageId?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  htmlBody?: string;
  receivedAt: Date;
  aiCategory?: string;
}

/**
 * Manages all interactions with the Elasticsearch database.
 */
class ElasticsearchService {
  // This client is made public to be accessible from the API
  public client: Client;
  private indexName = 'emails';

  constructor() {
    this.client = new Client({
      node: 'http://localhost:9200',
    });
  }

  /**
   * Checks the connection to Elasticsearch and creates the 'emails' index
   * if it does not already exist.
   */
  public async initialize(): Promise<void> {
    try {
      await this.client.ping();
      console.log('[Elasticsearch] Connection successful.');

      const indexExists = await this.client.indices.exists({ index: this.indexName });

      if (!indexExists) {
        console.log(`[Elasticsearch] Index "${this.indexName}" not found. Creating...`);
        await this.createEmailIndex();
      } else {
        console.log(`[Elasticsearch] Index "${this.indexName}" already exists.`);
      }
    } catch (error) {
      console.error('[Elasticsearch] Error initializing client:', error);
      process.exit(1);
    }
  }

  /**
   * Defines and creates the index mapping (schema) for emails.
   */
  private async createEmailIndex(): Promise<void> {
    await this.client.indices.create({
      index: this.indexName,
      mappings: {
        properties: {
          accountId: { type: 'keyword' }, // For filtering
          messageId: { type: 'keyword' },
          from: { type: 'text' },
          to: { type: 'text' },
          subject: { type: 'text' }, // For full-text search
          body: { type: 'text' }, // For full-text search
          htmlBody: { type: 'text', index: false }, // Store, but don't index
          receivedAt: { type: 'date' }, // For sorting
          aiCategory: { type: 'keyword' }, // For filtering
        },
      },
    });
    console.log(`[Elasticsearch] Index "${this.indexName}" created with mapping.`);
  }

  /**
   * The core indexing function.
   * Takes a parsed email, gets its AI category, and saves it to Elasticsearch.
   */
  public async indexEmail(email: ParsedMail, accountId: string): Promise<void> {
    try {
      // Standardize 'to' field (can be array)
      const toText = Array.isArray(email.to)
        ? email.to.map(addr => addr.text).join(', ')
        : email.to?.text;

      const emailBody = email.text || '';
      const emailSubject = email.subject || 'No Subject';

      // 1. Get AI category from the Python service
      const category = await aiService.categorizeEmail(emailSubject, emailBody);

      // 2. Create the document
      const document: EmailDocument = {
        accountId: accountId,
        messageId: email.messageId,
        from: email.from?.text,
        to: toText,
        subject: email.subject,
        body: email.text,
        htmlBody: email.html ? email.html : undefined,
        receivedAt: email.date || new Date(),
        aiCategory: category,
      };

      // 3. Index the document in Elasticsearch
      await this.client.index({
        index: this.indexName,
        id: document.messageId, // Use messageId to prevent duplicates
        document: document,
      });

      console.log(`[Elasticsearch] Indexed email: [${category}] "${document.subject}"`);

      // 4. Trigger notifications (this service will check if it's 'Interested')
      await notificationService.sendInterestNotification(document);

    } catch (error) {
      console.error(`[Elasticsearch] Error indexing email:`, error);
    }
  }
}

export const esService = new ElasticsearchService();