import {mkdir,mkdtemp} from 'node:fs/promises';import path from 'node:path';
export async function freshProfile(name){const base=path.resolve('.test-profiles');await mkdir(base,{recursive:true});return mkdtemp(path.join(base,name+'-'));}
