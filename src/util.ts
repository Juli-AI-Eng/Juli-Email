// Utility functions for the Nylas MCP server

import TurndownService from 'turndown';
import sanitizeHtml from 'sanitize-html';
// Configure a single Turndown service instance for email bodies
const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full'
});

/**
 * Converts HTML to Markdown suitable for LLM consumption.
 * @param html Raw HTML string
 * @returns Clean Markdown string
 */
export function htmlToMarkdown(html: string): string {
    // Remove comments, styles, scripts, meta, head, and any <img> tags (often trackers)
    const cleaned = sanitizeHtml(html, {
        allowedTags: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'p', 'a', 'ul', 'ol', 'li',
            'b', 'strong', 'i', 'em', 'code', 'pre', 'br'
        ],
        allowedAttributes: {
            a: ['href', 'title', 'name', 'target']
        },
        allowComments: false,
        // Drop empty <a> produced by tracking pixels
        exclusiveFilter: frame => frame.tag === 'a' && !frame.text.trim()
    });
    return turndownService.turndown(cleaned);
}

export function encodeNative(q: string) {
    return encodeURIComponent(q.trim());
}


/**
 * Validates an email address format using a basic regex pattern
 * @param email The email address to validate
 * @returns boolean indicating if the email format is valid
 */
export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Formats a date object or timestamp into a human-readable string
 * @param date Date object or Unix timestamp (in seconds)
 * @returns Formatted date string
 */
export function formatDate(date: Date | number): string {
    if (typeof date === 'number') {
        // Convert Unix timestamp (seconds) to milliseconds
        date = new Date(date * 1000);
    }
    return date.toLocaleString();
}

/**
 * Truncates a string to a specified length and adds ellipsis if needed
 * @param str String to truncate
 * @param maxLength Maximum length before truncation
 * @returns Truncated string with ellipsis if needed
 */
export function truncateString(str: string, maxLength: number = 100): string {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

// Removed htmlToText function - rely on SDK for plain text body

/**
 * Safely parses JSON with error handling
 * @param jsonString JSON string to parse
 * @param defaultValue Default value to return if parsing fails
 * @returns Parsed object or default value
 */
export function safeJsonParse(jsonString: string, defaultValue: any = {}): any {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        return defaultValue;
    }
}

/**
 * Sleeps for the specified number of milliseconds
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retry attempts
 * @param baseDelay Base delay in milliseconds
 * @returns Promise resolving to the function result
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 300
): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Add check for non-retryable errors (e.g., 4xx client errors except 429)
            // NylasApiError might have a statusCode property
            const statusCode = (error as any)?.statusCode;
            if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                console.warn(`Attempt ${attempt + 1}: Received non-retryable status code ${statusCode}. Aborting retries.`);
                throw lastError; // Don't retry client errors (except rate limits)
            }

            if (attempt === maxRetries - 1) {
                console.warn(`Attempt ${attempt + 1} failed. Max retries reached.`);
                break; // Exit loop after last attempt fails
            }

            const delay = baseDelay * Math.pow(2, attempt);
            const jitter = delay * 0.2 * (Math.random() - 0.5); // Add +/- 10% jitter
            const waitTime = Math.max(0, Math.round(delay + jitter));

            console.warn(`Attempt ${attempt + 1} failed. Retrying in ${waitTime}ms... Error: ${lastError.message}`);
            await sleep(waitTime);
        }
    }

    throw lastError;
}

export function escapeXml(text: string | null | undefined): string {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function messageToXml(msg: any): string {
    const id = escapeXml(msg.id);
    const subject = escapeXml(msg.subject);
    const fromObj = msg.from?.[0] ?? {};
    const sender = escapeXml(
        fromObj.name ? `${fromObj.name} &lt;${fromObj.email}&gt;` : fromObj.email ?? ""
    );
    const date = msg.date ? new Date(msg.date * 1000).toUTCString() : "";
    const snippet = escapeXml(msg.snippet);

    return [
        `<email id="${id}">`,
        `  <subject>${subject}</subject>`,
        `  <sender>${sender}</sender>`,
        `  <date>${date}</date>`,
        `  <snippet>${snippet}</snippet>`,
        `</email>`
    ].join("\n");
}