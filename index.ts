export { createWebDAVServer } from './src/server/embeddable.js';
export { MemoryFileSystem } from './src/filesystem/memory-fs.js';
export type { VirtualFileSystem, VirtualFile } from './src/filesystem/types.js';
export type { WebDAVConfig, TimeoutConfig } from './src/config/types.js';
export { defaultConfig, configPresets } from './src/config/types.js';