#!/usr/bin/env node
// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

// Redirect console.log and console.info to stderr
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'; // Import request schemas
import { z } from "zod";
import { zodToJsonSchema } from 'zod-to-json-schema'; // Import schema generator
import Nylas from 'nylas'; // Import Nylas SDK
import { validateEmail, retryWithBackoff, htmlToMarkdown } from "./util.js";
import { NylasApiError } from 'nylas'; // Import NylasApiError for retry logic
// Import renamed functions from folderManager
import { createFolder, updateFolder, deleteFolder, listFolders, getOrCreateFolder, findTrashFolderId, findArchiveFolderId } from "./folderManager.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { messageToXml, escapeXml, encodeNative } from "./util.js";
// --- Authentication Setup (Kept as is, but added GRANT_ID) ---
const NYLAS_TOKEN = process.env.NYLAS_ACCESS_TOKEN; // Used as apiKey for SDK
const NYLAS_GRANT_ID = process.env.NYLAS_GRANT_ID; // Required for identifying user account

if (!NYLAS_TOKEN) {
    console.error("Error: Nylas access token is not set. Please set NYLAS_ACCESS_TOKEN.");
    process.exit(1);
}
if (!NYLAS_GRANT_ID) {
    console.error("Error: Nylas grant ID is not set. Please set NYLAS_GRANT_ID.");
    process.exit(1);
}

// --- Initialize Nylas SDK ---
const nylasInstance = new Nylas({
    apiKey: NYLAS_TOKEN,
});
const grantId = NYLAS_GRANT_ID; // Use the grant ID globally for handlers

// --- Define Zod Schemas with Descriptions and "Folder" Naming ---

const EmailAddressSchema = z.string().email().describe("A valid email address.");


const FilterEmailsSchema = z.object({
    folderName: z.string().optional().describe('Exact name of the folder to restrict to, case-insensitive ("Inbox", "Trash", "Sent", …). If omitted every folder is searched.'),
    unread: z.boolean().optional().describe("Set to true to return only unread messages."),
    starred: z.boolean().optional().describe("Set to true to return only starred messages."),

    receivedAfter: z.string().datetime({ offset: true }).optional().describe("Return only messages received after this timestamp. \n ISO 8601 format. Example: 2025-04-01T00:00:00Z"),
    receivedBefore: z.string().datetime({ offset: true }).optional().describe("Return only messages received before this timestamp. \n ISO 8601 format. Example: 2025-04-01T00:00:00Z"),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return per page. 1-100, default 25."),
    pageToken: z.string().optional().describe("Token returned by the previous call for pagination.")
})
    .describe(
        `Filter messages in a single logical AND clause.

• Use *only* the keys provided in the schema.  
• The filter is **AND‑ed** across all supplied keys; "OR" logic is not supported here.  
• For OR / NOT / advanced date math, call **search_emails_native** instead.

Examples
---------
✓ Get unread inbox mail:
  { "folderName": "Inbox", "unread": true, "limit": 20 }

✓ All starred messages across every folder, newest first:
  { "starred": true, "limit": 50 }

Pagination
-----------
If the response includes "NEXT_PAGE_TOKEN: …", pass that value back in
"pageToken" to fetch the next page.`
    );

const SendEmailSchema = z.object({
    to: z.array(EmailAddressSchema).min(1).describe("List of primary recipient email addresses."),
    subject: z.string().describe("The subject line of the email."),
    body: z.string().describe("The plain text body content of the email."),
    cc: z.array(EmailAddressSchema).optional().describe("List of CC recipient email addresses."),
    bcc: z.array(EmailAddressSchema).optional().describe("List of BCC recipient email addresses."),
    // threadId: z.string().optional().describe("Optional: ID of the thread to reply to."), // Nylas SDK uses reply_to_message_id
    inReplyTo: z.string().optional().describe("Optional: Message ID this email is a reply to."),
}).describe("Composes and sends a new email immediately.");

