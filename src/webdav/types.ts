export interface WebDAVLock {
  token: string;
  path: string;
  owner: string;
  timeout: number; // seconds from creation
  created: Date;
  depth: 'infinity' | '0';
  type: 'write';
  scope: 'exclusive' | 'shared';
}

export interface WebDAVUser {
  username: string;
  password: string;
}

export interface WebDAVOptions {
  realm?: string;
  users?: WebDAVUser[];
  lockTimeout?: number; // Default lock timeout in seconds
  authentication?: boolean; // Enable/disable authentication entirely, defaults to true when users are provided
  debug?: boolean; // Enable debug logging for Windows Explorer compatibility
}