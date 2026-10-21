import {mkdir,cp,chmod,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
if(process.platform!=='darwin')throw new Error('Cue Launcher requires macOS.');
const label='com.boredfolio.cue.launcher',domain=`gui/${process.getuid()}`;
const directory=join(homedir(),'Library','Application Support','CueLauncher'),agents=join(homedir(),'Library','LaunchAgents');
const source=process.argv[2]||'/Applications/Cue.app';
const identity=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',join(source,'Contents','Info.plist')],{encoding:'utf8'}).trim();
if(identity!=='com.boredfolio.cue')throw new Error('Choose the installed Cue app.');
const launcher=join(directory,'Cue Launcher.app'),binary=join(launcher,'Contents','MacOS','CueLauncher'),plist=join(agents,label+'.plist');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
await mkdir(directory,{recursive:true});await mkdir(agents,{recursive:true});
try{execFileSync('launchctl',['bootout',domain+'/'+label],{stdio:'pipe'});}catch{}
await cp(join(source,'Contents','Resources','Cue Launcher.app'),launcher,{recursive:true});await chmod(binary,0o755);
await writeFile(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(binary)}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>15</integer><key>ProcessType</key><string>Interactive</string>
<key>StandardErrorPath</key><string>${escape(join(directory,'launcher.log'))}</string>
</dict></plist>`,{mode:0o600});
execFileSync('launchctl',['bootstrap',domain,plist],{stdio:'inherit'});
console.log('Installed the hold-right-Option launcher. It records no audio; it opens Cue only after the shortcut is held for half a second.');
console.log(`To disable: launchctl bootout ${domain}/${label}`);
