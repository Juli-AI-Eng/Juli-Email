# Inbox MCP

Turn your inbox into an intelligent, LLM-powered assistant—**instantly**. 

Using simple, conversational language, manage, organize, and clean your email through powerful, batch-friendly tools built on [Nylas v3](https://nylas.com). Works effortlessly with Gmail, Outlook, iCloud, Yahoo, or virtually any IMAP provider you already connect to Apple Mail. (likely including your work email!)

We've put thought into the tool descriptions and parameters to make them easy to use and consistent for different LLMs. The tools return easily parsable XML blocks, letting the LLM focus on the task at hand.

I've tried out the workflows myself and I'm really happy with them. It lets assistants work in batches, being much more efficient than you at parsing and organizing your inbox, and reduces the cognitive load associated with email. 

Nylas includes **5 free connected accounts**, so you can automate your inbox for free. 

---

## ✨ Real-life examples (things you actually say)

| You casually say to your assistant…                                                                                                | …and it effortlessly handles it.                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| *“Can you look through my Important folder and inbox, and let me know what emails I actually need to reply to or take action on?”* | Quickly reviews recent messages, identifies actionable ones, and presents a concise summary for follow-up.         |
| *“Hey, can you check my last 100 emails, find which ones are unimportant, and move them into the Unimportant folder?”*             | Filters through emails, intelligently identifies lower-priority messages, and batches them neatly out of your way. |
| *“Archive everything older than two weeks except for starred messages.”*                                                           | Finds emails, protects starred items, and safely archives in efficient batches.                                    |
| *“Summarize and forward the latest alerts from AWS to my team.”*                                                                   | Retrieves alerts, compiles a concise summary, and immediately shares via email.                                    |

---

## 🎯 Why use this?

- **Inbox Zero, effortlessly:** Automate your inbox management with quick, plain-English instructions.
- **Smart Triage:** Instantly categorize, prioritize, and batch-process large sets of emails.
- **Simplicity:** Super simple onboarding. Native signup--no need to get an OAuth token, setup a proxy, or mess with GCP.


---

## Creating a new Nylas account

Sign up at https://dashboard-v3.nylas.com/register?utm_source=docs&utm_medium=devrel-surfaces&utm_campaign=&utm_content=quickstart .

Get your API key from the dashboard--look at for the `API KEY` label on the sidebar. [api_key_loc.png]

Then, go to `grants` (sidebar), then `add test grant` at the upper right, and connect your email account. [grant_loc.png]

Save both the API key and the grant ID (in the table). 

## 🚀 Get started (literally 1 minute)

```bash
git clone https://github.com/your-handle/nylas-mcp-server.git
cd nylas-mcp-server
cp .env.example .env   # Edit with your Nylas credentials
npm install && npm run build
npm start
```

In your MCP client's `mcp-config.json`:

```jsonc
{
  "mcpServers": {
    "nylas-email": {
      "command": "npm start",
      "workingDirectory": "/absolute/path/nylas-mcp-server",
      "env": {
        "NYLAS_ACCESS_TOKEN": "...",
        "NYLAS_GRANT_ID": "..."
      }
    }
  }
}
```


---

## 🔧 Tools optimized for daily workflow

| Tool                             | What it does in plain English                                                 |
| -------------------------------- | ----------------------------------------------------------------------------- |
| **`filter_emails`**              | Quickly search emails by folder, unread status, dates, and flags.             |
| **`triage_update_emails`**       | Batch-mark emails as read/unread, starred/unstarred, or move between folders. |
| **`batch_archive_emails`**       | Instantly archive groups of emails in safe batches.                           |
| **`search_emails`**              | Rapidly find emails using simple, single-word searches.                       |
| **`read_emails`**                | Fetch complete emails in Markdown-friendly format, ready for summarization.   |
| **`send_email` / `draft_email`** | Compose and send (or draft) emails seamlessly.                                |
| **Folder management**            | (`list_`, `create_`, `update_`, `delete_`, `get_or_create_`)                  |

---

## Roadmap

- Provider Native search improvements (right now, multiple spaces are ignored, can't do non-nylas filtering)
- 

## 👩‍💻 Development-friendly

- TypeScript 5.2, minimal dependencies, clean code
- Robust built-in retries (exponential back-off + jitter)
- Contributions welcome!

---

## 📄 License & Thanks

Licensed under the [MIT License](LICENSE). 

If this makes your inbox less painful, please ⭐️—your star helps others find it too!
