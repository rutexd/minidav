// Configuration types and presets for WebDAV Server

export interface ServerConfig {
  port: number;
  host: string;
  maxConnections?: number;
  timeout?: number;
}

export interface TimeoutConfig {
  request: number;        // General request timeout (ms)
  upload: number;         // File upload timeout (ms)
//   download: number;       // File download timeout (ms)
//   lock: number;           // WebDAV lock timeout (ms)
//   idle: number;           // Idle connection timeout (ms)
//   keepAlive: number;      // Keep-alive timeout (ms)
}

export interface AuthenticationConfig {
  enabled: boolean;
  realm: string;
  basicAuth: boolean;
  users: Record<string, string> | null;
  allowAnonymous?: boolean;
}

export interface LoggingConfig {
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error';
  requests: boolean;
  responses: boolean;
  filesystem: boolean;
  xml: boolean;
  locks: boolean;
  auth: boolean;
  file?: string;
}

export interface WebDAVFeatureConfig {
  compliance: string[];
  lockTimeout: number;
  maxDepth: number;
  enableLocking: boolean;
  enableVersioning: boolean;
}

export interface ResponseConfig {
  enableMimeTypeDetection: boolean;
  customHeaders: Record<string, string>;
  enableDirectoryListing: boolean;
  enableRangeRequests: boolean;
}

export interface CORSConfig {
  enabled: boolean;
  origins: string | string[];
  methods: string[];
  headers: string[];
  credentials: boolean;
}

export interface PerformanceConfig {
  maxRequestSize: string;
  compressionEnabled: boolean;
  cacheControl: string;
  keepAlive: boolean;
}

export interface WebDAVConfig {
  server: ServerConfig;
  timeouts: TimeoutConfig;
  authentication: AuthenticationConfig;
  logging: LoggingConfig;
  webdav: WebDAVFeatureConfig;
  response: ResponseConfig;
  cors: CORSConfig;
  performance: PerformanceConfig;
}

// Default configuration
export const defaultConfig: WebDAVConfig = {
  server: {
    port: 3000,
    host: 'localhost',
    maxConnections: 100,
    timeout: 30000,
  },
  timeouts: {
    request: 30000,     // 30 seconds for general requests
    upload: 300000,     // 5 minutes for file uploads
  },
  authentication: {
    enabled: false,
    realm: 'WebDAV Server',
    basicAuth: true,
    users: null,
    allowAnonymous: true,
  },
  logging: {
    enabled: true,
    level: 'info',
    requests: false,
    responses: false,
    filesystem: false,
    xml: false,
    locks: false,
    auth: true,
  },
  webdav: {
    compliance: ['Class 1', 'Class 2'],
    lockTimeout: 300000, // 5 minutes
    maxDepth: 10,
    enableLocking: true,
    enableVersioning: false,
  },
  response: {
    enableMimeTypeDetection: true,
    customHeaders: {},
    enableDirectoryListing: true,
    enableRangeRequests: true,
  },
  cors: {
    enabled: false,
    origins: '*',
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'],
    headers: ['Content-Type', 'Authorization', 'Depth', 'Destination', 'If', 'Lock-Token', 'Overwrite', 'Range'],
    credentials: false,
  },
  performance: {
    maxRequestSize: '100mb',
    compressionEnabled: true,
    cacheControl: 'no-cache',
    keepAlive: true,
  },
};

