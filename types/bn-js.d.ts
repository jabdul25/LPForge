declare module 'bn.js' {
  export default class BN {
    constructor(value:number|string|bigint|Uint8Array, base?:number|string, endian?:'le'|'be');
    toString(base?:number):string;
    toNumber():number;
  }
}
