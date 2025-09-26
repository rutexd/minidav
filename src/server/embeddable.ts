// WebDAV Middleware Factory - Pure middleware without server initialization

import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { VirtualFileSystem } from '../filesystem/types.js';
import { MemoryFileSystem } from '../filesystem/memory-fs.js';
import { WebDAVServer } from '../webdav/server.js';
import { defaultConfig, mergeConfig, type WebDAVConfig } from '../config/types.js';

/**
 * WebDAV Middleware Options - simplified configuration for middleware usage
 */
export interface WebDAVMiddlewareOptions {
  filesystem?: VirtualFileSystem;
  config?: Partial<WebDAVConfig>;
}

/**
 * Create WebDAV middleware that can be used with app.use()
 * 
 * @param options - WebDAV middleware configuration
 * @returns Array of Express middleware functions
 * 
 * @example
 * ```typescript
 * import express from 'express';
 * import { createWebDAVMiddleware } from 'minidav';
 * 
 * const app = express();
 * app.use('/webdav', createWebDAVMiddleware({
 *   filesystem: new MemoryFileSystem(),
 *   config: { authentication: { enabled: true } }
 * }));
 * ```
 */
export function createWebDAVMiddleware(options: WebDAVMiddlewareOptions = {}): RequestHandler[] {
  const filesystem = options.filesystem || new MemoryFileSystem();
  const config = mergeConfig(defaultConfig, options.config || {});
  const logger = new Logger(config.logging);

  logger.info('WebDAV middleware created', {
    compliance: config.webdav.compliance,
    auth: config.authentication.enabled,
    logging: config.logging.enabled,
  });

  // Convert config to WebDAV options format
  const webdavUsers = config.authentication.users ? 
    Object.entries(config.authentication.users).map(([username, password]) => ({ username, password: password as string })) :
    undefined;

  // Create WebDAV server instance
  const webdavServer = new WebDAVServer(filesystem, {
    authentication: config.authentication.enabled,
    users: webdavUsers,
    realm: config.authentication.realm,
    debug: config.logging.requests || config.logging.responses,
    lockTimeout: config.webdav.lockTimeout,
  });

  const middleware: RequestHandler[] = [];

  // Timeout middleware - different timeouts for uploads vs other requests
  middleware.push((req: Request, res: Response, next: NextFunction) => {
    // Determine if this is an upload request (PUT method is typically used for uploads)
    const isUpload = req.method === 'PUT' && req.headers['content-length'];
    const timeout = isUpload ? config.timeouts.upload : config.timeouts.request;
    
    // For uploads, use progressive timeout that resets on data activity
    if (isUpload) {
      let timeoutHandle: NodeJS.Timeout | null = null;
      
      const resetTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          logger.warn(`⏱️ Upload timeout - no activity (${timeout}ms)`, {
            method: req.method,
            path: req.path,
            contentLength: req.headers['content-length'],
          });
          if (!res.headersSent) {
            res.status(408).send('Upload Timeout - No Activity');
          }
        }, timeout);
      };

      // Set initial timeout
      resetTimeout();

      // Reset timeout on data chunks
      req.on('data', resetTimeout);
      req.on('end', () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
      req.on('close', () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
      req.on('error', () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

    } else {
      // For non-upload requests, use simple timeout
      req.setTimeout(timeout, () => {
        logger.warn(`⏱️ Request timeout (${timeout}ms)`, {
          method: req.method,
          path: req.path,
        });
        if (!res.headersSent) {
          res.status(408).send('Request Timeout');
        }
      });
    }

    // Set response timeout for all requests
    res.setTimeout(timeout, () => {
      logger.warn(`⏱️ Response timeout (${timeout}ms)`, {
        method: req.method,
        path: req.path,
        isUpload,
      });
      if (!res.headersSent) {
        res.status(408).send('Response Timeout');
      }
    });

    next();
  });

  // Request logging middleware
  if (config.logging.requests) {
    middleware.push((req: Request, res: Response, next: NextFunction) => {
      const isUpload = req.method === 'PUT' && req.headers['content-length'];
      
      logger.debug(`📥 ${req.method} ${req.path}`, {
        headers: req.headers,
        query: req.query,
        isUpload,
        contentLength: req.headers['content-length'],
      });

      // Add upload progress tracking for PUT requests
      if (isUpload && config.logging.level === 'debug') {
        let receivedBytes = 0;
        const totalBytes = parseInt(req.headers['content-length'] as string, 10);
        let lastLogTime = Date.now();

        req.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          
          // Log progress every 5 seconds or when upload completes
          if (now - lastLogTime > 5000 || receivedBytes >= totalBytes) {
            const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
            logger.debug(`📊 Upload progress: ${progress}% (${receivedBytes}/${totalBytes} bytes)`, {
              path: req.path,
              progress,
              receivedBytes,
              totalBytes,
            });
            lastLogTime = now;
          }
        });
      }

      next();
    });
  }

  // Body parsing middleware - handle different request types appropriately
  // For XML methods (PROPFIND, PROPPATCH, LOCK), parse as buffer
  middleware.push((req: Request, res: Response, next: NextFunction) => {
    const xmlMethods = ['PROPFIND', 'PROPPATCH', 'LOCK'];
    if (xmlMethods.includes(req.method)) {
      return express.raw({ 
        type: '*/*', 
        limit: config.performance.maxRequestSize 
      })(req, res, next);
    }
    // For PUT/POST and other methods, don't parse body - let them handle streams
    next();
  });

  // CORS middleware
  if (config.cors.enabled) {
    middleware.push((req: Request, res: Response, next: NextFunction) => {
      const origins = config.cors.origins;
      const origin = req.headers.origin;

      if (origins === '*' || (Array.isArray(origins) && origin && origins.includes(origin))) {
        res.set('Access-Control-Allow-Origin', origin || '*');
      }

      res.set('Access-Control-Allow-Methods', config.cors.methods.join(', '));
      res.set('Access-Control-Allow-Headers', config.cors.headers.join(', '));
      
      if (config.cors.credentials) {
        res.set('Access-Control-Allow-Credentials', 'true');
      }

      if (req.method === 'OPTIONS') {
        return res.status(200).end();
      }

      next();
    });
  }

  // Custom headers middleware
  if (Object.keys(config.response.customHeaders).length > 0) {
    middleware.push((req: Request, res: Response, next: NextFunction) => {
      Object.entries(config.response.customHeaders).forEach(([key, value]) => {
        res.set(key, value as string);
      });
      next();
    });
  }

  // Response logging middleware
  if (config.logging.responses) {
    middleware.push((req: Request, res: Response, next: NextFunction) => {
      const originalSend = res.send;
      res.send = function(body: any) {
        logger.debug(`📤 ${req.method} ${req.path} → ${res.statusCode}`, {
          headers: res.getHeaders(),
          bodyLength: typeof body === 'string' ? body.length : 0,
        });
        return originalSend.call(this, body);
      };
      next();
    });
  }

  // Add WebDAV protocol middleware
  middleware.push(...webdavServer.getMiddleware());

  logger.info('✅ WebDAV middleware ready');
  return middleware;
}

