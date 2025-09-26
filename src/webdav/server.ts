import express from 'express';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import path from 'path';
import type { VirtualFileSystem } from '../filesystem/types.js';
import { WebDAVXML } from './xml.js';
import { LockManager } from './lock-manager.js';
import type { WebDAVOptions, WebDAVUser } from './types.js';

export class WebDAVServer {
  private xml: WebDAVXML;
  private lockManager: LockManager;
  private users: Map<string, string> = new Map();
  private realm: string;
  private debug: boolean;

  constructor(
    private filesystem: VirtualFileSystem,
    options: WebDAVOptions = {}
  ) {
    this.xml = new WebDAVXML();
    this.lockManager = new LockManager(options.lockTimeout);
    this.realm = options.realm || 'WebDAV Server';
    this.debug = options.debug || false;

    // Setup users if authentication is enabled
    if (options.authentication !== false && options.users) {
      for (const user of options.users) {
        this.users.set(user.username, user.password);
      }
    }

    // If authentication is explicitly disabled, clear users
    if (options.authentication === false) {
      this.users.clear();
    }
  }

  /**
   * Create Express middleware for WebDAV functionality
   * This middleware handles all WebDAV methods and can be mounted in any Express app
   */
  createMiddleware(): express.RequestHandler[] {
    const middleware: express.RequestHandler[] = [];

    // Debug logging middleware
    middleware.push((req: Request, res: Response, next: express.NextFunction) => {
      if (this.debug) {
        console.log(`\n🔍 [${new Date().toISOString()}] ${req.method} ${req.path}`);
        console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
        if (req.body && req.method !== 'PUT') {
          console.log('📄 Body:', req.body.toString());
        }
      }
      next();
    });

    // Raw body parsing for XML WebDAV requests
    middleware.push(express.raw({ 
      type: ['application/xml', 'text/xml'],
      limit: '10mb'
    }));

    // Basic authentication middleware (if enabled)
    if (this.users.size > 0) {
      middleware.push((req: Request, res: Response, next: express.NextFunction) => {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Basic ')) {
          this.sendAuthChallenge(res);
          return;
        }

        const credentials = Buffer.from(auth.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');

        if (!username || !password) {
          this.sendAuthChallenge(res);
          return;
        }

        const storedPassword = this.users.get(username);
        if (!storedPassword || storedPassword !== password) {
          this.sendAuthChallenge(res);
          return;
        }

        next();
      });
    }

    // Main WebDAV request handler
    middleware.push(async (req: Request, res: Response, next: express.NextFunction) => {
      try {
        switch (req.method) {
          case 'OPTIONS':
            return this.handleOptions(req, res);
          case 'PROPFIND':
            return await this.handlePropFind(req, res);
          case 'PROPPATCH':
            return await this.handlePropPatch(req, res);
          case 'GET':
            return await this.handleGet(req, res);
          case 'PUT':
            return await this.handlePut(req, res);
          case 'DELETE':
            return await this.handleDelete(req, res);
          case 'COPY':
            return await this.handleCopy(req, res);
          case 'MOVE':
            return await this.handleMove(req, res);
          case 'MKCOL':
            return await this.handleMkCol(req, res);
          case 'LOCK':
            return await this.handleLock(req, res);
          case 'UNLOCK':
            return await this.handleUnlock(req, res);
          default:
            res.status(405).end(); // Method Not Allowed
        }
      } catch (error) {
        console.error(`${req.method} error:`, error);
        res.status(500).send(error instanceof Error ? error.message : 'Internal Server Error');
      }
    });

    return middleware;
  }

  private handleOptions(req: Request, res: Response): void {
    if (this.debug) {
      console.log('🔧 OPTIONS: Sending WebDAV capabilities');
    }
    
    res.set({
      'DAV': '1, 2',
      'Allow': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, PROPFIND, PROPPATCH, COPY, MOVE, LOCK, UNLOCK',
      'MS-Author-Via': 'DAV',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Server': 'WebDAV/1.0'
    });
    
    if (this.debug) {
      console.log('✅ OPTIONS: Response sent with DAV: 1, 2');
    }
    
    res.status(200).end();
  }

