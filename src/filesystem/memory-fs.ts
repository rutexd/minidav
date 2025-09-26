import { fs } from 'memfs';
import { Readable, Writable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import type { VirtualFileSystem, VirtualFile } from './types.js';
import * as path from 'path';

export class MemoryFileSystem implements VirtualFileSystem {
  private properties: Map<string, Map<string, any>> = new Map();

  constructor() {
    try {
      fs.mkdirSync('/', { recursive: true });
      this.setPropertyInternal('/', 'created', new Date());
      this.setPropertyInternal('/', 'lastModified', new Date());
      this.setPropertyInternal('/', 'etag', this.generateEtag());
    } catch (err) {
    }
  }

  private generateEtag(): string {
    return `"${uuidv4()}"`;
  }

  private setPropertyInternal(filePath: string, property: string, value: any): void {
    if (!this.properties.has(filePath)) {
      this.properties.set(filePath, new Map());
    }
    this.properties.get(filePath)!.set(property, value);
  }

  private getPropertyInternal(filePath: string, property: string): any {
    return this.properties.get(filePath)?.get(property);
  }

  async create(filePath: string, type: 'file' | 'collection'): Promise<void> {
    if (type === 'collection') {
      fs.mkdirSync(filePath, { recursive: true });
    } else {
      const parentDir = path.dirname(filePath);
      if (parentDir !== '/') {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, '');
    }

    const now = new Date();
    this.setPropertyInternal(filePath, 'created', now);
    this.setPropertyInternal(filePath, 'lastModified', now);
    this.setPropertyInternal(filePath, 'etag', this.generateEtag());
  }

  async delete(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
    
    this.properties.delete(filePath);
  }

  async copy(from: string, to: string): Promise<void> {
    if (!fs.existsSync(from)) {
      throw new Error(`Source path does not exist: ${from}`);
    }

    const stat = fs.statSync(from);
    
    if (stat.isDirectory()) {
      // Copy directory recursively
      this.copyRecursive(from, to);
    } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(to);
      fs.mkdirSync(parentDir, { recursive: true });
      
      // Copy file
      const data = fs.readFileSync(from);
      fs.writeFileSync(to, data);
    }

    // Copy properties
    const sourceProps = this.properties.get(from);
    if (sourceProps) {
      const newProps = new Map(sourceProps);
      newProps.set('etag', this.generateEtag()); // Generate new ETag
      newProps.set('created', new Date());
      this.properties.set(to, newProps);
    }
  }

  private copyRecursive(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    
    const items = fs.readdirSync(from, { encoding: 'utf8' });
    for (const item of items) {
      const srcPath = path.posix.join(from, item as string);
      const destPath = path.posix.join(to, item as string);
      
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        this.copyRecursive(srcPath, destPath);
      } else {
        const data = fs.readFileSync(srcPath);
        fs.writeFileSync(destPath, data);
      }
    }
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(filePath);
  }

  async getMembers(filePath: string): Promise<string[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Path does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a collection: ${filePath}`);
    }

    const items = fs.readdirSync(filePath, { encoding: 'utf8' });
    return items.map(item => path.posix.join(filePath, item as string));
  }

  async getType(filePath: string): Promise<'file' | 'collection' | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stat = fs.statSync(filePath);
    return stat.isDirectory() ? 'collection' : 'file';
  }

  async getStream(filePath: string, range?: { start: number; end?: number }): Promise<Readable> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    // Support range requests
    if (range) {
      return fs.createReadStream(filePath, {
        start: range.start,
        end: range.end
      });
    }

    return fs.createReadStream(filePath);
  }

  async setStream(filePath: string, stream: Readable, range?: { start: number; end?: number; total?: number }): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    if (parentDir !== '/') {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Handle range uploads (partial content)
    if (range && range.start !== undefined) {
      // For range uploads, we need to read existing file, modify the range, and write back
      let existingData = Buffer.alloc(0);
      
      // Read existing file if it exists
      if (fs.existsSync(filePath)) {
        const fileData = fs.readFileSync(filePath);
        existingData = Buffer.from(fileData);
      }
      
      // Determine the total size - use provided total or calculate from range
      const totalSize = range.total || Math.max(existingData.length, (range.end || range.start) + 1);
      
      // Extend buffer if needed
      if (existingData.length < totalSize) {
        const newBuffer = Buffer.alloc(totalSize);
        existingData.copy(newBuffer);
        existingData = newBuffer;
      }
      
      // Collect the incoming stream data
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          try {
            const incomingData = Buffer.concat(chunks);
            
            // Write the incoming data to the specified range
            const endPos = range.end !== undefined ? range.end : range.start + incomingData.length - 1;
            
            // Ensure we don't write beyond the buffer
            const actualEndPos = Math.min(endPos, existingData.length - 1);
            const writeLength = Math.min(incomingData.length, actualEndPos - range.start + 1);
            
            incomingData.copy(existingData, range.start, 0, writeLength);
            
            // Write the complete file back
            fs.writeFileSync(filePath, existingData);
            
            // Update metadata
            const now = new Date();
            this.setPropertyInternal(filePath, 'lastModified', now);
            this.setPropertyInternal(filePath, 'etag', this.generateEtag());
            
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        
        stream.on('error', reject);
      });
    } else {
      // Regular full file upload
      const writeStream = fs.createWriteStream(filePath);
      
      return new Promise((resolve, reject) => {
        stream.pipe(writeStream);
        
        writeStream.on('finish', () => {
          // Update metadata
          const now = new Date();
          this.setPropertyInternal(filePath, 'lastModified', now);
          this.setPropertyInternal(filePath, 'etag', this.generateEtag());
          resolve();
        });
        
        writeStream.on('error', reject);
        stream.on('error', reject);
      });
    }
  }

  async getSize(filePath: string): Promise<number> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    return stat.size;
  }

  async getEtag(filePath: string): Promise<string> {
    const etag = this.getPropertyInternal(filePath, 'etag');
    return etag || this.generateEtag();
  }

  async getDisplayName(filePath: string): Promise<string> {
    return path.basename(filePath) || '/';
  }

  async getLastModified(filePath: string): Promise<Date> {
    let lastModified = this.getPropertyInternal(filePath, 'lastModified');
    if (!lastModified && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      lastModified = stat.mtime;
      this.setPropertyInternal(filePath, 'lastModified', lastModified);
    }
    
    return lastModified || new Date();
  }

  async getCreated(filePath: string): Promise<Date> {
    let created = this.getPropertyInternal(filePath, 'created');
    if (!created && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      created = stat.birthtime || stat.ctime;
      this.setPropertyInternal(filePath, 'created', created);
    }
    
    return created || new Date();
  }

  async getProperty(filePath: string, property: string): Promise<any> {
    return this.getPropertyInternal(filePath, property);
  }

  async setProperty(filePath: string, property: string, value: any): Promise<void> {
    this.setPropertyInternal(filePath, property, value);
  }

  async removeProperty(filePath: string, property: string): Promise<void> {
    const pathProps = this.properties.get(filePath);
    if (pathProps && pathProps.has(property)) {
      pathProps.delete(property);
      if (pathProps.size === 0) {
        this.properties.delete(filePath);
      }
    }
  }
}