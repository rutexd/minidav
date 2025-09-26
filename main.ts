import express from 'express';
import { createWebDAVMiddleware, type WebDAVConfig } from './src/server/embeddable.js';
import { MemoryFileSystem } from './src/filesystem/memory-fs.js';
import { Readable } from 'stream';
import { configPresets } from './src/config/types.js';
import type { Server } from 'http';

type ServerMode = 'production' | 'development';

interface MainOptions {
  mode?: ServerMode;
  port?: number;
  host?: string;
  auth?: boolean;
  debug?: boolean;
  config?: Partial<WebDAVConfig>;
}

async function createSampleContent(filesystem: MemoryFileSystem): Promise<void> {
  // Create folder structure
  await filesystem.create('/documents', 'collection');
  await filesystem.create('/images', 'collection');
  await filesystem.create('/uploads', 'collection');
  await filesystem.create('/shared', 'collection');

  // Add README file
  const readmeContent = `WebDAV
    FEATURES:
• WebDAV Classes 1 & 2 compliance
• Windows Explorer compatibility (enabled by default)
• Range request support for partial downloads
• Automatic resource creation
• Embeddable in Express applications
• Comprehensive configuration system
• Advanced logging and debugging
• Lock management with automatic cleanup
• MIME type detection for proper file icons
• Streaming uploads/downloads with backpressure handling
`;

  await filesystem.setStream('/README.txt', Readable.from([readmeContent]));

  // Add configuration file
  const configContent = JSON.stringify({
    "server": "WebDAV Server v2.0",
    "build": new Date().toISOString(),
    "features": {
      "webdav_compliance": ["Class 1", "Class 2"],
      "windows_explorer": "enabled_by_default",
      "range_requests": "supported",
      "resource_creation": "automatic",
      "mime_detection": "enabled",
      "authentication": "configurable",
      "logging": "advanced",
      "embedding": "supported"
    },
    "endpoints": {
      "root": "/",
      "documents": "/documents/",
      "images": "/images/",
      "uploads": "/uploads/",
      "shared": "/shared/"
    },
    "modes": {
      "production": "Optimized for production deployment",
      "development": "Full logging and debugging"
    }
  }, null, 2);

  await filesystem.setStream('/documents/config.json', Readable.from([configContent]));

  // Add sample files for different MIME types
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>WebDAV Server Test</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>🌐 WebDAV Server v2.0</h1>
    <p>This HTML file demonstrates MIME type detection.</p>
    <p>When accessed via Windows Explorer, this file should show an HTML icon.</p>
    
    <h2>Features Tested:</h2>
    <ul>
        <li>✅ MIME Type Detection (text/html)</li>
        <li>✅ Windows Explorer Compatibility</li>
        <li>✅ Range Request Support</li>
        <li>✅ Automatic Resource Creation</li>
    </ul>
</body>
</html>`;
  await filesystem.setStream('/documents/test.html', Readable.from([htmlContent]));

  // Add sample image (mock JPEG header)
  const jpegHeader = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xFF, 0xFE, 0x00, 0x13, 0x57, 0x65, 0x62, 0x44, 0x41, 0x56, 0x20, 0x54,
    0x65, 0x73, 0x74, 0x20, 0x49, 0x6D, 0x61, 0x67, 0x65, 0xFF, 0xD9
  ]);
  await filesystem.setStream('/images/sample.jpg', Readable.from([jpegHeader]));
}

function getServerConfig(options: MainOptions): Partial<WebDAVConfig> {
  const { mode = 'development', port = 3000, host = 'localhost', auth = false, debug = false } = options;

  let baseConfig: Partial<WebDAVConfig> = configPresets.production(port);

  if(mode == "development"){
      baseConfig = configPresets.development(port);
  }

  const config: Partial<WebDAVConfig> = {
    ...baseConfig,
    server: {
      ...baseConfig.server,
      port,
      host,
    },
    authentication: {
      realm: 'WebDAV Server',
      basicAuth: true,
      ...baseConfig.authentication,
      enabled: auth,
      users: auth ? { 'admin': 'password', 'user': 'test' } : null,
    },
    logging: {
      enabled: true,
      level: debug ? 'debug' : (baseConfig.logging?.level || 'info'),
      requests: debug || baseConfig.logging?.requests || false,
      responses: baseConfig.logging?.responses || false,
      filesystem: baseConfig.logging?.filesystem || false,
      xml: baseConfig.logging?.xml || false,
      locks: baseConfig.logging?.locks || false,
      auth: baseConfig.logging?.auth || true,
    },
    ...options.config,
  };

  return config;
}

async function startServer(options: MainOptions = {}): Promise<Server> {
  const { mode = 'development' } = options;
  
  console.log(`🚀 Starting WebDAV Server v2.0 in ${mode.toUpperCase()} mode...\n`);

  // Create filesystem with sample content
  const filesystem = new MemoryFileSystem();
  await createSampleContent(filesystem);

  // Get configuration
  const config = getServerConfig(options);
  
  // Create Express app with WebDAV middleware
  const app = express();
  const webdavMiddleware = createWebDAVMiddleware({ filesystem, config });
  app.use('/', ...webdavMiddleware);
  
  // Start server
  const port = config.server?.port || 3000;
  const host = config.server?.host || 'localhost';
  
  const server = await new Promise<Server>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      console.log(`🌐 WebDAV server listening on http://${host}:${port}`);
      resolve(httpServer);
    });
    
    httpServer.on('error', (error) => {
      console.error('❌ Server error:', error);
      reject(error);
    });
  });

  const serverConfig = config;
  
  console.log('✅ WebDAV Server started successfully!\n');
  
  console.log('📋 Server Configuration:');
  console.log(`   • Mode: ${mode.toUpperCase()}`);
  console.log(`   • Port: ${port}`);
  console.log(`   • Host: ${host}`);
  console.log(`   • Authentication: ${serverConfig.authentication?.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`   • Range requests: Supported ✅`);
  console.log(`   • MIME detection: ${serverConfig.response?.enableMimeTypeDetection ? 'Enabled ✅' : 'Disabled'}`);
  console.log(`   • Logging level: ${serverConfig.logging?.level || 'info'}`);
  console.log(`   • WebDAV compliance: ${serverConfig.webdav?.compliance?.join(', ') || 'Class 1, Class 2'}`);

  if (serverConfig.authentication?.enabled && serverConfig.authentication?.users) {
    console.log('\n🔐 Authentication Users:');
    Object.keys(serverConfig.authentication.users).forEach(user => {
      console.log(`   • ${user} / ${serverConfig.authentication?.users?.[user]}`);
    });
  }
  
  console.log('\n🌐 Access Methods:');
  const baseUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  console.log(`   • Web Browser: ${baseUrl}/`);
  console.log(`   • Windows Explorer: Map network drive to ${baseUrl}/`);
  console.log(`   • WebDAV Client: Connect to ${baseUrl}/`);
  console.log(`   • Command Line: curl -X PROPFIND ${baseUrl}/`);


  console.log('\n🛑 Press Ctrl+C to stop the server');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down WebDAV server...');
    server.close(() => {
      console.log('✅ Server stopped successfully');
      process.exit(0);
    });
  });
  
  return server;
}

// Parse command line arguments and environment variables
function parseArgs(): MainOptions {
  const args = process.argv.slice(2);
  const options: MainOptions = {};

  // Environment variables
  const envMode = process.env.WEBDAV_MODE as ServerMode;
  const envPort = process.env.WEBDAV_PORT ? parseInt(process.env.WEBDAV_PORT) : undefined;
  const envHost = process.env.WEBDAV_HOST;
  const envAuth = process.env.WEBDAV_AUTH === 'true';
  const envDebug = process.env.WEBDAV_DEBUG === 'true';

  // Command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--mode':
      case '-m':
        options.mode = args[++i] as ServerMode;
        break;
      case '--port':
      case '-p':
        const portArg = args[++i];
        if (portArg) options.port = parseInt(portArg);
        break;
      case '--host':
      case '-h':
        const hostArg = args[++i];
        if (hostArg) options.host = hostArg;
        break;
      case '--auth':
      case '-a':
        options.auth = true;
        break;
      case '--debug':
      case '-d':
        options.debug = true;
        break;
      case '--help':
        console.log(`
WebDAV Server v2.0 - Usage

MODES:
  production  - Optimized for production (port 80, minimal logging)
  development - Full development features (port 3000, enhanced logging)

COMMAND LINE OPTIONS:
  --mode, -m <mode>     Server mode (default: development)
  --port, -p <port>     Port number (default: mode-specific)
  --host, -h <host>     Host address (default: localhost)
  --auth, -a            Enable authentication
  --debug, -d           Enable debug logging
  --help                Show this help

ENVIRONMENT VARIABLES:
  WEBDAV_MODE=<mode>    Server mode
  WEBDAV_PORT=<port>    Port number
  WEBDAV_HOST=<host>    Host address
  WEBDAV_AUTH=true      Enable authentication
  WEBDAV_DEBUG=true     Enable debug logging

EXAMPLES:
  bun run main.ts                           # Development mode
  bun run main.ts --mode production --auth  # Production with auth
  bun run main.ts --port 8080 --debug       # Custom port with debug
  
  WEBDAV_MODE=production bun run main.ts    # Environment variable
`);
        process.exit(0);
    }
  }

  // Apply environment variable defaults
  if (envMode) options.mode = envMode;
  if (envPort) options.port = envPort;
  if (envHost) options.host = envHost;
  if (envAuth) options.auth = envAuth;
  if (envDebug) options.debug = envDebug;

  return options;
}

// Main execution
if (import.meta.main) {
  const options = parseArgs();
  startServer(options).catch(console.error);
}

// Export for programmatic use
export { startServer, type MainOptions, type ServerMode };