const DraftEmailSchema = z.object({
    to: z.array(EmailAddressSchema).min(1).describe("List of primary recipient email addresses."),
    subject: z.string().describe("The subject line of the email."),
    body: z.string().describe("The plain text body content of the email."),
    cc: z.array(EmailAddressSchema).optional().describe("List of CC recipient email addresses."),
    bcc: z.array(EmailAddressSchema).optional().describe("List of BCC recipient email addresses."),
    inReplyTo: z.string().optional().describe("Optional: Message ID this draft is a reply to."),
}).describe("Creates a new email draft without sending it.");

const ReadEmailsSchema = z.object({
    messageIds: z.array(z.string()).min(1).describe("The unique identifiers of the email messages to read.")
}).describe("Retrieves the full content and metadata of specific emails by their IDs.");

const SearchEmailsSchema = z.object({
    query: z.string().describe("Single word query to search for."),
    maxResults: z.number().int().positive().optional().default(25).describe("Maximum number of results to return per page."),
    pageToken: z.string().nullable().optional().describe("Token returned by the previous call for pagination.")
}).describe(`Search emails. IMPORTANT: ONLY SINGLE WORD QUERIES ARE ALLOWED. just basic text search. Use pagetoken to paginate.`);

// Renamed labelIds -> folderIds
const ListFoldersSchema = z.object({}).describe("Retrieves all available email folders (previously called labels).");

// Renamed CreateLabelSchema -> CreateFolderSchema
const CreateFolderSchema = z.object({
    name: z.string().describe("The desired name for the new folder."),
    // Nylas v3 folder creation doesn't seem to support visibility options directly
}).describe("Creates a new email folder.");

// Renamed UpdateLabelSchema -> UpdateFolderSchema
const UpdateFolderSchema = z.object({
    id: z.string().describe("The ID of the folder to update."),
    name: z.string().optional().describe("The new name for the folder."),
    // Visibility options removed as they are not standard in v3 folder PUT
}).describe("Updates an existing folder's name.");

// Renamed DeleteLabelSchema -> DeleteFolderSchema
const DeleteFolderSchema = z.object({
    id: z.string().describe("The ID of the folder to delete. Cannot delete system folders.")
}).describe("Deletes a user-created email folder.");

// Renamed GetOrCreateLabelSchema -> GetOrCreateFolderSchema
const GetOrCreateFolderSchema = z.object({
    name: z.string().describe("The name of the folder to find or create if it doesn't exist.")
}).describe("Finds a folder by name, or creates a new one if no match is found.");

const ListEmailsForTriageSchema = z.object({
    unreadOnly: z.boolean().optional(),
    starredOnly: z.boolean().optional(),
    olderThan: z.string().datetime({ offset: true }).optional(),   // ISO 8601
    limit: z.number().int().positive().max(100).default(50),
    pageToken: z.string().optional()
}).describe("Pages through the inbox for triage.");


// ── Unified batch‑triage action ─────────────────────────────
const BatchTriageEmailsSchema = z.object({
    messageIds: z.array(z.string()).min(1).describe("IDs of the messages to update (≤50 per call)."),
    // flag toggles
    setUnread: z.boolean().optional().describe("true→ mark unread, false→ mark read"),
    setStarred: z.boolean().optional().describe("true→ star, false→ un-star"),
    // folder operations
    moveToFolderId: z.string().optional().describe("Move each message to exactly this folder, replacing all others."),
    addFolderIds: z.array(z.string()).optional().describe("Add these folders (ignored if moveToFolderId present)."),
    removeFolderIds: z.array(z.string()).optional().describe("Remove these folders (ignored if moveToFolderId present).")
}).describe("Batch triage update: flags + folder moves in one call.");

const BatchArchiveEmailsSchema = z.object({
    messageIds: z.array(z.string()).min(1).max(50)
}).describe("Moves messages to the Archive folder (Gmail) or equivalent.");



