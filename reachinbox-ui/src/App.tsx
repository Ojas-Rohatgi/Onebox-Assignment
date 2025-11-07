import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import DOMPurify from 'dompurify';
import './App.css';

/**
 * Type definition for an Email document, matching the backend.
 */
interface Email {
  id: string;
  accountId: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  htmlBody?: string;
  receivedAt: string;
  aiCategory?: string;
}

// URL for the Node.js backend API
const API_URL = 'http://localhost:3000/api';

/**
 * Main application component.
 * Manages global state for emails and filters.
 */
function App() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  // Effect to fetch emails when search or filter changes
  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const response = await axios.get(`${API_URL}/emails`, {
          params: {
            q: searchQuery,
            accountId: activeAccountId // Pass filters to the API
          },
        });
        setEmails(response.data);
      } catch (error) {
        console.error('Error fetching emails:', error);
      }
    };

    // Debounce the API call to avoid spamming on keypress
    const searchTimeout = setTimeout(() => {
      fetchEmails();
    }, 500);

    return () => clearTimeout(searchTimeout);
  }, [searchQuery, activeAccountId]); // Re-run effect when these change

  // Memoized calculation to get unique account IDs for the filter list
  const accountIds = useMemo(() => {
    const ids = new Set(emails.map(email => email.accountId));
    return Array.from(ids);
  }, [emails]); // Re-run only when emails list changes

  return (
    <div className="App">
      <Sidebar
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        accounts={accountIds}
        activeAccount={activeAccountId}
        onSelectAccount={setActiveAccountId}
      />
      <EmailList
        emails={emails}
        onSelectEmail={setSelectedEmail}
        selectedEmailId={selectedEmail?.id}
      />
      <EmailView email={selectedEmail} />
    </div>
  );
}

// --- Components ---

interface SidebarProps {
  searchQuery: string;
  onSearch: (query: string) => void;
  accounts: string[];
  activeAccount: string | null;
  onSelectAccount: (accountId: string | null) => void;
}

function Sidebar({ searchQuery, onSearch, accounts, activeAccount, onSelectAccount }: SidebarProps) {
  return (
    <aside className="sidebar">
      <h3>My Onebox</h3>
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search emails..."
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <nav className="account-filter">
        <h4>Accounts</h4>
        <ul>
          <li
            className={!activeAccount ? 'selected' : ''}
            onClick={() => onSelectAccount(null)}
          >
            All Accounts
          </li>
          {accounts.map(id => (
            <li
              key={id}
              className={activeAccount === id ? 'selected' : ''}
              onClick={() => onSelectAccount(id)}
            >
              {id}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}


interface EmailListProps {
  emails: Email[];
  onSelectEmail: (email: Email) => void;
  selectedEmailId?: string;
}

function EmailList({ emails, onSelectEmail, selectedEmailId }: EmailListProps) {
  return (
    <section className="email-list">
      {emails.map((email) => (
        <EmailItem
          key={email.id}
          email={email}
          onSelectEmail={onSelectEmail}
          isSelected={email.id === selectedEmailId}
        />
      ))}
    </section>
  );
}


interface EmailItemProps {
  email: Email;
  onSelectEmail: (email: Email) => void;
  isSelected: boolean;
}

function EmailItem({ email, onSelectEmail, isSelected }: EmailItemProps) {
  // Create a CSS-safe class name from the category
  const categoryClass = email.aiCategory?.replace(/\s+/g, '-') || '';

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div
      className={`email-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelectEmail(email)}
    >
      <div className="email-item-header">
        <span className="from">{email.from || 'No Sender'}</span>
        <span className="date">{formatDate(email.receivedAt)}</span>
      </div>
      <div className="subject">{email.subject || 'No Subject'}</div>
      <div className="snippet">{email.body?.substring(0, 100) || ''}...</div>
      {email.aiCategory && (
        <span className={`category-badge ${categoryClass}`}>
          {email.aiCategory}
        </span>
      )}
    </div>
  );
}


interface EmailViewProps {
  email: Email | null;
}

function EmailView({ email }: EmailViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [suggestion, setSuggestion] = useState('');
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);

  // Effect to safely render email HTML in the iframe
  useEffect(() => {
    setSuggestion(''); // Clear old suggestion when email changes

    if (email && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        // Sanitize the HTML to prevent XSS attacks
        const cleanHtml = DOMPurify.sanitize(email.htmlBody || '', {
          WHOLE_DOCUMENT: true, // Allow <html>, <head>, <body>
          ADD_TAGS: ['style'],  // Allow <style> tags
        });
        // Write the clean HTML into the iframe's document
        doc.open();
        doc.write(cleanHtml);
        doc.close();

        // Inject a style to ensure readability on dark mode
        const style = doc.createElement('style');
        style.textContent = `body { background-color: white; color: black; padding: 10px; }`;
        doc.head.appendChild(style);
      }
    }
  }, [email]); // Re-run this effect when the selected email changes

  // Handler for the "Suggest Reply" button
  const handleSuggestReply = async () => {
    if (!email) return;

    setIsLoadingSuggestion(true);
    setSuggestion('');
    try {
      const response = await axios.post(
        `${API_URL}/emails/${email.id}/suggest-reply`
      );
      setSuggestion(response.data.suggestion);
    } catch (error) {
      console.error('Error fetching suggestion:', error);
      setSuggestion('Error: Could not get suggestion.');
    } finally {
      setIsLoadingSuggestion(false);
    }
  };

  if (!email) {
    return (
      <main className="email-view">
        <h2 style={{ color: "var(--text-color-secondary)", fontWeight: 400 }}>
          Select an email to read
        </h2>
      </main>
    );
  }

  return (
    <main className="email-view">
      <div className="email-view-header">
        <h3>{email.subject || 'No Subject'}</h3>
        <strong>From: </strong>
        <span>{email.from || 'No Sender'}</span>
      </div>

      <div className="email-view-controls">
        <button
          onClick={handleSuggestReply}
          disabled={isLoadingSuggestion}
          className="suggest-reply-btn"
        >
          {isLoadingSuggestion ? 'Thinking...' : 'Suggest Reply'}
        </button>
      </div>

      {suggestion && (
        <textarea
          readOnly
          value={suggestion}
          className="suggestion-box"
        />
      )}

      <iframe
        ref={iframeRef}
        title="Email Content"
        className="email-iframe"
        style={{
          // Dynamically adjust height if suggestion box is visible
          height: suggestion ? 'calc(100% - 220px)' : 'calc(100% - 130px)',
        }}
        sandbox="allow-same-origin" // Security sandbox
      />
    </main>
  );
}

export default App;