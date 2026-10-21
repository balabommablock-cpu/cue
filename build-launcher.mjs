import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
export async function buildLauncher(){
  if(process.platform!=='darwin')throw new Error('Build Cue Launcher on macOS.');
  const app=join(import.meta.dirname,'native-build','Cue Launcher.app');
  const directory=join(app,'Contents','MacOS');await mkdir(directory,{recursive:true});
  const binary=join(directory,'CueLauncher');
  await writeFile(join(app,'Contents','Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>CueLauncher</string><key>CFBundleIdentifier</key><string>io.github.cue.community.launcher</string><key>CFBundleName</key><string>Cue Launcher</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1.2.0</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.0</string></dict></plist>`);
  execFileSync('xcrun',['swiftc','-swift-version','5','-O',join(import.meta.dirname,'native','ShortcutHold.swift'),join(import.meta.dirname,'native','CueLauncher.swift'),'-o',binary,'-framework','AppKit','-framework','Carbon'],{stdio:'inherit'});
  execFileSync('codesign',['--force','--sign','-','--identifier','io.github.cue.community.launcher',app],{stdio:'pipe'});
  return app;
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(await buildLauncher());
