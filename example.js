/**
 * Example: Basic Express integration with MiniDAV
 * 
 * This example shows how to embed the WebDAV server in an Express application
 * with a virtual filesystem.
 */

import express from 'express';
import { createWebDAVServer, MemoryFileSystem } from './index.js';
import { Readable } from 'stream';

const app = express();
const port = 3000;

// Create a virtual filesystem
const filesystem = new MemoryFileSystem();

// Add some initial content
async function setupInitialContent() {
  await filesystem.create('/documents', 'collection');
  await filesystem.create('/shared', 'collection');
  
  const welcomeText = `Welcome to MiniDAV!

This is a virtual filesystem served via WebDAV.
You can access this through:
- Web browser: http://localhost:${port}/webdav/
- Windows Explorer: Map network drive to http://localhost:${port}/webdav/

Try creating, editing, and managing files!`;

  await filesystem.setStream('/documents/welcome.txt', Readable.from([welcomeText]));
}

async function main() {
  // Setup initial content
  await setupInitialContent();

  // Create WebDAV server
  const webdavServer = createWebDAVServer(filesystem, {
    authentication: { enabled: false }, // No auth for demo
    logging: { level: 'info', requests: false }
  });

  // Regular Express routes
  app.get('/', (req, res) => {
    res.send(`
      <h1>MiniDAV Example</h1>
      <p>WebDAV server is running!</p>
      <ul>
        <li><a href="/webdav/">Browse files (WebDAV)</a></li>
        <li>Windows Explorer: Map network drive to <code>http://localhost:${port}/webdav/</code></li>
      </ul>
    `);
  });

  // Mount WebDAV server on /webdav path
  app.use('/webdav', webdavServer.getMiddleware());

  // Start server
  app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
    console.log(`📁 WebDAV available at http://localhost:${port}/webdav/`);
    console.log(`🪟 Windows Explorer: Map drive to http://localhost:${port}/webdav/`);
  });
}

main().catch(console.error);