import { Readable, Writable } from 'stream';

export interface VirtualFile {
  path: string;
  type: 'file' | 'collection';
  size: number;
  etag: string;
  displayName: string;
  lastModified: Date;
  created: Date;
}

export interface VirtualFileSystem {
  // Basic operations
  create(path: string, type: 'file' | 'collection'): Promise<void>;
  delete(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  
  // Directory operations
  getMembers(path: string): Promise<string[]>;
  getType(path: string): Promise<'file' | 'collection' | null>;
  
  // File operations
  getStream(path: string, range?: { start: number; end?: number }): Promise<Readable>;
  setStream(path: string, stream: Readable, range?: { start: number; end?: number; total?: number }): Promise<void>;
  getSize(path: string): Promise<number>;
  
  // Metadata
  getEtag(path: string): Promise<string>;
  getDisplayName(path: string): Promise<string>;
  getLastModified(path: string): Promise<Date>;
  getCreated(path: string): Promise<Date>;
  
  // Properties (can be overridden by user)
  getProperty(path: string, property: string): Promise<any>;
  setProperty(path: string, property: string, value: any): Promise<void>;
  removeProperty(path: string, property: string): Promise<void>;
}