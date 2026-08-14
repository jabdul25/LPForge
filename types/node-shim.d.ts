declare namespace NodeJS { interface ProcessEnv { [key: string]: string | undefined } }
declare const process: {
  env: NodeJS.ProcessEnv;
  argv: string[];
  exitCode?: number;
  cwd(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
};
declare module 'node:http' {
  export interface IncomingMessage { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string,string>): ServerResponse;
    end(data?: string): void;
  }
  export interface Server { listen(port: number, callback?: () => void): Server; close(callback?: (err?: Error) => void): void; }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Server;
}
declare module 'node:crypto' {
  export interface Hash { update(data:string|Uint8Array):Hash; digest(encoding:'hex'):string; }
  export function createHash(algorithm:string):Hash;
  export function createPrivateKey(input:{key:Uint8Array;format:'der';type:'pkcs8'}):unknown;
  export function sign(algorithm:null,data:Uint8Array,key:unknown):Uint8Array;
  export interface Hmac { update(data:string|Uint8Array):Hmac; digest():Uint8Array; digest(encoding:'hex'):string; }
  export function createHmac(algorithm:string,key:string|Uint8Array):Hmac;
  export function timingSafeEqual(a:Uint8Array,b:Uint8Array):boolean;
}
declare module 'node:child_process' {
  export interface ReadableLike { on(event:'data', listener:(chunk:unknown)=>void):ReadableLike; }
  export interface ChildProcessLike { stdout:ReadableLike|null; stderr:ReadableLike|null; on(event:'error',listener:(error:Error)=>void):ChildProcessLike; on(event:'close',listener:(code:number|null)=>void):ChildProcessLike; }
  export function spawn(command:string,args:string[],options:{cwd?:string;env?:NodeJS.ProcessEnv;stdio?:['ignore'|'pipe','ignore'|'pipe','ignore'|'pipe']}):ChildProcessLike;
}

declare module 'node:fs' {
  export function readFileSync(path:string,encoding:'utf8'):string;
  export function readdirSync(path:string):string[];
  export interface Stats {mode:number;isFile():boolean;isSymbolicLink():boolean;}
  export function lstatSync(path:string):Stats;
}
declare module 'node:path' { export function resolve(...path:string[]):string; }
