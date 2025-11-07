import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import type { IAccountConfig } from '../interfaces/account.interface';
import { esService } from './elasticsearch.service';

/**
 * Central processing function.
 * This is the handoff point from IMAP fetch to Elasticsearch indexing.
 */
const processEmail = (email: ParsedMail, accountId: string) => {
  console.log(`[${accountId}] Processing new email: "${email.subject}"`);
  // Asynchronously index the email.
  // We don't wait for this, so fetching can continue.
  esService.indexEmail(email, accountId).catch((err: any) => {
    console.error(`[${accountId}] Failed to index email:`, err);
  });
};

/**
 * Manages a persistent, real-time connection to a single IMAP account.
 * Includes auto-reconnect and keep-alive logic.
 */
export class ImapService {
  private imap: Imap;
  private accountConfig: IAccountConfig;
  private keepAliveInterval: NodeJS.Timeout | undefined;

  constructor(config: IAccountConfig) {
    this.accountConfig = config;
    this.imap = new Imap(config);
  }

  /**
   * Starts the initial connection and sets up permanent listeners.
   */
  public startSync(): void {
    this.imap.on('error', (err: Error) => {
      console.error(`[${this.accountConfig.id}] IMAP Error:`, err);
      // Reconnect logic is handled by the 'close' event
    });

    this.imap.on('close', () => {
      console.log(`[${this.accountConfig.id}] Connection closed.`);
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);

      // Auto-reconnect after 10 seconds
      console.log(`[${this.accountConfig.id}] Reconnecting in 10 seconds...`);
      setTimeout(() => {
        console.log(`[${this.accountConfig.id}] Attempting to reconnect...`);
        this.imap.connect();
      }, 10000);
    });

    this.imap.once('ready', () => this.onReady());

    console.log(`[${this.accountConfig.id}] Connecting to IMAP server...`);
    this.imap.connect();
  }

  /**
   * Called when the connection is established and authenticated.
   */
  private onReady(): void {
    console.log(`[${this.accountConfig.id}] Successfully connected!`);
    this.imap.openBox('INBOX', false, (err: Error | null, box: any) => {
      if (err) throw err;
      console.log(`[${this.accountConfig.id}] INBOX opened. Starting initial fetch...`);
      this.fetchInitialEmails();
      this.listenForNewEmails();

      // Start a 5-minute keep-alive timer
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = setInterval(() => {
        if (this.imap.state === 'authenticated') {
          console.log(`[${this.accountConfig.id}] Sending keep-alive NOOP.`);
          // Send NOOP to prevent server-side timeout
          (this.imap as any).noop();
        }
      }, 300000); // 5 minutes
    });
  }

  /**
   * Fetches the last 30 days of emails on startup.
   */
  private fetchInitialEmails(): void {
    const thirtyDaysAgo = new Date();
    // Set to -30 to fetch last 30 days
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 1);

    const searchDate = thirtyDaysAgo.toISOString().split('T')[0];

    this.imap.search([['SINCE', searchDate]], (err: Error | null, uids: number[]) => {
      if (err || uids.length === 0) {
        if(err) console.error(`[${this.accountConfig.id}] Error searching emails:`, err);
        if(!err) console.log(`[${this.accountConfig.id}] No new emails in the last 30 days.`);
        return;
      }

      console.log(`[${this.accountConfig.id}] Found ${uids.length} emails to fetch.`);

      if (this.imap.state !== 'authenticated') {
        console.error(`[${this.accountConfig.id}] Not authenticated. Fetch aborted. Reconnect will handle.`);
        return;
      }

      const f = this.imap.fetch(uids, { bodies: '' });

      f.on('message', (msg: any, seqno: number) => {
        msg.on('body', (stream: any) => {
          simpleParser(stream, (err, parsedMail) => {
            if (err) {
              console.error(`[${this.accountConfig.id}] Error parsing email:`, err);
              return;
            }
            if (parsedMail) {
                processEmail(parsedMail, this.accountConfig.id);
            }
          });
        });
      });

      f.once('error', (err: Error) => {
        console.error(`[${this.accountConfig.id}] Fetch error:`, err);
      });

      f.once('end', () => {
        console.log(`[${this.accountConfig.id}] Finished fetching initial emails.`);
      });
    });
  }

  /**
   * Sets up the 'mail' event listener to process new emails in real-time.
   */
  private listenForNewEmails(): void {
    console.log(`[${this.accountConfig.id}] Entering IDLE mode for real-time updates.`);
    this.imap.on('mail', (numNewMsgs: number) => {
      console.log(`[${this.accountConfig.id}] New mail event! You have ${numNewMsgs} new message(s).`);

      if (this.imap.state !== 'authenticated') {
        console.error(`[${this.accountConfig.id}] Not authenticated. Search aborted. Reconnect will handle.`);
        return;
      }

      // Fetch all unseen emails
      this.imap.search(['UNSEEN'], (err: Error | null, uids: number[]) => {
        if (err || uids.length === 0) {
           if(err) console.error(`[${this.accountConfig.id}] Error searching for unseen emails:`, err);
           return;
        }

        const f = this.imap.fetch(uids, { bodies: '', markSeen: true });
        f.on('message', (msg: any, seqno: number) => {
          msg.on('body', (stream: any) => {
            simpleParser(stream, (err, parsedMail) => {
                if (err) {
                    console.error(`[${this.accountConfig.id}] Error parsing new email:`, err);
                    return;
                }
                if (parsedMail) {
                    processEmail(parsedMail, this.accountConfig.id);
                }
            });
          });
        });

        f.once('error', (err: Error) => {
            console.error(`[${this.accountConfig.id}] New mail fetch error:`, err);
        });

        f.once('end', () => {
            console.log(`[${this.accountConfig.id}] Finished fetching new email(s).`);
        });
      });
    });
  }
}