// --- Initialize the MCP server with updated name ---
const server = new McpServer({ name: "nylas-email", version: "1.1.0" }); // Updated name
const lowLevelServer = server.server;

// Register server capabilities
lowLevelServer.registerCapabilities({
    tools: {
        list: true,
        call: true
    }
});

// --- Tool Registration using setRequestHandler ---

function registerToolHandlers(server: Server, nylas: Nylas, grantId: string) {

    // Cache for Trash Folder ID to avoid repeated lookups
    let trashFolderIdCache: string | null = null;
    async function getTrashFolderId(): Promise<string> {
        if (trashFolderIdCache === null) {
            trashFolderIdCache = await findTrashFolderId(nylas, grantId);
        }
        if (!trashFolderIdCache) {
            throw new Error("Trash folder could not be found for this account.");
        }
        return trashFolderIdCache;
    }

    // Cache for Archive Folder ID to avoid repeated lookups
    let archiveFolderIdCache: string | null = null;
    async function getArchiveFolderId(): Promise<string> {
        if (archiveFolderIdCache === null) {
            archiveFolderIdCache = await findArchiveFolderId(nylas, grantId);
        }
        if (!archiveFolderIdCache) {
            throw new Error("Archive folder could not be found for this account.");
        }
        return archiveFolderIdCache;
    }

    // build a name→ID map once per server boot
    const folderNameToIdPromise = (async () => {
        const list = await nylas.folders.list({ identifier: grantId });
        const map: Record<string, string> = {};
        list.data.forEach(f => { map[(f.name || "").toLowerCase()] = f.id; });
        return map;
    })();

    async function getFolderIdByName(name: string): Promise<string> {
        const map = await folderNameToIdPromise;
        let id = map[name.toLowerCase()]; // Use 'let' to allow reassignment
        if (id) return id; // Return if found in initial cache

        // Cache miss → refresh once by fetching the list again
        console.log(`Folder cache miss for "${name}", refreshing...`);
        const freshList = await nylas.folders.list({ identifier: grantId });
        // Clear the existing map and repopulate (safer than merging)
        Object.keys(map).forEach(key => delete map[key]);
        freshList.data.forEach(f => { map[(f.name || "").toLowerCase()] = f.id; });

        // Check the refreshed map
        id = map[name.toLowerCase()];
        if (!id) throw new Error(`Unknown folder "${name}" even after refresh.`);
        return id;
    }


    // 1. Define the list of tools for ListTools RPC
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            { name: "send_email", description: SendEmailSchema.description, inputSchema: zodToJsonSchema(SendEmailSchema) },
            { name: "draft_email", description: DraftEmailSchema.description, inputSchema: zodToJsonSchema(DraftEmailSchema) },
            { name: "read_emails", description: ReadEmailsSchema.description, inputSchema: zodToJsonSchema(ReadEmailsSchema) },
            { name: "search_emails", description: SearchEmailsSchema.description, inputSchema: zodToJsonSchema(SearchEmailsSchema) },
            // Renamed tools
            { name: "list_folders", description: ListFoldersSchema.description, inputSchema: zodToJsonSchema(ListFoldersSchema) },
            { name: "create_folder", description: CreateFolderSchema.description, inputSchema: zodToJsonSchema(CreateFolderSchema) },
            { name: "update_folder", description: UpdateFolderSchema.description, inputSchema: zodToJsonSchema(UpdateFolderSchema) },
            { name: "delete_folder", description: DeleteFolderSchema.description, inputSchema: zodToJsonSchema(DeleteFolderSchema) },
            { name: "get_or_create_folder", description: GetOrCreateFolderSchema.description, inputSchema: zodToJsonSchema(GetOrCreateFolderSchema) },
            { name: "triage_update_emails", description: BatchTriageEmailsSchema.description, inputSchema: zodToJsonSchema(BatchTriageEmailsSchema) },
            { name: "batch_archive_emails", description: BatchArchiveEmailsSchema.description, inputSchema: zodToJsonSchema(BatchArchiveEmailsSchema) },
            {
                name: "filter_emails",
                description: FilterEmailsSchema.description,
                inputSchema: zodToJsonSchema(FilterEmailsSchema)
            },
        ]
    }));

    // 2. Handle actual tool calls via CallTool RPC
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name: toolName, arguments: args } = req.params;

        try {
            // Wrap the core logic call in retryWithBackoff
            const result = await retryWithBackoff(async () => {
                switch (toolName) {
                    // --- Email Tools ---
                    case "send_email": {
                        const params = SendEmailSchema.parse(args);
                        params.to.forEach(email => {
                            if (!validateEmail(email)) throw new Error(`Invalid recipient: ${email}`);
                        });
                        const requestBody: any = {
                            to: params.to.map(email => ({ email })),
                            subject: params.subject,
                            body: params.body,
                        };
                        if (params.cc) requestBody.cc = params.cc.map(email => ({ email }));
                        if (params.bcc) requestBody.bcc = params.bcc.map(email => ({ email }));
                        if (params.inReplyTo) requestBody.reply_to_message_id = params.inReplyTo;

                        // Use drafts.create then drafts.send
                        const draft = await nylas.drafts.create({
                            identifier: grantId,
                            requestBody
                        });
                        if (!draft.data.id) throw new Error("Failed to create draft before sending.");

                        const sendResult = await nylas.drafts.send({
                            identifier: grantId,
                            draftId: draft.data.id
                        });
                        // The send operation might return the sent message details or just confirmation
                        const sentId = sendResult.data?.id || draft.data.id; // Use draft ID if send result has no ID
                        return { content: [{ type: "text", text: `Email sent successfully with ID: ${sentId}` }] };
                    }

                    case "draft_email": {
                        const params = DraftEmailSchema.parse(args);
                        params.to.forEach(email => {
                            if (!validateEmail(email)) throw new Error(`Invalid recipient: ${email}`);
                        });
                        const requestBody: any = {
                            to: params.to.map(email => ({ email })),
                            subject: params.subject,
                            body: params.body,
                        };
                        if (params.cc) requestBody.cc = params.cc.map(email => ({ email }));
                        if (params.bcc) requestBody.bcc = params.bcc.map(email => ({ email }));
                        if (params.inReplyTo) requestBody.reply_to_message_id = params.inReplyTo;

                        const draft = await nylas.drafts.create({
                            identifier: grantId,
                            requestBody
                        });
                        const draftId = draft.data.id || "(unknown)";
                        return { content: [{ type: "text", text: `Email draft created successfully with ID: ${draftId}` }] };
                    }

                    case "read_emails": {
                        const params = ReadEmailsSchema.parse(args);

                        const emailsXml: string[] = [];

                        for (const id of params.messageIds) {
                            const msgResult = await nylas.messages.find({
                                identifier: grantId,
                                messageId: id
                            });
                            const msg = msgResult.data;
                            if (!msg) continue;  // skip silently if not found

                            const subject = escapeXml(msg.subject || "");
                            const from = escapeXml(
                                msg.from?.[0]
                                    ? (msg.from[0].name
                                        ? `${msg.from[0].name} <${msg.from[0].email}>`
                                        : msg.from[0].email)
                                    : ""
                            );
                            const dateStr = msg.date ? new Date(msg.date * 1000).toUTCString() : "";
                            const snippet = escapeXml(msg.snippet || "");

                            const rawBody = msg.body || "";
                            const bodyDisplay =
                                rawBody && /<[^>]+>/.test(rawBody)
                                    ? htmlToMarkdown(rawBody)
                                    : rawBody;
                            const bodyEsc = escapeXml(bodyDisplay);

                            emailsXml.push(
                                `<email id="${escapeXml(msg.id)}">
  <subject>${subject}</subject>
  <sender>${from}</sender>
  <date>${dateStr}</date>
  <snippet>${snippet}</snippet>
  <body>
${bodyEsc}
  </body>
</email>`
                            );
                        }

                        return {
                            content: [{
                                type: "text",
                                text: emailsXml.join("\n\n")
                            }]
                        };
                    }

                    case "filter_emails": {
                        const p = FilterEmailsSchema.parse(args);

                        // Validate pageToken format
                        if (p.pageToken && !/^[\\w\\-]+=?=?$/.test(p.pageToken)) {
                            throw new Error('Invalid pageToken format. Should be alphanumeric with optional dashes/underscores and trailing equals signs.');
                        }

                        // Build only the keys that are *present*
                        const qp: Record<string, any> = { limit: p.limit };
                        if (p.pageToken) qp.page_token = p.pageToken;        // add conditionally

                        // Folder → ID map is cached once per process
                        if (p.folderName) {
                            const id = await getFolderIdByName(p.folderName);  // helper shown below
                            qp.in = id;
                        }
                        if (p.unread !== undefined) qp.unread = p.unread;
                        if (p.starred !== undefined) qp.starred = p.starred;
                        if (p.receivedAfter) qp.received_after = Date.parse(p.receivedAfter) / 1000;
                        if (p.receivedBefore) qp.received_before = Date.parse(p.receivedBefore) / 1000;

                        const resp = await nylas.messages.list({
                            identifier: grantId,
                            queryParams: qp
                        });

                        const xml = resp.data.map(messageToXml).join("\n\n");
                        const next = (resp as any).nextCursor ?? "";
                        return {
                            content: [
                                { type: "text", text: xml },
                                { type: "text", text: `NEXT_PAGE_TOKEN: ${next}` }
                            ]
                        };
                    }

                    case "search_emails": {
                        const { query, maxResults, pageToken } =
                            SearchEmailsSchema.parse(args);

                        // Validate query: Reject 'in:' or 'is:' searches as per description
                        const trimmedQuery = query.trim();
                        if (/\b(in|is):\S+/i.test(trimmedQuery)) {
                            throw new Error("Search query cannot contain 'in:' or 'is:' filters. Please use 'filter_emails' or specific triage tools for folder/status filtering.");
                        }

                        const qp: Record<string, any> = {
                            limit: maxResults,
                            search_query_native: trimmedQuery
                        };
                        if (pageToken) qp.page_token = pageToken;   // only extra param allowed

                        const resp = await nylas.messages.list({
                            identifier: grantId,
                            queryParams: qp
                        });

                        const xml = resp.data.map(messageToXml).join("\n\n");
                        const next = (resp as any).nextCursor ?? "";
                        return {
                            content: [
                                { type: "text", text: xml },
                                { type: "text", text: `NEXT_PAGE_TOKEN: ${next}` }
                            ]
                        };
                    }



                    case "list_emails_for_triage": {
                        const p = ListEmailsForTriageSchema.parse(args);

                        // Build query params carefully, only including defined values
                        const query: Record<string, any> = {
                            limit: p.limit,
                            fields: "snippet,unread,starred,folders", // Ensure fields are always requested
                        };
                        // Conditionally add optional parameters
                        if (p.pageToken) query.page_token = p.pageToken;
                        if (p.unreadOnly !== undefined) query.unread = p.unreadOnly;
                        if (p.starredOnly !== undefined) query.starred = p.starredOnly;
                        if (p.olderThan) query.received_before = Date.parse(p.olderThan) / 1000;

                        const resp = await nylas.messages.list({ identifier: grantId, queryParams: query });

                        // Convert to XML blocks (reuse escapeXml + messageToXml, but add flags)
                        const xml = resp.data.map(m => {
                            // flags: replace folder name with first-folder-ID (optional)
                            const folderFlag = m.folders?.[0] ? `folder_id:${m.folders[0]}` : "";

                            const flags = [
                                m.unread ? "unread" : null,
                                m.starred ? "starred" : null,
                                folderFlag
                            ].filter(Boolean).join(" ");

                            return (
                                `<email id="${escapeXml(m.id)}" flags="${flags}">
  <subject>${escapeXml(m.subject)}</subject>
  <sender>${escapeXml(m.from?.[0]?.email || "")}</sender>
  <date>${new Date(m.date * 1000).toUTCString()}</date>
  <snippet>${escapeXml(m.snippet)}</snippet>
</email>`
                            );
                        }).join("\n\n");

                        // Fix for the pagination footer
                        const nextToken = (resp as any).nextCursor ?? "";

                        return {
                            content: [
                                { type: "text", text: xml },
                                { type: "text", text: `NEXT_PAGE_TOKEN: ${nextToken}` }
                            ]
                        };
                    }

                    case "triage_update_emails": {
                        const p = BatchTriageEmailsSchema.parse(args);
                        const ids = p.messageIds;
                        const batchSize = 8; // Set batch size to 8
                        const minJitterMs = 25; // Minimum delay for initial stagger
                        const maxJitterMs = 75; // Maximum delay for initial stagger
                        const maxRetries = 3;
                        const baseRetryDelayMs = 100; // Base delay for retries
                        const failures: { id: string; err: Error }[] = [];
                        const successes: string[] = [];

                        for (let i = 0; i < ids.length; i += batchSize) {
                            const batchIds = ids.slice(i, i + batchSize);

                            const results = await Promise.allSettled(batchIds.map(async (id, index) => {
                                // Initial jitter delay before first attempt
                                const initialJitterDelay = Math.random() * (maxJitterMs - minJitterMs) + minJitterMs;
                                await new Promise(resolve => setTimeout(resolve, initialJitterDelay));

                                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                                    try {
                                        // --- Start Operation --- Build request body for this ID
                                        const body: any = {};
                                        if (p.setUnread !== undefined) body.unread = p.setUnread;
                                        if (p.setStarred !== undefined) body.starred = p.setStarred;

                                        if (p.moveToFolderId) {
                                            body.folders = [p.moveToFolderId];
                                        } else if (p.addFolderIds || p.removeFolderIds) {
                                            // Fetch individually (wrap in retry logic if needed, though less likely to fail than update)
                                            const msgResult = await nylas.messages.find({ identifier: grantId, messageId: id, queryParams: { fields: 'folders' as any } });
                                            const current: string[] = msgResult.data?.folders ?? [];
                                            const folderSet = new Set(current);
                                            p.addFolderIds?.forEach(fid => folderSet.add(fid));
                                            p.removeFolderIds?.forEach(fid => folderSet.delete(fid));
                                            if (current.length > 0 && folderSet.size === 0) {
                                                throw new Error(`Update for message ${id} would leave it without any folders.`);
                                            }
                                            if (folderSet.size !== current.length || !current.every(fid => folderSet.has(fid))) {
                                                body.folders = Array.from(folderSet);
                                            }
                                        }

                                        if (Object.keys(body).length === 0) {
                                            console.log(`Skipping no-op update for message ${id}`);
                                            return { status: 'fulfilled', value: id }; // Success (no-op)
                                        }

                                        await nylas.messages.update({
                                            identifier: grantId,
                                            messageId: id,
                                            requestBody: body
                                        });
                                        // --- End Operation --- Success
                                        return { status: 'fulfilled', value: id };

                                    } catch (err: any) {
                                        console.warn(`Attempt ${attempt + 1} failed for triage update on ${id}:`, err.message);
                                        const isRetryable = err instanceof NylasApiError && (err.statusCode === 429 || err.statusCode >= 500);

                                        if (isRetryable && attempt < maxRetries) {
                                            const retryDelay = (baseRetryDelayMs * Math.pow(2, attempt)) + (Math.random() * baseRetryDelayMs); // Exponential backoff + jitter
                                            console.log(`Retrying triage update on ${id} in ${retryDelay.toFixed(0)} ms...`);
                                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                                            continue; // Continue to the next attempt
                                        } else {
                                            // Non-retryable error or max retries reached
                                            console.error(`Final failure for triage update on ${id} after ${attempt + 1} attempts.`);
                                            throw err; // Re-throw the error to be caught by Promise.allSettled
                                        }
                                    }
                                } // End retry loop
                                // Should not be reachable if loop finishes normally, but satisfy TS
                                throw new Error(`Triage update loop finished unexpectedly for ${id}`);
                            }));

                            // Process results from the batch
                            results.forEach((result, index) => {
                                const messageId = batchIds[index];
                                if (result.status === 'fulfilled') {
                                    successes.push(messageId);
                                } else {
                                    failures.push({ id: messageId, err: result.reason instanceof Error ? result.reason : new Error(String(result.reason)) });
                                }
                            });
                        }

                        const successCount = successes.length;
                        let text = `Triage update complete. ${successCount}/${ids.length} succeeded.`;
                        if (failures.length > 0) {
                            text += ` Failed: ${failures.length}.\n\nDetails:\n` +
                                failures.map(f => `• ${f.id} → ${f.err.message}`).join("\n");
                        }
                        return { content: [{ type: "text", text }] };
                    }

                    case "batch_archive_emails": {
                        const { messageIds } = BatchArchiveEmailsSchema.parse(args);
                        const archiveId = await getArchiveFolderId();
                        const batchSize = 8; // Set batch size to 8
                        const minJitterMs = 25; // Minimum delay for initial stagger
                        const maxJitterMs = 75; // Maximum delay for initial stagger
                        const maxRetries = 3;
                        const baseRetryDelayMs = 100; // Base delay for retries
                        const failures: { id: string; err: Error }[] = [];
                        const successes: string[] = [];

                        for (let i = 0; i < messageIds.length; i += batchSize) {
                            const batchIds = messageIds.slice(i, i + batchSize);

                            const results = await Promise.allSettled(batchIds.map(async (id, index) => {
                                // Initial jitter delay before first attempt
                                const initialJitterDelay = Math.random() * (maxJitterMs - minJitterMs) + minJitterMs;
                                await new Promise(resolve => setTimeout(resolve, initialJitterDelay));

                                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                                    try {
                                        // --- Start Operation ---
                                        await nylas.messages.update({
                                            identifier: grantId,
                                            messageId: id,
                                            requestBody: { folders: [archiveId] } // Move to archive
                                        });
                                        // --- End Operation --- Success
                                        return { status: 'fulfilled', value: id };

                                    } catch (err: any) {
                                        console.warn(`Attempt ${attempt + 1} failed for archive on ${id}:`, err.message);
                                        const isRetryable = err instanceof NylasApiError && (err.statusCode === 429 || err.statusCode >= 500);

                                        if (isRetryable && attempt < maxRetries) {
                                            const retryDelay = (baseRetryDelayMs * Math.pow(2, attempt)) + (Math.random() * baseRetryDelayMs); // Exponential backoff + jitter
                                            console.log(`Retrying archive on ${id} in ${retryDelay.toFixed(0)} ms...`);
                                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                                            continue; // Continue to the next attempt
                                        } else {
                                            // Non-retryable error or max retries reached
                                            console.error(`Final failure for archive on ${id} after ${attempt + 1} attempts.`);
                                            throw err; // Re-throw the error to be caught by Promise.allSettled
                                        }
                                    }
                                } // End retry loop
                                // Should not be reachable
                                throw new Error(`Archive loop finished unexpectedly for ${id}`);
                            }));

                            // Process results from the batch
                            results.forEach((result, index) => {
                                const messageId = batchIds[index];
                                if (result.status === 'fulfilled') {
                                    successes.push(messageId);
                                } else {
                                    failures.push({ id: messageId, err: result.reason instanceof Error ? result.reason : new Error(String(result.reason)) });
                                }
                            });
                        }

                        const successCount = successes.length;
                        let text = `Archived ${successCount}/${messageIds.length} messages.`;
                        if (failures.length > 0) {
                            text += ` Failed: ${failures.length}.\n\nDetails:\n` +
                                failures.map(f => `• ${f.id} → ${f.err.message}`).join("\n");
                        }
                        return { content: [{ type: "text", text }] };
                    }

                    // --- Folder (Label) Tools ---
                    case "list_folders": {
                        // Args are empty, validated by ListFoldersSchema.parse({})
                        ListFoldersSchema.parse(args);
                        const folderData = await listFolders(nylas, grantId); // Call refactored function
                        const sys = folderData.system, usr = folderData.user;
                        const total = folderData.count.total, sysCount = folderData.count.system, usrCount = folderData.count.user;
                        let text = `Found ${total} folders (${sysCount} system, ${usrCount} user):\n\n`;
                        text += "System Folders:\n" + sys.map(f => `ID: ${f.id}\nName: ${f.name}\nAttributes: ${f.attributes?.join(', ') || 'none'}\n`).join("\n");
                        text += "\nUser Folders:\n" + usr.map(f => `ID: ${f.id}\nName: ${f.name}\n`).join("\n");
                        return { content: [{ type: "text", text }] };
                    }
                    case "create_folder": {
                        const params = CreateFolderSchema.parse(args);
                        const folder = await createFolder(nylas, grantId, params.name); // Call refactored function
                        return { content: [{ type: "text", text: `Folder "${folder.name}" created with ID: ${folder.id}` }] };
                    }
                    case "update_folder": {
                        const params = UpdateFolderSchema.parse(args);
                        const folder = await updateFolder(nylas, grantId, params.id, { name: params.name }); // Call refactored function
                        return { content: [{ type: "text", text: `Folder "${folder.name}" (ID: ${folder.id}) updated successfully.` }] };
                    }
                    case "delete_folder": {
                        const params = DeleteFolderSchema.parse(args);
                        await deleteFolder(nylas, grantId, params.id); // Call refactored function
                        return { content: [{ type: "text", text: `Folder with ID "${params.id}" deleted successfully.` }] };
                    }
                    case "get_or_create_folder": {
                        const params = GetOrCreateFolderSchema.parse(args);
                        const folder = await getOrCreateFolder(nylas, grantId, params.name); // Call refactored function
                        return { content: [{ type: "text", text: `Folder "${folder.name}" (ID: ${folder.id}) is ready.` }] };
                    }

                    // --- Batch Tools ---
                    // Removed case "batch_modify_emails" as it's not registered in ListTools
                    // Removed case "batch_delete_emails" as it's not registered in ListTools

                    default:
                        throw new Error(`Unknown tool: ${toolName}`);
                }
            }, 3); // Max 3 retries with default backoff from util.ts
            return result;

        } catch (error: any) {
            console.error(`Error calling tool ${toolName}:`, error);
            // Check if it's a NylasApiError for more details
            let errorMessage = error.message;
            if (error.constructor?.name === 'NylasApiError') {
                errorMessage = `Nylas API Error (${error.statusCode}): ${error.message} (Type: ${error.type})`;
            } else if (error instanceof z.ZodError) {
                errorMessage = `Input validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
            }
            return { content: [{ type: "text", text: `Error executing ${toolName}: ${errorMessage}` }] };
        }
    });
}


// --- Start the server ---
async function main() {
    // Register handlers, passing the initialized SDK instance and grantId
    registerToolHandlers(lowLevelServer, nylasInstance, grantId);

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error("Server error:", err);
    process.exit(1);
});