export const configPresets = {
  production: (port: number = 80): Partial<WebDAVConfig> => ({
    server: {
      port,
      host: '0.0.0.0',
      maxConnections: 1000,
      timeout: 60000,
    },
    timeouts: {
      request: 60000,      // 1 minute for general requests
      upload: 1800000,     // 30 minutes for large file uploads
    },
    logging: {
      enabled: true,
      level: 'warn',
      requests: false,
      responses: false,
      filesystem: false,
      xml: false,
      locks: true,
      auth: true,
    },
    authentication: {
      enabled: true,
      realm: 'WebDAV Server',
      basicAuth: true,
      users: { 'admin': 'changeme' },
      allowAnonymous: false,
    },
    performance: {
      maxRequestSize: '10gb',
      compressionEnabled: true,
      cacheControl: 'public, max-age=3600',
      keepAlive: true,
    },
    cors: {
      enabled: true,
      origins: ['https://yourdomain.com'],
      methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'],
      headers: ['Content-Type', 'Authorization', 'Depth', 'Destination', 'If', 'Lock-Token', 'Overwrite', 'Range'],
      credentials: true,
    },
    // response: {
    //     // customHeaders: {
    //     //     'X-MS-Author-Via': 'DAV',
    //     //     'MS-Author-Via': 'DAV',
    //     // }
    // }
  }),

  // Development configuration with full logging
  development: (port: number = 3000): Partial<WebDAVConfig> => ({
    server: {
      port,
      host: 'localhost',
      maxConnections: 10,
      timeout: 30000,
    },
    timeouts: {
      request: 30000,      // 30 seconds for general requests
      upload: 600000,      // 10 minutes for file uploads
    },
    logging: {
      enabled: true,
      level: 'debug',
      requests: true,
      responses: false,
      filesystem: false,
      xml: false,
      locks: true,
      auth: true,
    },
    authentication: {
      enabled: false,
      realm: 'WebDAV Development Server',
      basicAuth: true,
      users: null,
      allowAnonymous: true,
    },
    response: {
      enableMimeTypeDetection: true,
      customHeaders: {
        'X-WebDAV-Server': 'Development Mode',
        'X-Powered-By': 'WebDAV Server v2.0',
        'X-MS-Author-Via': 'DAV',
        'MS-Author-Via': 'DAV',
      },
      enableDirectoryListing: true,
      enableRangeRequests: true,
    },
  }),
};

// Utility function to merge configurations
export function mergeConfig(base: WebDAVConfig | Partial<WebDAVConfig>, override: Partial<WebDAVConfig>): WebDAVConfig {
  const result = { ...defaultConfig };
  
  // Deep merge base configuration
  if (base.server) result.server = { ...result.server, ...base.server };
  if (base.timeouts) result.timeouts = { ...result.timeouts, ...base.timeouts };
  if (base.authentication) result.authentication = { ...result.authentication, ...base.authentication };
  if (base.logging) result.logging = { ...result.logging, ...base.logging };
  if (base.webdav) result.webdav = { ...result.webdav, ...base.webdav };
  if (base.response) result.response = { ...result.response, ...base.response };
  if (base.cors) result.cors = { ...result.cors, ...base.cors };
  if (base.performance) result.performance = { ...result.performance, ...base.performance };
  
  // Deep merge override configuration
  if (override.server) result.server = { ...result.server, ...override.server };
  if (override.timeouts) result.timeouts = { ...result.timeouts, ...override.timeouts };
  if (override.authentication) result.authentication = { ...result.authentication, ...override.authentication };
  if (override.logging) result.logging = { ...result.logging, ...override.logging };
  if (override.webdav) result.webdav = { ...result.webdav, ...override.webdav };
  if (override.response) result.response = { ...result.response, ...override.response };
  if (override.cors) result.cors = { ...result.cors, ...override.cors };
  if (override.performance) result.performance = { ...result.performance, ...override.performance };
  
  return result;
}

// Validation functions
export function validateConfig(config: Partial<WebDAVConfig>): string[] {
  const errors: string[] = [];
  
  if (config.server?.port && (config.server.port < 1 || config.server.port > 65535)) {
    errors.push('Server port must be between 1 and 65535');
  }
  
  if (config.timeouts?.request && config.timeouts.request < 1000) {
    errors.push('Request timeout must be at least 1000ms');
  }
  
  if (config.timeouts?.upload && config.timeouts.upload < 1000) {
    errors.push('Upload timeout must be at least 1000ms');
  }
  
  if (config.logging?.level && !['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
    errors.push('Logging level must be one of: debug, info, warn, error');
  }
  
  if (config.authentication?.enabled && !config.authentication?.users) {
    errors.push('Authentication is enabled but no users are configured');
  }
  
  if (config.webdav?.lockTimeout && config.webdav.lockTimeout < 1000) {
    errors.push('WebDAV lock timeout must be at least 1000ms');
  }
  
  return errors;
}

// All types and functions are exported above