// Logger class for structured logging
class Logger {
  constructor(private config: WebDAVConfig['logging']) {}

  debug(message: string, data?: any): void {
    if (this.config.enabled && (this.config.level === 'debug')) {
      console.log(`🐛 ${new Date().toISOString()} DEBUG: ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    if (this.config.enabled && ['debug', 'info'].includes(this.config.level)) {
      console.log(`ℹ️  ${new Date().toISOString()} INFO: ${message}`, data || '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.config.enabled && ['debug', 'info', 'warn'].includes(this.config.level)) {
      console.warn(`⚠️  ${new Date().toISOString()} WARN: ${message}`, data || '');
    }
  }

  error(message: string, data?: any): void {
    if (this.config.enabled) {
      console.error(`❌ ${new Date().toISOString()} ERROR: ${message}`, data || '');
    }
  }
}

/**
 * Legacy WebDAV Server class for backward compatibility with main.ts
 * @deprecated Use createWebDAVMiddleware instead
 */
export class LegacyWebDAVServer {
  private config: WebDAVConfig;
  private app: express.Express;
  private server: any = null;

  constructor(filesystem: VirtualFileSystem, config: Partial<WebDAVConfig>) {
    this.config = mergeConfig(defaultConfig, config);
    this.app = express();
    
    // Mount WebDAV middleware
    const middleware = createWebDAVMiddleware({ filesystem, config });
    this.app.use('/', ...middleware);
  }

  async start(): Promise<any> {
    return new Promise((resolve, reject) => {
      const { port, host } = this.config.server;
      
      this.server = this.app.listen(port, host, () => {
        console.log(`🌐 WebDAV server listening on http://${host}:${port}`);
        resolve(this.server);
      });

      this.server.on('error', (error: any) => {
        console.error('❌ Server error:', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🛑 WebDAV server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getConfig(): WebDAVConfig {
    return { ...this.config };
  }
}

// Legacy compatibility - factory function that returns server class for main.ts
export function createWebDAVServer(
  filesystem?: VirtualFileSystem,
  config?: Partial<WebDAVConfig>
): LegacyWebDAVServer {
  const fs = filesystem || new MemoryFileSystem();
  return new LegacyWebDAVServer(fs, config || {});
}

// Export types for external use
export type { WebDAVConfig };