  private async handlePropFind(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);
    const depth = (req.headers.depth as string) || 'infinity';
    
    if (this.debug) {
      console.log(`📁 PROPFIND: ${path} (depth: ${depth})`);
      console.log(`🔍 User-Agent: ${req.headers['user-agent']}`);
    }
    
    if (!(await this.filesystem.exists(path))) {
      if (this.debug) {
        console.log(`❌ PROPFIND: Path not found: ${path}`);
      }
      res.status(404).end();
      return;
    }

    const body = req.body ? req.body.toString() : '';
    const propfindRequest = body ? this.xml.parsePropFind(body) : { allprop: true };

    if (this.debug) {
      console.log('📋 PROPFIND Request:', propfindRequest);
    }

    const responses = [];
    
    // Add the requested resource
    const response = await this.createPropResponse(path, propfindRequest);
    responses.push(response);

    if (this.debug) {
      console.log(`📄 Added resource: ${path}`);
    }

    // Add children if it's a collection and depth allows
    if (depth !== '0') {
      await this.addChildrenRecursively(path, propfindRequest, responses, depth);
    } else {
      if (this.debug) {
        console.log('🚫 Depth 0: Not including children');
      }
    }

    const xml = this.xml.createMultiStatusResponse(responses);
    
    if (this.debug) {
      console.log('📤 PROPFIND Response XML:', xml);
    }
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.status(207).send(xml);
    
