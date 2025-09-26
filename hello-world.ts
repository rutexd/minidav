import express from 'express';
import { createWebDAVServer, MemoryFileSystem } from './index.js';

const app = express();

const filesystem = new MemoryFileSystem();

const webdavServer = createWebDAVServer(filesystem);

await webdavServer.initialize();

webdavServer.mountAt('/files', app);

app.listen(3000, () => {
  console.log('Server: http://localhost:3000');
  console.log('WebDAV: http://localhost:3000/files');
});