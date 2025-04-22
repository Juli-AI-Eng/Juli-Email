import Nylas from 'nylas'; // Import Nylas SDK type
import { Folder } from 'nylas/lib/types/models/folders'; // Import Folder type for clarity

// Define the interface based on Nylas SDK's Folder model properties
export interface EmailFolder extends Folder {
    // Add any custom properties or ensure required ones from Folder are present
    // Example: Folder type already includes id, grantId, name, displayName, attributes etc.
}

// Helper function to find the Trash folder ID for a given grant
// Caching is handled in index.ts where this is called
export async function findTrashFolderId(nylas: Nylas, grantId: string): Promise<string | null> {
    try {
        const foldersResponse = await nylas.folders.list({ identifier: grantId });
        const folders = foldersResponse.data || [];
        const trashFolder = folders.find(f => f.attributes?.includes('Trash'));
        return trashFolder?.id || null;
    } catch (error: any) {
        console.error(`Failed to find Trash folder for grant ${grantId}: ${error.message}`);
        return null; // Return null if lookup fails
    }
}

// Helper function to find the Archive folder ID for a given grant
// Caching is handled in index.ts where this is called
export async function findArchiveFolderId(nylas: Nylas, grantId: string): Promise<string | null> {
    try {
        const foldersResponse = await nylas.folders.list({ identifier: grantId });
        const folders = foldersResponse.data || [];

        // 1️⃣ preferred: system attribute === "archive"
        const sysFolder = folders.find(f => (f.attributes ?? []).includes('archive'));
        if (sysFolder) return sysFolder.id;

        // 2️⃣ fallback: name matches /archive/i
        const byName = folders.find(f => /archive/i.test(f.name || ''));
        if (byName) return byName.id;

        return null; // Return null if no archive folder found
    } catch (error: any) {
        console.error(`Failed to find Archive folder for grant ${grantId}: ${error.message}`);
        return null; // Return null if lookup fails
    }
}


export async function createFolder(nylas: Nylas, grantId: string, name: string): Promise<EmailFolder> {
    try {
        const response = await nylas.folders.create({
            identifier: grantId,
            requestBody: { name } // Use name for both fields initially
        });
        return response.data;
    } catch (error: any) {
        // Check for NylasApiError specifically if possible, e.g., for conflict
        if (error.statusCode === 409 || error.message?.includes("already exists")) {
            throw new Error(`Folder "${name}" already exists.`);
        }
        console.error(`Failed to create folder: ${error.message}`, error);
        throw new Error(`Failed to create folder: ${error.message}`);
    }
}

export async function updateFolder(nylas: Nylas, grantId: string, id: string, updates: { name?: string }): Promise<EmailFolder> {
    try {
        // Optional: Fetch first to ensure it exists, though PUT might handle 404
        // await nylas.folders.find({ identifier: grantId, folderId: id });

        const requestBody: { name?: string; displayName?: string } = {};
        if (updates.name) {
            requestBody.name = updates.name;
            requestBody.displayName = updates.name; // Update both for consistency
        }

        if (Object.keys(requestBody).length === 0) {
            // If no updates provided, maybe fetch and return current? Or throw error?
            const current = await nylas.folders.find({ identifier: grantId, folderId: id });
            return current.data;
        }

        const response = await nylas.folders.update({
            identifier: grantId,
            folderId: id,
            requestBody
        });
        return response.data;
    } catch (error: any) {
        if (error.statusCode === 404) {
            throw new Error(`Folder with ID "${id}" not found.`);
        }
        console.error(`Failed to update folder: ${error.message}`, error);
        throw new Error(`Failed to update folder: ${error.message}`);
    }
}

export async function deleteFolder(nylas: Nylas, grantId: string, id: string): Promise<void> {
    try {
        // Fetch folder to check attributes before deleting
        const folderResponse = await nylas.folders.find({ identifier: grantId, folderId: id });
        const folder = folderResponse.data;

        // Check if it's a system folder using attributes (more reliable)
        // System folders often have attributes like \Inbox, \Sent, \Trash, \Important, etc.
        // Or sometimes a specific 'system_folder' attribute/flag depending on provider.
        // A simple check might be if attributes array is non-empty and doesn't just contain user flags.
        const isSystemFolder = folder.attributes && folder.attributes.length > 0 && folder.attributes.some(attr => attr.startsWith('\\')); // Heuristic

        if (isSystemFolder) {
            throw new Error(`Cannot delete system folder "${folder.name}" (ID: ${id}).`);
        }

        await nylas.folders.destroy({ identifier: grantId, folderId: id });
    } catch (error: any) {
        if (error.statusCode === 404) {
            throw new Error(`Folder with ID "${id}" not found.`);
        }
        if (error.message?.includes("Cannot delete system folder")) { // Catch specific error message if thrown above
            throw error;
        }
        console.error(`Failed to delete folder: ${error.message}`, error);
        throw new Error(`Failed to delete folder: ${error.message}`);
    }
}

// Updated to use attributes for system folder detection
export async function listFolders(nylas: Nylas, grantId: string): Promise<{ all: EmailFolder[]; system: EmailFolder[]; user: EmailFolder[]; count: { total: number; system: number; user: number } }> {
    try {
        const response = await nylas.folders.list({ identifier: grantId });
        const folders: EmailFolder[] = response.data || [];

        const systemFolders = folders.filter(f =>
            f.attributes && f.attributes.length > 0 && f.attributes.some(attr => attr.startsWith('\\')) // Heuristic for system folders
        );
        const userFolders = folders.filter(f => !systemFolders.includes(f)); // Assumes non-system are user

        return {
            all: folders,
            system: systemFolders,
            user: userFolders,
            count: {
                total: folders.length,
                system: systemFolders.length,
                user: userFolders.length
            }
        };
    } catch (error: any) {
        console.error(`Failed to list folders: ${error.message}`, error);
        throw new Error(`Failed to list folders: ${error.message}`);
    }
}

export async function getOrCreateFolder(nylas: Nylas, grantId: string, name: string): Promise<EmailFolder> {
    try {
        const folderData = await listFolders(nylas, grantId);
        // Match case-insensitively on name or displayName
        const found = folderData.all.find(folder =>
            folder.name?.toLowerCase() === name.toLowerCase()
        );
        if (found) {
            return found;
        }
        // If not found, create it
        return await createFolder(nylas, grantId, name);
    } catch (error: any) {
        console.error(`Failed to get or create folder: ${error.message}`, error);
        throw new Error(`Failed to get or create folder: ${error.message}`);
    }
}