    if (this.debug) {
      console.log('✅ PROPFIND: Response sent (207 Multi-Status)');
    }
  }

  private async handlePropPatch(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);
    
    if (this.debug) {
      console.log(`📝 PROPPATCH: ${path}`);
    }
    
    if (!(await this.filesystem.exists(path))) {
      if (this.debug) {
        console.log(`❌ PROPPATCH: Path not found: ${path}`);
      }
      res.status(404).end();
      return;
    }

    const body = req.body ? req.body.toString() : '';
    if (!body) {
      res.status(400).send('PROPPATCH request body required');
      return;
    }

    try {
      const proppatchRequest = this.xml.parsePropPatch(body);
      
      if (this.debug) {
        console.log('📝 PROPPATCH Request:', proppatchRequest);
      }

      // Handle set operations
      if (proppatchRequest.set && proppatchRequest.set.length > 0) {
        for (const setProp of proppatchRequest.set) {
          for (const [propName, propValue] of Object.entries(setProp)) {
            await this.filesystem.setProperty(path, propName, propValue as string);
          }
        }
      }

      // Handle remove operations
      if (proppatchRequest.remove && proppatchRequest.remove.length > 0) {
        for (const removeProp of proppatchRequest.remove) {
          for (const propName of Object.keys(removeProp)) {
            await this.filesystem.removeProperty(path, propName);
          }
        }
      }

      // Create successful response
      const responses = [{
        href: path,
        propstat: [{
          status: 'HTTP/1.1 200 OK',
          prop: proppatchRequest.set ? proppatchRequest.set[0] : {}
        }]
      }];

      const xml = this.xml.createMultiStatusResponse(responses);
      
      if (this.debug) {
        console.log('📤 PROPPATCH Response XML:', xml);
      }
      
      res.set({
        'Content-Type': 'application/xml; charset=utf-8'
      });
      res.status(207).send(xml);
      
      if (this.debug) {
        console.log('✅ PROPPATCH: Response sent (207 Multi-Status)');
      }
    } catch (error) {
      console.error('PROPPATCH error:', error);
      res.status(400).send(error instanceof Error ? error.message : 'PROPPATCH failed');
    }
  }

  private async handleGet(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);

    if (!(await this.filesystem.exists(path))) {
      res.status(404).end();
      return;
    }

    const type = await this.filesystem.getType(path);
    if (type === 'collection') {
      // Return collection listing as HTML
      const members = await this.filesystem.getMembers(path);
      const html = this.generateDirectoryListing(path, members);
      res.set('Content-Type', 'text/html');
      res.send(html);
      return;
    }

    // Only check WebDAV locks (from LOCK method) - RFC compliant
    if (this.lockManager.hasWebDAVLock(path, 'exclusive')) {
      res.status(423).end(); // Locked
      return;
    }

    // Check for internal streaming conflicts - handle with retry instead of rejection
    if (this.lockManager.hasStreamingConflict(path, 'read')) {
      res.status(503).set('Retry-After', '1').end(); // Service Unavailable, try again
      return;
    }

    // Acquire read stream lock (for internal conflict prevention)
    if (!this.lockManager.acquireStreamLock(path, 'read')) {
      res.status(503).set('Retry-After', '1').end(); // Service Unavailable, try again
      return;
    }

    try {
      // Handle Range requests
      const size = await this.filesystem.getSize(path);
      const etag = await this.filesystem.getEtag(path);
      const rangeHeader = req.headers.range;
      
      if (rangeHeader) {
        // Parse Range header (e.g., "bytes=0-499", "bytes=500-999", "bytes=-500")
        const range = this.parseRangeHeader(rangeHeader, size);
        if (!range) {
          // Invalid range
          res.status(416).set({
            'Content-Range': `bytes */${size}`,
            'Accept-Ranges': 'bytes'
          }).end();
          return;
        }

        const { start, end } = range;
        const contentLength = end - start + 1;
        const stream = await this.filesystem.getStream(path, { start, end });
        
        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': contentLength.toString(),
          'Accept-Ranges': 'bytes',
          'ETag': etag
        });

        // Set up stream completion handler
        res.on('finish', () => {
          this.lockManager.releaseStreamLock(path);
        });
        res.on('close', () => {
          this.lockManager.releaseStreamLock(path);
        });

        stream.pipe(res);
      } else {
        // Full file request
        const stream = await this.filesystem.getStream(path);
        
        res.set({
          'Content-Length': size.toString(),
          'ETag': etag,
          'Accept-Ranges': 'bytes'
        });

        // Set up stream completion handler
        res.on('finish', () => {
          this.lockManager.releaseStreamLock(path);
        });
        res.on('close', () => {
          this.lockManager.releaseStreamLock(path);
        });

        stream.pipe(res);
      }
    } catch (error) {
      // Release lock on error
      this.lockManager.releaseStreamLock(path);
      throw error;
    }
  }

  private async handlePut(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);
    const lockToken = this.extractLockToken(req);
    
    // Check WebDAV locks first (RFC compliant)
    if (this.lockManager.hasWebDAVLock(path)) {
      if (!lockToken || !this.lockManager.hasValidLockToken(path, lockToken)) {
        res.status(423).end(); // Locked
        return;
      }
    }
    
    // Check for internal streaming conflicts - handle with retry
    if (this.lockManager.hasStreamingConflict(path, 'write')) {
      res.status(503).set('Retry-After', '1').end(); // Service Unavailable, try again
      return;
    }
    
    // Acquire stream lock for writing (for internal conflict prevention)
    if (!this.lockManager.acquireStreamLock(path, 'write', lockToken || undefined)) {
      res.status(503).set('Retry-After', '1').end(); // Service Unavailable, try again
      return;
    }

    const exists = await this.filesystem.exists(path);
    
    // Parse Content-Range header for partial uploads
    const contentRange = req.headers['content-range'] as string;
    let range: { start: number; end?: number; total?: number } | undefined;
    
    if (contentRange) {
      const parsedRange = this.parseContentRange(contentRange);
      if (!parsedRange) {
        res.status(416).set('Accept-Ranges', 'bytes').end(); // Range Not Satisfiable
        this.lockManager.releaseStreamLock(path);
        return;
      }
      range = parsedRange;
    }
    
    // Handle stream - if body was parsed by middleware, create stream from buffer
    let stream: Readable;
    if ((req as any).body && Buffer.isBuffer((req as any).body)) {
      // Body was parsed by Express middleware - create a proper readable stream
      const buffer = (req as any).body as Buffer;
      stream = new Readable({
        read() {
          this.push(buffer);
          this.push(null); // End the stream
        }
      });
    } else {
      // Body is still in the request stream
      stream = req as unknown as Readable;
    }
    
    try {
      // If file doesn't exist and no range is specified, create it first
      // This helps file systems that expect files to exist before setStream
      if (!exists && !range) {
        try {
          await this.filesystem.create(path, 'file');
        } catch (error) {
          // Ignore creation errors - some file systems handle creation in setStream
          if (this.debug) {
            console.log(`⚠️ File creation failed, proceeding with setStream: ${error}`);
          }
        }
      }
      
      await this.filesystem.setStream(path, stream, range);
      
      if (this.debug && range) {
        console.log(`📤 Range upload completed: ${range.start}-${range.end}/${range.total}`);
      }

      const etag = await this.filesystem.getEtag(path);
      res.set('ETag', etag);
      res.status(exists ? 204 : 201).end();
    } finally {
      // Always release the stream lock
      this.lockManager.releaseStreamLock(path);
    }
  }

  private async handleDelete(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);

    if (!(await this.filesystem.exists(path))) {
      res.status(404).end();
      return;
    }

    if(path == "/"){
        res.status(403).end(); // cannot delete root
            return;
    }

    // Check if resource is locked
    if (this.lockManager.isLocked(path)) {
      const lockToken = this.extractLockToken(req);
      if (!lockToken || !this.lockManager.hasValidLockToken(path, lockToken)) {
        res.status(423).end(); // Locked
        return;
      }
    }

    await this.filesystem.delete(path);
    
    // Clean up any locks on the deleted resource
    this.lockManager.removeLocksForPath(path);
    
    res.status(204).end();
  }

  private async handleCopy(req: Request, res: Response): Promise<void> {
    const sourcePath = this.normalizePath(req.path);
    const destination = req.headers.destination as string;
    
    if (!destination) {
      res.status(400).send('Destination header required');
      return;
    }

    let destPath: string;
    try {
      destPath = this.normalizePath(new URL(destination).pathname);
    } catch (error) {
      res.status(400).send('Invalid destination URL');
      return;
    }

    if (!(await this.filesystem.exists(sourcePath))) {
      res.status(404).end();
      return;
    }

    const exists = await this.filesystem.exists(destPath);
    const overwrite = req.headers.overwrite !== 'F';

    if (exists && !overwrite) {
      res.status(412).end(); // Precondition Failed
      return;
    }

    await this.filesystem.copy(sourcePath, destPath);
    res.status(exists ? 204 : 201).end();
  }

  private async handleMove(req: Request, res: Response): Promise<void> {
    const sourcePath = this.normalizePath(req.path);
    const destination = req.headers.destination as string;
    
    if (!destination) {
      res.status(400).send('Destination header required');
      return;
    }

    let destPath: string;
    try {
      destPath = this.normalizePath(new URL(destination).pathname);
    } catch (error) {
      res.status(400).send('Invalid destination URL');
      return;
    }

    if (!(await this.filesystem.exists(sourcePath))) {
      res.status(404).end();
      return;
    }

    // Check if source is locked
    if (this.lockManager.isLocked(sourcePath)) {
      const lockToken = this.extractLockToken(req);
      if (!lockToken || !this.lockManager.hasValidLockToken(sourcePath, lockToken)) {
        res.status(423).end(); // Locked
        return;
      }
    }

    const exists = await this.filesystem.exists(destPath);
    const overwrite = req.headers.overwrite !== 'F';

    if (exists && !overwrite) {
      res.status(412).end(); // Precondition Failed
      return;
    }

    await this.filesystem.move(sourcePath, destPath);
    
    // Move any locks from source to destination
    this.lockManager.moveLocksForPath(sourcePath, destPath);
    
    res.status(exists ? 204 : 201).end();
  }

  private async handleMkCol(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);

    if (await this.filesystem.exists(path)) {
      res.status(405).end(); // Method Not Allowed
      return;
    }

    await this.filesystem.create(path, 'collection');
    res.status(201).end();
  }

  private async handleLock(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);
    const depth = req.headers.depth as string || 'infinity';
    const timeout = this.parseTimeout(req.headers.timeout as string);

    if (!(await this.filesystem.exists(path))) {
      res.status(404).end();
      return;
    }

    const body = req.body ? req.body.toString() : '';
    if (this.debug) {
      console.log('LOCK request body:', body);
    }
    if (!body) {
      res.status(400).send('Lock request body required');
      return;
    }

    const lockRequest = this.xml.parseLockRequest(body);
    
    try {
      const lock = this.lockManager.createLock(
        path,
        lockRequest.owner,
        lockRequest.scope,
        depth as 'infinity' | '0',
        timeout
      );

      const lockDiscovery = this.xml.createLockDiscoveryResponse([lock]);
      const lockResponse = {
        'd:lockdiscovery': lockDiscovery['d:lockdiscovery']
      };

      const xml = this.xml.build({
        'd:prop': lockResponse,
        '@_xmlns:d': 'DAV:'
      });

      res.set({
        'Content-Type': 'application/xml; charset=utf-8',
        'Lock-Token': `<opaquelocktoken:${lock.token}>`
      });
      res.status(200).send(xml);
    } catch (error) {
      console.error('LOCK error:', error);
      res.status(500).send(error instanceof Error ? error.message : 'Internal server error');
    }
  }

  private async handleUnlock(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.path);
    const lockToken = this.extractLockToken(req);

    if (!lockToken) {
      res.status(400).send('Lock-Token header required');
      return;
    }

    // Check if resource exists first
    if (!(await this.filesystem.exists(path))) {
      res.status(404).end();
      return;
    }

    if (!this.lockManager.hasValidLockToken(path, lockToken)) {
      res.status(409).end(); // Conflict
      return;
    }

    const removed = this.lockManager.removeLock(lockToken);
    res.status(removed ? 204 : 409).end();
  }

  private async addChildrenRecursively(
    path: string, 
    propfindRequest: any, 
    responses: any[], 
    depth: string
  ): Promise<void> {
    const type = await this.filesystem.getType(path);
    if (type === 'collection') {
      try {
        const members = await this.filesystem.getMembers(path);
        if (this.debug) {
          console.log(`📂 Collection members (${members.length}):`, members);
        }
        
        for (const member of members) {
          const childResponse = await this.createPropResponse(member, propfindRequest);
          responses.push(childResponse);
          
          // If depth is infinity, recursively add grandchildren
          if (depth === 'infinity') {
            await this.addChildrenRecursively(member, propfindRequest, responses, depth);
          }
        }
      } catch (err) {
        if (this.debug) {
          console.log('⚠️ Error getting members:', err);
        }
      }
    }
  }

  private async createPropResponse(path: string, propfindRequest: any): Promise<any> {
    try {
      const props: any = {};
      const type = await this.filesystem.getType(path);
      const isCollection = type === 'collection';

      if (this.debug) {
        console.log(`🏷️ Creating props for ${path} (${type})`);
      }

      // Resource type (required for Windows Explorer)
      if (propfindRequest.allprop || propfindRequest.props?.includes('resourcetype')) {
        props['d:resourcetype'] = isCollection ? { 'd:collection': {} } : {};
      }

      // Content length (only for files)
      if (propfindRequest.allprop || propfindRequest.props?.includes('getcontentlength')) {
        if (!isCollection) {
          try {
            const size = await this.filesystem.getSize(path);
            props['d:getcontentlength'] = size.toString();
          } catch (err) {
            // Ignore errors for collections
          }
        }
      }

      // Content type (important for Windows Explorer)
      if (propfindRequest.allprop || propfindRequest.props?.includes('getcontenttype')) {
        if (!isCollection) {
          // Basic MIME type detection
          const ext = path.toLowerCase().split('.').pop();
          const mimeTypes: { [key: string]: string } = {
            'html': 'text/html',
            'htm': 'text/html',
            'txt': 'text/plain',
            'css': 'text/css',
            'js': 'application/javascript',
            'json': 'application/json',
            'xml': 'application/xml',
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml'
          };
          props['d:getcontenttype'] = mimeTypes[ext || ''] || 'application/octet-stream';
        }
      }

      // ETag
      if (propfindRequest.allprop || propfindRequest.props?.includes('getetag')) {
        props['d:getetag'] = await this.filesystem.getEtag(path);
      }

      // Display name
      if (propfindRequest.allprop || propfindRequest.props?.includes('displayname')) {
        props['d:displayname'] = await this.filesystem.getDisplayName(path);
      }

      // Last modified (critical for Windows Explorer)
      if (propfindRequest.allprop || propfindRequest.props?.includes('getlastmodified')) {
        const lastModified = await this.filesystem.getLastModified(path);
        props['d:getlastmodified'] = lastModified.toUTCString();
      }

      // Creation date
      if (propfindRequest.allprop || propfindRequest.props?.includes('creationdate')) {
        const created = await this.filesystem.getCreated(path);
        props['d:creationdate'] = created.toISOString();
      }

      // Supported locks
      if (propfindRequest.allprop || propfindRequest.props?.includes('supportedlock')) {
        const supportedLock = this.xml.createSupportedLockResponse();
        props['d:supportedlock'] = supportedLock['d:supportedlock'];
      }

      // Lock discovery
      if (propfindRequest.allprop || propfindRequest.props?.includes('lockdiscovery')) {
        const locks = this.lockManager.getLocksForPath(path);
        if (locks.length > 0) {
          const lockDiscovery = this.xml.createLockDiscoveryResponse(locks);
          props['d:lockdiscovery'] = lockDiscovery['d:lockdiscovery'];
        } else {
          props['d:lockdiscovery'] = '';
        }
      }

      // Windows-specific properties
      if (propfindRequest.allprop || propfindRequest.props?.includes('ishidden')) {
        props['d:ishidden'] = '0';
      }

      if (propfindRequest.allprop || propfindRequest.props?.includes('isreadonly')) {
        props['d:isreadonly'] = '0';
      }

      // Handle custom properties if specifically requested
      if (propfindRequest.props && Array.isArray(propfindRequest.props)) {
        for (const propName of propfindRequest.props) {
          // Skip standard DAV properties (already handled above)
          if (!propName.startsWith('d:') && !propName.startsWith('getcontentlength') && 
              !propName.startsWith('getcontenttype') && !propName.startsWith('getetag') &&
              !propName.startsWith('displayname') && !propName.startsWith('getlastmodified') &&
              !propName.startsWith('creationdate') && !propName.startsWith('resourcetype') &&
              !propName.startsWith('supportedlock') && !propName.startsWith('lockdiscovery') &&
              !propName.startsWith('ishidden') && !propName.startsWith('isreadonly')) {
            
            try {
              const customValue = await this.filesystem.getProperty(path, propName);
              if (customValue !== null && customValue !== undefined) {
                props[propName] = customValue;
              }
            } catch (error) {
              // Property doesn't exist, skip it
            }
          }
        }
      }

      // Ensure href is properly encoded for Windows
      const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');

      return this.xml.createPropFindResponse(encodedPath, props);
    } catch (error) {
      if (this.debug) {
        console.log(`❌ Error creating props for ${path}:`, error);
      }
      return this.xml.createErrorResponse(path, error instanceof Error ? error.message : 'Internal Server Error');
    }
  }

  private sendAuthChallenge(res: Response): void {
    res.set('WWW-Authenticate', `Basic realm="${this.realm}"`);
    res.status(401).send('Unauthorized');
  }

  private extractLockToken(req: Request): string | null {
    const lockTokenHeader = req.headers['lock-token'] as string;
    if (lockTokenHeader) {
      const match = lockTokenHeader.match(/opaquelocktoken:([^>]+)/);
      return match && match[1] ? match[1] : null;
    }

    const ifHeader = req.headers.if as string;
    if (ifHeader) {
      const match = ifHeader.match(/opaquelocktoken:([^>]+)/);
      return match && match[1] ? match[1] : null;
    }

    return null;
  }

  private parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
    // Parse Range header format: "bytes=start-end", "bytes=start-", "bytes=-suffix"
    const match = rangeHeader.match(/^bytes=(.+)$/);
    if (!match || !match[1]) return null;

    const rangeSpec = match[1];
    const hyphenIndex = rangeSpec.indexOf('-');
    if (hyphenIndex === -1) return null;

    const startStr = rangeSpec.substring(0, hyphenIndex);
    const endStr = rangeSpec.substring(hyphenIndex + 1);

    let start: number;
    let end: number;

    if (startStr === '') {
      // Suffix-byte-range-spec: "-500" (last 500 bytes)
      if (endStr === '') return null;
      const suffix = parseInt(endStr, 10);
      if (isNaN(suffix) || suffix <= 0) return null;
      start = Math.max(0, fileSize - suffix);
      end = fileSize - 1;
    } else if (endStr === '') {
      // Range from start to end: "500-"
      start = parseInt(startStr, 10);
      if (isNaN(start) || start < 0) return null;
      end = fileSize - 1;
    } else {
      // Specific range: "0-499"
      start = parseInt(startStr, 10);
      end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 0 || end < start) return null;
    }

    // Ensure range is within file bounds
    if (start >= fileSize) return null;
    end = Math.min(end, fileSize - 1);

    return { start, end };
  }

  private parseContentRange(contentRangeHeader: string): { start: number; end?: number; total?: number } | null {
    // Parse Content-Range header format: "bytes start-end/total" or "bytes start-end/*" or "bytes */total"
    const rangeMatch = contentRangeHeader.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/);
    const totalMatch = contentRangeHeader.match(/^bytes\s+\*\/(\d+)$/);
    
    if (totalMatch && totalMatch[1]) {
      // Format: "bytes */total" - used for unsatisfiable range responses
      return { start: 0, total: parseInt(totalMatch[1], 10) };
    }
    
    if (!rangeMatch || !rangeMatch[1] || !rangeMatch[2]) return null;
    
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const total = rangeMatch[3] && rangeMatch[3] !== '*' ? parseInt(rangeMatch[3], 10) : undefined;
    
    if (start < 0 || end < start) return null;
    
    return { start, end, total };
  }

  private parseTimeout(timeoutHeader: string): number | undefined {
    if (!timeoutHeader) return undefined;
    
    const match = timeoutHeader.match(/Second-(\d+)/i);
    return match && match[1] ? parseInt(match[1], 10) : undefined;
  }

  private generateDirectoryListing(path: string, members: string[]): string {
    const title = `Directory listing for ${path}`;
    const rows = members.map(member => {
      const name = member.split('/').pop() || member;
      return `<tr><td><a href="${member}">${name}</a></td></tr>`;
    }).join('\n');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
        a { text-decoration: none; color: #0066cc; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <table>
        <thead>
            <tr><th>Name</th></tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>
</body>
</html>`;
  }

  /**
   * Normalize and sanitize paths before passing to filesystem
   * Ensures consistent path format and prevents directory traversal
   */
  private normalizePath(requestPath: string): string {
    // Decode URI components first
    let normalized = decodeURIComponent(requestPath);
    
    // Use posix path normalization for consistent forward slashes
    normalized = path.posix.normalize(normalized);
    
    // Ensure path starts with forward slash
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    
    // Remove trailing slash except for root
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    // Prevent directory traversal by ensuring path doesn't escape root
    if (normalized.includes('..')) {
      normalized = normalized.split('/').filter(segment => segment !== '..').join('/') || '/';
    }
    
    return normalized;
  }

  /**
   * Get middleware array for mounting in Express apps
   * @returns Array of Express middleware functions
   */
  getMiddleware(): express.RequestHandler[] {
    return this.createMiddleware();
  }

  /**
   * Create a standalone Express app with WebDAV middleware
   * For backward compatibility and standalone usage
   */
  createStandaloneApp(): express.Application {
    const app = express();
    const middleware = this.createMiddleware();
    app.use(...middleware);
    return app;
  }

  /**
   * Start a standalone server (for backward compatibility)
   */
  listen(port: number, callback?: () => void): void {
    const app = this.createStandaloneApp();
    app.listen(port, callback);
  }

  destroy(): void {
    this.lockManager.destroy();
  }
}