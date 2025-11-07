import { IncomingWebhook } from '@slack/webhook';
import axios from 'axios';
import { EmailDocument } from './elasticsearch.service';

/**
 * Handles sending outbound notifications to Slack and other webhooks.
 */
class NotificationService {
  private slackWebhook: IncomingWebhook | undefined;
  private webhookSiteUrl: string | undefined;

  constructor() {
    // Load URLs from environment variables
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      this.slackWebhook = new IncomingWebhook(slackUrl);
    } else {
      console.warn('[Slack] SLACK_WEBHOOK_URL not set. Slack notifications disabled.');
    }

    this.webhookSiteUrl = process.env.WEBHOOK_SITE_URL;
    if (!this.webhookSiteUrl) {
      console.warn('[Webhook] WEBHOOK_SITE_URL not set. External webhooks disabled.');
    }
  }

  /**
   * Checks if an email is 'Interested' and sends notifications if it is.
   */
  public async sendInterestNotification(email: EmailDocument): Promise<void> {
    if (email.aiCategory !== 'Interested') {
      return; // Only send for 'Interested' emails
    }

    console.log(`[Notification] 'Interested' email detected: "${email.subject}"`);

    // 1. Send to Slack
    if (this.slackWebhook) {
      try {
        await this.slackWebhook.send({
          text: `New 'Interested' Lead!`,
          attachments: [
            {
              color: '#36a64f',
              fields: [
                {
                  title: 'From',
                  value: email.from || 'Unknown',
                  short: true,
                },
                {
                  title: 'Subject',
                  value: email.subject || 'No Subject',
                  short: true,
                },
              ],
            },
          ],
        });
        console.log('[Slack] Notification sent.');
      } catch (error) {
        console.error('[Slack] Error sending notification:', error);
      }
    }

    // 2. Send to external webhook (e.g., webhook.site)
    if (this.webhookSiteUrl) {
      try {
        await axios.post(this.webhookSiteUrl, email);
        console.log('[Webhook] Webhook.site triggered.');
      } catch (error: any) {
        console.error('[Webhook] Error triggering webhook.site:', error.message);
      }
    }
  }
}

export const notificationService = new NotificationService();