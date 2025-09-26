import { v4 as uuidv4 } from 'uuid';
import type { WebDAVLock } from './types.js';

export class LockManager {
  private locks: Map<string, WebDAVLock> = new Map();
  private pathLocks: Map<string, Set<string>> = new Map(); // path -> set of lock tokens
  private cleanupInterval: NodeJS.Timeout;

  constructor(private defaultTimeout: number = 3600) { // 1 hour default
    // Cleanup expired locks every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks();
    }, 60000);
  }

  generateLockToken(): string {
    return uuidv4();
  }

  createLock(
    path: string,
    owner: string,
    scope: 'exclusive' | 'shared' = 'exclusive',
    depth: 'infinity' | '0' = 'infinity',
    timeout?: number
  ): WebDAVLock {
    const normalizedPath = this.normalizePath(path);
    
    // Check if path can be locked
    if (!this.canLock(normalizedPath, scope)) {
      throw new Error('Resource is already locked');
    }

    const lock: WebDAVLock = {
      token: this.generateLockToken(),
      path: normalizedPath,
      owner,
      timeout: timeout || this.defaultTimeout,
      created: new Date(),
      depth,
      type: 'write',
      scope
    };

    this.locks.set(lock.token, lock);
    
    if (!this.pathLocks.has(normalizedPath)) {
      this.pathLocks.set(normalizedPath, new Set());
    }
    this.pathLocks.get(normalizedPath)!.add(lock.token);

    return lock;
  }

  refreshLock(token: string, timeout?: number): WebDAVLock {
    const lock = this.locks.get(token);
    if (!lock) {
      throw new Error('Lock not found');
    }

    if (this.isExpired(lock)) {
      this.removeLock(token);
      throw new Error('Lock has expired');
    }

    // Update timeout
    lock.timeout = timeout || this.defaultTimeout;
    lock.created = new Date();

    return lock;
  }

  removeLock(token: string): boolean {
    const lock = this.locks.get(token);
    if (!lock) {
      return false;
    }

    this.locks.delete(token);
    
    const pathLockSet = this.pathLocks.get(lock.path);
    if (pathLockSet) {
      pathLockSet.delete(token);
      if (pathLockSet.size === 0) {
        this.pathLocks.delete(lock.path);
      }
    }

    return true;
  }

  getLock(token: string): WebDAVLock | undefined {
    const lock = this.locks.get(token);
    if (lock && this.isExpired(lock)) {
      this.removeLock(token);
      return undefined;
    }
    return lock;
  }

  getLocksForPath(path: string): WebDAVLock[] {
    const normalizedPath = this.normalizePath(path);
    const lockTokens = this.pathLocks.get(normalizedPath);
    
    if (!lockTokens) {
      return [];
    }

    const locks: WebDAVLock[] = [];
    for (const token of lockTokens) {
      const lock = this.getLock(token);
      if (lock) {
        locks.push(lock);
      }
    }

    return locks;
  }

  isLocked(path: string, excludeToken?: string): boolean {
    const normalizedPath = this.normalizePath(path);
    const locks = this.getLocksForPath(normalizedPath);
    
    // Check direct locks
    const directLocks = locks.filter(lock => 
      lock.path === normalizedPath && 
      (!excludeToken || lock.token !== excludeToken)
    );
    
    if (directLocks.length > 0) {
      return true;
    }

    // Check parent locks with depth infinity
    const pathParts = normalizedPath.split('/').filter(part => part.length > 0);
    
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const parentPath = '/' + pathParts.slice(0, i).join('/');
      const parentLocks = this.getLocksForPath(parentPath).filter(lock => 
        lock.depth === 'infinity' && 
        (!excludeToken || lock.token !== excludeToken)
      );
      
      if (parentLocks.length > 0) {
        return true;
      }
    }

    return false;
  }

  canLock(path: string, scope: 'exclusive' | 'shared'): boolean {
    const normalizedPath = this.normalizePath(path);
    
    if (scope === 'exclusive') {
      // Cannot create exclusive lock if any locks exist
      return !this.isLocked(normalizedPath);
    } else {
      // Can create shared lock if no exclusive locks exist
      const locks = this.getLocksForPath(normalizedPath);
      const exclusiveLocks = locks.filter(lock => lock.scope === 'exclusive');
      return exclusiveLocks.length === 0;
    }
  }

  hasValidLockToken(path: string, token: string): boolean {
    const lock = this.getLock(token);
    if (!lock) {
      return false;
    }

    const normalizedPath = this.normalizePath(path);
    
    // Check if token applies to this path
    if (lock.path === normalizedPath) {
      return true;
    }

    // Check if it's a parent lock with depth infinity
    if (lock.depth === 'infinity' && normalizedPath.startsWith(lock.path)) {
      return true;
    }

    return false;
  }

  private normalizePath(path: string): string {
    let normalized = path;
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    // Remove trailing slash except for root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  private isExpired(lock: WebDAVLock): boolean {
    const now = new Date();
    const expiryTime = new Date(lock.created.getTime() + lock.timeout * 1000);
    return now > expiryTime;
  }

  private cleanupExpiredLocks(): void {
    const expiredTokens: string[] = [];
    
    for (const [token, lock] of this.locks) {
      if (this.isExpired(lock)) {
        expiredTokens.push(token);
      }
    }

    for (const token of expiredTokens) {
      this.removeLock(token);
    }
  }

  /**
   * Remove all locks for a specific path (used when resource is deleted)
   */
  removeLocksForPath(path: string): void {
    const normalizedPath = this.normalizePath(path);
    const pathLockSet = this.pathLocks.get(normalizedPath);
    
    if (pathLockSet) {
      // Remove all locks for this path
      for (const token of pathLockSet) {
        this.locks.delete(token);
      }
      this.pathLocks.delete(normalizedPath);
    }
  }

  /**
   * Move locks from one path to another (used when resource is moved)
   */
  moveLocksForPath(fromPath: string, toPath: string): void {
    const normalizedFromPath = this.normalizePath(fromPath);
    const normalizedToPath = this.normalizePath(toPath);
    const pathLockSet = this.pathLocks.get(normalizedFromPath);
    
    if (pathLockSet) {
      // Update lock paths
      for (const token of pathLockSet) {
        const lock = this.locks.get(token);
        if (lock) {
          lock.path = normalizedToPath;
        }
      }
      
      // Move the path locks mapping
      this.pathLocks.set(normalizedToPath, pathLockSet);
      this.pathLocks.delete(normalizedFromPath);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.locks.clear();
    this.pathLocks.clear();
  }
}