import axios from 'axios';

/**
 * Defines the possible categories returned by the AI service.
 */
type EmailCategory =
  | 'Interested'
  | 'Meeting Booked'
  | 'Not Interested'
  | 'Spam'
  | 'Out of Office'
  | 'General';

const AI_SERVICE_URL = 'http://localhost:8000';
const fallbackCategory: EmailCategory = 'General';

/**
 * A client for the external Python AI microservice.
 * Handles both categorization and reply suggestion.
 */
class AIService {
  /**
   * Calls the /categorize endpoint.
   */
  async categorizeEmail(subject: string, body: string): Promise<EmailCategory> {
    const safeSubject = subject || 'No Subject';
    const safeBody = body || '';
    try {
      const { data } = await axios.post(`${AI_SERVICE_URL}/categorize`, { subject: safeSubject, body: safeBody }, { timeout: 10000 });
      return data?.category || fallbackCategory;
    } catch (error: any) {
      console.error('[AI Service] Categorization failed:', error.message);
      return fallbackCategory;
    }
  }

  /**
   * Calls the /suggest-reply endpoint.
   */
  async getReplySuggestion(emailBody: string, category?: EmailCategory): Promise<string> {
    try {
      const { data } = await axios.post(`${AI_SERVICE_URL}/suggest-reply`, { body: emailBody, category }, { timeout: 20000 });
      return data?.reply || 'Error: Could not generate suggestion.';
    } catch (error: any) {
      console.error('[AI Service] Reply generation failed:', error.message);
      return 'Error: AI service unreachable.';
    }
  }
}

export const aiService = new AIService();