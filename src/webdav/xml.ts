import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export class WebDAVXML {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      removeNSPrefix: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      suppressEmptyNode: true,
      suppressBooleanAttributes: false
    });
  }

  parse(xml: string): any {
    return this.parser.parse(xml);
  }

  build(obj: any): string {
    const xmlDeclaration = '<?xml version="1.0" encoding="utf-8"?>\n';
    return xmlDeclaration + this.builder.build(obj);
  }

  createMultiStatusResponse(responses: any[]): string {
    const multiStatus = {
      'd:multistatus': {
        '@_xmlns:d': 'DAV:',
        'd:response': responses
      }
    };
    return this.build(multiStatus);
  }

  createPropFindResponse(href: string, props: any, status = '200 OK'): any {
    return {
      'd:href': href,
      'd:propstat': {
        'd:prop': props,
        'd:status': `HTTP/1.1 ${status}`
      }
    };
  }

  createErrorResponse(href: string, error: string, status = '404 Not Found'): any {
    return {
      'd:href': href,
      'd:propstat': {
        'd:status': `HTTP/1.1 ${status}`,
        'd:responsedescription': error
      }
    };
  }

  createLockDiscoveryResponse(locks: any[]): any {
    if (locks.length === 0) {
      return {};
    }

    return {
      'd:lockdiscovery': {
        'd:activelock': locks.map(lock => ({
          'd:locktype': { 'd:write': {} },
          'd:lockscope': { [`d:${lock.scope}`]: {} },
          'd:depth': lock.depth,
          'd:owner': lock.owner,
          'd:timeout': `Second-${lock.timeout}`,
          'd:locktoken': { 'd:href': `opaquelocktoken:${lock.token}` }
        }))
      }
    };
  }

  createSupportedLockResponse(): any {
    return {
      'd:supportedlock': {
        'd:lockentry': [
          {
            'd:lockscope': { 'd:exclusive': {} },
            'd:locktype': { 'd:write': {} }
          },
          {
            'd:lockscope': { 'd:shared': {} },
            'd:locktype': { 'd:write': {} }
          }
        ]
      }
    };
  }

  parsePropFind(xml: string): { propnames?: boolean; allprop?: boolean; props?: string[] } {
    const parsed = this.parse(xml);
    const propfind = parsed['d:propfind'] || parsed.propfind;
    
    if (!propfind) {
      return { allprop: true };
    }

    if (propfind['d:propname'] || propfind.propname) {
      return { propnames: true };
    }

    if (propfind['d:allprop'] || propfind.allprop) {
      return { allprop: true };
    }

    const prop = propfind['d:prop'] || propfind.prop;
    if (prop) {
      const props = Object.keys(prop).filter(key => !key.startsWith('@_'));
      return { props };
    }

    return { allprop: true };
  }

  parseLockRequest(xml: string): { owner: string; scope: 'exclusive' | 'shared'; type: 'write' } {
    const parsed = this.parse(xml);
    const lockinfo = parsed['d:lockinfo'] || parsed.lockinfo;
    
    if (!lockinfo) {
      throw new Error('Invalid lock request');
    }

    const lockscope = lockinfo['d:lockscope'] || lockinfo.lockscope;
    const locktype = lockinfo['d:locktype'] || lockinfo.locktype;
    const owner = lockinfo['d:owner'] || lockinfo.owner || 'unknown';

    let scope: 'exclusive' | 'shared' = 'exclusive';
    if (lockscope['d:shared'] || lockscope.shared) {
      scope = 'shared';
    }

    return {
      owner: typeof owner === 'string' ? owner : (owner['#text'] || 'unknown'),
      scope,
      type: 'write'
    };
  }

  parsePropPatch(xmlBody: string): { set?: any[], remove?: any[] } {
    const parsed = this.parser.parse(xmlBody);
    const propertyupdate = parsed['d:propertyupdate'] || parsed.propertyupdate;
    
    if (!propertyupdate) {
      throw new Error('Invalid PROPPATCH request');
    }

    const result: { set?: any[], remove?: any[] } = {};

    // Handle set operations
    const setOps = propertyupdate['d:set'] || propertyupdate.set;
    if (setOps) {
      const setArray = Array.isArray(setOps) ? setOps : [setOps];
      result.set = setArray.map(setOp => {
        const prop = setOp['d:prop'] || setOp.prop;
        return prop || {};
      });
    }

    // Handle remove operations
    const removeOps = propertyupdate['d:remove'] || propertyupdate.remove;
    if (removeOps) {
      const removeArray = Array.isArray(removeOps) ? removeOps : [removeOps];
      result.remove = removeArray.map(removeOp => {
        const prop = removeOp['d:prop'] || removeOp.prop;
        return prop || {};
      });
    }

    return result;
  }
}