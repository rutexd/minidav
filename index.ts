/**
 * @fileoverview MiniDAV - Embeddable WebDAV server for Express applications
 * @version 2.0.0
 * @license MIT
 * 
 * A lightweight WebDAV server that can be embedded in Express applications
 * with virtual filesystem support and Windows Explorer compatibility.
 */

// Core exports for library usage
export { createWebDAVServer } from './src/server/embeddable.js';
export { MemoryFileSystem } from './src/filesystem/memory-fs.js';
export type { VirtualFileSystem, VirtualFile } from './src/filesystem/types.js';
export type { WebDAVConfig, TimeoutConfig } from './src/config/types.js';
export { defaultConfig, configPresets } from './src/config/types.js';

