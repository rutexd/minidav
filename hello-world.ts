import express from 'express';
import { createWebDAVMiddleware, MemoryFileSystem } from './index.js';

const app = express();

const filesystem = new MemoryFileSystem();

// Create WebDAV middleware and mount it at /files
const webdavMiddleware = createWebDAVMiddleware({
  filesystem
  // Using default config - authentication disabled by default
});

app.use('/files', ...webdavMiddleware);

// Add a simple home page
app.get('/', (req, res) => {
  res.send(`
    <h1>WebDAV Hello World</h1>
    <p>WebDAV is mounted at <a href="/files">/files</a></p>
    <p>Connect with a WebDAV client to: <code>http://localhost:3000/files</code></p>
  `);
});

app.listen(3000, () => {
  console.log('Server: http://localhost:3000');
  console.log('WebDAV: http://localhost:3000/files');
});