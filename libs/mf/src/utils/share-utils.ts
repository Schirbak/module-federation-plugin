import callsite = require('callsite');
import path = require('path');
import fs = require('fs');
import { SharedConfig } from './webpack.types';

let inferVersion = false;

export const DEFAULT_SKIP_LIST = [
    '@angular-architects/module-federation',
    '@angular-architects/module-federation-runtime',
    'tslib',
    'zone.js'
];

type VersionMap = Record<string, string>;
type IncludeSecondariesOptions = { skip: string | string[] } | boolean;
type CustomSharedConfig =  SharedConfig & { includeSecondaries: IncludeSecondariesOptions };
type ConfigObject = Record<string, CustomSharedConfig>;
type Config = (string | ConfigObject)[] | ConfigObject;

function findPackageJson(folder: string): string {
    while (
        !fs.existsSync(path.join(folder, 'package.json'))
        && path.dirname(folder) !== folder) {

        folder = path.dirname(folder);
    }

    const filePath = path.join(folder, 'package.json');
    if (fs.existsSync(filePath)) {
        return filePath;
    }

    throw new Error('no package.json found. Searched the following folder and all parents: ' + folder);
}

function readVersionMap(packagePath: string): VersionMap {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const json = require(packagePath);
    const versions = {
        ...json['dependencies']
    };
    return versions;
}

function lookupVersion(key: string, versions: VersionMap): string {

    const parts = key.split('/');
    if (parts.length >= 2 && parts[0].startsWith('@')) {
        key = parts[0] + '/' + parts[1];
    }
    else {
        key = parts[0];
    }

    if (key.toLowerCase() === '@angular-architects/module-federation-runtime') {
        key = '@angular-architects/module-federation';
    }

    if (!versions[key]) {
        throw new Error(`Shared Dependency ${key} has requiredVersion:'auto'. However, this dependency is not found in your package.json`);
    }
    return versions[key];
}

function _findSecondaries(libPath: string, excludes: string[], acc: string[]): void {

    const files = fs.readdirSync(libPath);

    const dirs = files
        .map(f => path.join(libPath, f))
        .filter(f => fs.lstatSync(f).isDirectory() && f !== 'node_modules');

    const secondaries = dirs.filter(d => fs.existsSync(path.join(d, 'package.json')));
    for (const s of secondaries) {
        const secondaryLibName = s.replace(/\\/g, '/').replace(/^.*node_modules[/]/, '');
        if (excludes.includes(secondaryLibName)) {
            continue;
        }
        acc.push(secondaryLibName);
        _findSecondaries(s, excludes, acc);
    }
}

function findSecondaries(libPath: string, excludes: string[]): string[] {
    const acc = [];
    _findSecondaries(libPath, excludes, acc);
    return acc;
}

function findLibraryRoot(libName) {
  const libIndexPath = require.resolve(libName);
  let libPath = path.dirname(libIndexPath);


  while (!fs.existsSync(path.join(libPath, 'package.json'))
   && path.dirname(libPath) !== libPath) {
    libPath = path.dirname(libPath);
  }

  if (!fs.existsSync(path.join(libPath, 'package.json'))) {
    throw new Error('no package root of ' + libName +
      ' found. Searched the following folder and all parents: ' + libPath);
  }

  return libPath;
}

function getSecondaries(includeSecondaries: IncludeSecondariesOptions, packagePath: string, key: string): string[] {
    let exclude = [];

    if (typeof includeSecondaries === 'object' ) {
        if (Array.isArray(includeSecondaries.skip)) {
            exclude = includeSecondaries.skip;
        }
        else if (typeof includeSecondaries.skip === 'string') {
            exclude = [includeSecondaries.skip];
        }
    }

    const libRoot = findLibraryRoot(key);

    const secondaries = findSecondaries(libRoot, exclude);
    return secondaries;
}

function addSecondaries(secondaries: string[], result: Config, shareObject: Config): void {
    for (const s of secondaries) {
        result[s] = shareObject;
    }
}

export function shareAll(config: Config = {}, skip: string[] = [], packageJsonPath = ''): Config {

    if (!packageJsonPath) {
        const stack = callsite();
        packageJsonPath = path.dirname(stack[1].getFileName());
    }

    const packagePath = findPackageJson(packageJsonPath);

    const versions = readVersionMap(packagePath);
    const share = {};

    for (const key in versions) {

        if (skip.includes(key)) {
            continue;
        }

        share[key] = { ...config };
    }

    return module.exports.share(share, packageJsonPath);

}

export function setInferVersion(infer: boolean): void {
    inferVersion = infer;
}

export function share(shareObjects: Config, packageJsonPath = ''): Config {

    if (!packageJsonPath) {
        const stack = callsite();
        packageJsonPath = path.dirname(stack[1].getFileName());
    }

    const packagePath = findPackageJson(packageJsonPath);

    const versions = readVersionMap(packagePath);
    const result = {};
    let includeSecondaries;

    for (const key in shareObjects) {
        includeSecondaries = false;
        const shareObject = shareObjects[key];

        if (shareObject.requiredVersion === 'auto' || (inferVersion && typeof shareObject.requiredVersion === 'undefined')) {
            shareObject.requiredVersion = lookupVersion(key, versions);
        }

        if (shareObject.includeSecondaries) {
            includeSecondaries = shareObject.includeSecondaries;
            delete shareObject.includeSecondaries;
        }

        result[key] = shareObject;

        if (includeSecondaries) {
            const secondaries = getSecondaries(includeSecondaries, packagePath, key);
            addSecondaries(secondaries, result, shareObject);
        }

    }

    return result;
}
