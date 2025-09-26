// Embeddable WebDAV Server with comprehensive configuration support

import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import type { VirtualFileSystem } from '../filesystem/types.js';
import { MemoryFileSystem } from '../filesystem/memory-fs.js';
import { WebDAVServer } from '../webdav/server.js';
import { defaultConfig, mergeConfig, type WebDAVConfig } from '../config/types.js';

export class EmbeddableWebDAVServer {
  private app: Express | null = null;
  private server: Server | null = null;
  private webdavServer: WebDAVServer | null = null;
  private config: WebDAVConfig;
  private logger: Logger;

  constructor(
    private filesystem: VirtualFileSystem,
    config: Partial<WebDAVConfig> = {}
  ) {
    this.config = mergeConfig(defaultConfig, config);
    this.logger = new Logger(this.config.logging);
    
    this.logger.info('🚀 EmbeddableWebDAVServer created', {
      compliance: this.config.webdav.compliance,
      auth: this.config.authentication.enabled,
      logging: this.config.logging.enabled,
    });
  }

  /**
   * Initialize the WebDAV server (creates Express app if not provided)
   */
  async initialize(existingApp?: Express): Promise<Express> {
    if (existingApp) {
      this.app = existingApp;
      this.logger.info('📦 Using existing Express app');
    } else {
      this.app = express();
      this.setupExpressMiddleware();
      this.logger.info('🆕 Created new Express app');
    }

    // Convert config to WebDAV options format
    const webdavUsers = this.config.authentication.users ? 
      Object.entries(this.config.authentication.users).map(([username, password]) => ({ username, password: password as string })) :
      undefined;

    // Create WebDAV server instance
    this.webdavServer = new WebDAVServer(this.filesystem, {
      authentication: this.config.authentication.enabled,
      users: webdavUsers,
      realm: this.config.authentication.realm,
      debug: this.config.logging.requests || this.config.logging.responses,
      lockTimeout: this.config.webdav.lockTimeout,
    });

    // Mount WebDAV routes
    this.mountWebDAVRoutes();

    this.logger.info('✅ WebDAV server initialized');
    return this.app;
  }

  /**
   * Start the server (only if using standalone mode)
   */
  async start(): Promise<Server> {
    if (!this.app) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      const { port, host } = this.config.server;
      
      this.server = this.app!.listen(port, host, () => {
        this.logger.info(`🌐 WebDAV server listening on http://${host}:${port}`, {
          compliance: this.config.webdav.compliance.join(', '),
          auth: this.config.authentication.enabled,
        });
        resolve(this.server!);
      });

      // Configure server timeouts
      if (this.server) {
        this.server.timeout = this.config.timeouts.request;
        this.server.keepAliveTimeout = this.config.timeouts.request;
        this.server.headersTimeout = this.config.timeouts.request + 1000; // Slightly higher than timeout
      }

      this.server.on('error', (error) => {
        this.logger.error('❌ Server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('🛑 WebDAV server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express app (for embedding in other servers)
   */
  getApp(): Express | null {
    return this.app;
  }

  /**
   * Get current configuration
   */
  getConfig(): WebDAVConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart for some changes)
   */
  updateConfig(newConfig: Partial<WebDAVConfig>): void {
    this.config = mergeConfig(this.config, newConfig);
    this.logger = new Logger(this.config.logging);
    this.logger.info('🔄 Configuration updated');
  }

  /**
   * Mount WebDAV at a specific path (useful for embedding)
   */
  mountAt(path: string, app: Express): void {
    if (!this.webdavServer) {
      throw new Error('WebDAV server not initialized. Call initialize() first.');
    }

    // Mount all WebDAV routes under the specified path
    app.use(path, this.app!);
    
    this.logger.info(`📍 WebDAV mounted at ${path}`);
  }

  private setupExpressMiddleware(): void {
    if (!this.app) return;

    // Timeout middleware - different timeouts for uploads vs other requests
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Determine if this is an upload request (PUT method is typically used for uploads)
      const isUpload = req.method === 'PUT' && req.headers['content-length'];
      const timeout = isUpload ? this.config.timeouts.upload : this.config.timeouts.request;
      
      // For uploads, use progressive timeout that resets on data activity
      if (isUpload) {
        let timeoutHandle: NodeJS.Timeout | null = null;
        
        const resetTimeout = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          timeoutHandle = setTimeout(() => {
            this.logger.warn(`⏱️ Upload timeout - no activity (${timeout}ms)`, {
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
          this.logger.warn(`⏱️ Request timeout (${timeout}ms)`, {
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
        this.logger.warn(`⏱️ Response timeout (${timeout}ms)`, {
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
    if (this.config.logging.requests) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const isUpload = req.method === 'PUT' && req.headers['content-length'];
        
        this.logger.debug(`📥 ${req.method} ${req.path}`, {
          headers: req.headers,
          query: req.query,
          isUpload,
          contentLength: req.headers['content-length'],
        });

        // Add upload progress tracking for PUT requests
        if (isUpload && this.config.logging.level === 'debug') {
          let receivedBytes = 0;
          const totalBytes = parseInt(req.headers['content-length'] as string, 10);
          let lastLogTime = Date.now();

          req.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            const now = Date.now();
            
            // Log progress every 5 seconds or when upload completes
            if (now - lastLogTime > 5000 || receivedBytes >= totalBytes) {
              const progress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
              this.logger.debug(`📊 Upload progress: ${progress}% (${receivedBytes}/${totalBytes} bytes)`, {
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
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const xmlMethods = ['PROPFIND', 'PROPPATCH', 'LOCK'];
      if (xmlMethods.includes(req.method)) {
        return express.raw({ 
          type: '*/*', 
          limit: this.config.performance.maxRequestSize 
        })(req, res, next);
      }
      // For PUT/POST and other methods, don't parse body - let them handle streams
      next();
    });

    // CORS middleware
    if (this.config.cors.enabled) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const origins = this.config.cors.origins;
        const origin = req.headers.origin;

        if (origins === '*' || (Array.isArray(origins) && origin && origins.includes(origin))) {
          res.set('Access-Control-Allow-Origin', origin || '*');
        }

        res.set('Access-Control-Allow-Methods', this.config.cors.methods.join(', '));
        res.set('Access-Control-Allow-Headers', this.config.cors.headers.join(', '));
        
        if (this.config.cors.credentials) {
          res.set('Access-Control-Allow-Credentials', 'true');
        }

        if (req.method === 'OPTIONS') {
          return res.status(200).end();
        }

        next();
      });
    }

    // Custom headers middleware
    if (Object.keys(this.config.response.customHeaders).length > 0) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        Object.entries(this.config.response.customHeaders).forEach(([key, value]) => {
          res.set(key, value as string);
        });
        next();
      });
    }

    // Response logging middleware
    if (this.config.logging.responses) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const originalSend = res.send;
        const logger = this.logger;
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
  }

  private mountWebDAVRoutes(): void {
    if (!this.app || !this.webdavServer) return;

    // Mount the WebDAV middleware at root
    const webdavMiddleware = this.webdavServer.getMiddleware();
    this.app.use('/', ...webdavMiddleware);
  }
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

// Factory function for easy creation
export function createWebDAVServer(
  filesystem?: VirtualFileSystem,
  config?: Partial<WebDAVConfig>
): EmbeddableWebDAVServer {
  const fs = filesystem || new MemoryFileSystem();
  return new EmbeddableWebDAVServer(fs, config);
}

// Export types for external use
export type { WebDAVConfig };