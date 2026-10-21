import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

export async function signDesktop(app){
  // Electron's copied frameworks need fresh signatures. Leave our separately
  // signed resource helpers alone so an unchanged Share View keeps its identity.
  const frameworks=join(app,'Contents','Frameworks');
  for(const name of await readdir(frameworks))if(/\.(framework|app|dylib)$/.test(name))
    execFileSync('codesign',['--force','--deep','--sign','-',join(frameworks,name)],{stdio:'pipe'});
  execFileSync('codesign',['--force','--sign','-','--identifier','io.github.cue.community',app],{stdio:'pipe'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
}
