import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');

/**
 * Read JSON data from a file in the data directory.
 * @param {string} relativePath - Path relative to the data directory (e.g., 'ops/members.json')
 * @param {*} defaultValue - Default value to return if file doesn't exist
 * @returns {Promise<*>} Parsed JSON data or default value
 */
export async function readJson(relativePath, defaultValue = null) {
  const filePath = path.join(dataDirectory, relativePath);
  
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, return default value
      return defaultValue;
    }
    // Log other errors for debugging before re-throwing
    console.error(`Failed to read JSON from ${relativePath}:`, error);
    throw error;
  }
}

/**
 * Write JSON data to a file in the data directory.
 * @param {string} relativePath - Path relative to the data directory (e.g., 'ops/members.json')
 * @param {*} data - Data to write (will be JSON.stringify'd)
 * @returns {Promise<void>}
 */
export async function writeJson(relativePath, data) {
  const filePath = path.join(dataDirectory, relativePath);
  const directory = path.dirname(filePath);
  
  // Ensure directory exists
  await fs.mkdir(directory, { recursive: true });
  
  try {
    // Write the file with pretty formatting
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    // Handle serialization errors (e.g., circular references)
    console.error(`Failed to write JSON to ${relativePath}:`, error);
    throw error;
  }
}
