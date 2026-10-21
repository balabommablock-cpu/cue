import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export async function buildNative(){
  if(process.platform!=='darwin')throw new Error('Build Share View on a Mac.');
  const app=join(import.meta.dirname,'native-build','Cue Share View.app');
  const contents=join(app,'Contents');
  const fingerprintFile=join(import.meta.dirname,'native-build','share-view-build.json');
  const executable=join(contents,'MacOS','CueShareView');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const fingerprint=hash(Buffer.concat([
    await readFile(new URL('./native/ShareView.swift',import.meta.url)),
    await readFile(new URL('./build-native.mjs',import.meta.url)),
    Buffer.from(process.arch),execFileSync('xcrun',['swiftc','--version']),
  ]));
  // Retain an unchanged helper's binary and ad-hoc signature between app
  // releases. Re-linking identical Swift source gives it a new identity and
  // can cause macOS to request screen-recording permission again.
  try{
    const saved=JSON.parse(await readFile(fingerprintFile,'utf8'));
    if(saved.fingerprint===fingerprint&&existsSync(executable)&&saved.binaryHash===hash(await readFile(executable))&&saved.plistHash===hash(await readFile(join(contents,'Info.plist')))){
      execFileSync('codesign',['--verify','--strict',app],{stdio:'pipe'});
      console.log('Reusing unchanged Cue Share View helper.');return app;
    }
  }catch{}
  await mkdir(join(contents,'MacOS'),{recursive:true});
  await writeFile(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>CueShareView</string><key>CFBundleIdentifier</key><string>io.github.cue.community.shareview</string><key>CFBundleName</key><string>Cue Share View</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1.2.0</string><key>CFBundleShortVersionString</key><string>1.2.0</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>NSScreenCaptureUsageDescription</key><string>Build a local presentation that excludes Cue. Select this window in your meeting to share it. No screen video is sent to AI services.</string>
</dict></plist>`);
  execFileSync('xcrun',['swiftc','-swift-version','5','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos13.0`,'native/ShareView.swift','-o',join(contents,'MacOS','CueShareView'),'-framework','AppKit','-framework','ScreenCaptureKit','-framework','AVFoundation'],{cwd:import.meta.dirname,stdio:'inherit'});
  execFileSync('codesign',['--force','--sign','-','--identifier','io.github.cue.community.shareview',app],{stdio:'inherit'});
  await writeFile(fingerprintFile,JSON.stringify({fingerprint,binaryHash:hash(await readFile(executable)),plistHash:hash(await readFile(join(contents,'Info.plist')))},null,2)+'\n');
  return app;
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(await buildNative());
