import { spawn } from 'child_process';
import { copy, readFile, writeFile } from 'fs-extra';
import { prettySize } from 'pretty-size';
import { file as gzipSizeFile } from 'gzip-size';
import { dirname, join } from 'path';
import { keys as tsKeys } from 'ts-transformer-keys';
import firebase from 'firebase/compat/app';
import * as glob from 'glob';

// TODO infer these from the package.json
const MODULES = [
  'core', 'app', 'compat', 'analytics', 'auth', 'database', 'firestore', 'functions',
  'remote-config', 'storage', 'messaging', 'performance', 'compat/analytics',
  'compat/auth-guard', 'compat/auth', 'compat/database', 'compat/firestore',
  'compat/functions', 'compat/remote-config', 'compat/storage', 'compat/messaging',
  'compat/performance', 'firestore/lite',
];
const LAZY_MODULES = ['compat/analytics', 'compat/auth', 'compat/functions', 'compat/messaging', 'compat/remote-config'];
const UMD_NAMES = MODULES.map(m => m === 'core' ? 'angular-fire' : `angular-fire-${m.replace('/', '-')}`);
const ENTRY_NAMES = MODULES.map(m => m === 'core' ? '@angular/fire' : `@angular/fire/${m}`);

interface OverrideOptions {
  exportName?: string;
  zoneWrap?: boolean;
  blockUntilFirst?: boolean;
}

function zoneWrapExports() {
  const reexport = async (
    module: string,
    name: string,
    path: string,
    exports: string[],
    overrides: Record<string, OverrideOptions|null> = {}
  ) => {
    const imported = await import(path);
    const toBeExported: Array<[string, string, boolean]> = exports.
      filter(it => !it.startsWith('_') && overrides[it] !== null).
      map(importName => {
        const zoneWrap = typeof imported[importName] === 'function' &&
          (overrides[importName]?.zoneWrap ?? importName[0] !== importName[0].toUpperCase());
        const exportName = overrides[importName]?.exportName ?? importName;
        return [importName, exportName, zoneWrap];
      });
    const zoneWrapped = toBeExported.filter(([, , zoneWrap]) => zoneWrap);
    const rawExport = toBeExported.filter(([, , zoneWrap]) => !zoneWrap);
    await writeFile(`./src/${module}/${name}.ts`, `// DO NOT MODIFY, this file is autogenerated by tools/build.ts
${path.startsWith('firebase/') ? `export * from '${path}';\n` : ''}${
zoneWrapped.length > 0 ? `import { ɵzoneWrap } from '@angular/fire';
import {
  ${zoneWrapped.map(([importName]) => `${importName} as _${importName}`).join(',\n  ')}
} from '${path}';
` : ''}${!path.startsWith('firebase/') && rawExport.length > 0 ? `
export {
  ${rawExport.map(([importName, exportName]) => `${importName}${exportName === importName ? '' : `as ${exportName}`}`).join(',\n  ')}
} from '${path}';
` : ''}
${zoneWrapped.map(([importName, exportName]) => `export const ${exportName} = ɵzoneWrap(_${importName}, ${overrides[importName]?.blockUntilFirst ?? true});`).join('\n')}
`); };
  return Promise.all([
    reexport('analytics', 'firebase', 'firebase/analytics', tsKeys<typeof import('firebase/analytics')>()),
    reexport('app', 'firebase', 'firebase/app', tsKeys<typeof import('firebase/app')>()),
    reexport('auth', 'rxfire', 'rxfire/auth', tsKeys<typeof import('rxfire/auth')>()),
    reexport('auth', 'firebase', 'firebase/auth', tsKeys<typeof import('firebase/auth')>(), {
      debugErrorMap: null,
      inMemoryPersistence: null,
      prodErrorMap: null,
    }),
    reexport('database', 'rxfire', 'rxfire/database', tsKeys<typeof import('rxfire/database')>()),
    reexport('database', 'firebase', 'firebase/database', tsKeys<typeof import('firebase/database')>()),
    reexport('firestore', 'rxfire', 'rxfire/firestore', tsKeys<typeof import('rxfire/firestore')>(), {
      doc: { exportName: 'docSnapshots' },
      collection: { exportName: 'collectionSnapshots' },
    }),
    reexport('firestore', 'firebase', 'firebase/firestore', tsKeys<typeof import('firebase/firestore')>()),
    reexport('functions', 'rxfire', 'rxfire/functions', tsKeys<typeof import('rxfire/functions')>(), {
      httpsCallable: { exportName: 'httpsCallableData' },
    }),
    reexport('functions', 'firebase', 'firebase/functions', tsKeys<typeof import('firebase/functions')>()),
    reexport('messaging', 'firebase', 'firebase/messaging', tsKeys<typeof import('firebase/messaging')>(), {
      onMessage: { blockUntilFirst: false },
    }),
    reexport('remote-config', 'rxfire', 'rxfire/remote-config', tsKeys<typeof import('rxfire/remote-config')>(), {
      getValue: { exportName: 'getValueChanges' },
      getString: { exportName: 'getStringChanges' },
      getNumber: { exportName: 'getNumberChanges' },
      getBoolean: { exportName: 'getBooleanChanges' },
      getAll: { exportName: 'getAllChanges' },
    }),
    reexport('remote-config', 'firebase', 'firebase/remote-config', tsKeys<typeof import('firebase/remote-config')>()),
    reexport('storage', 'rxfire', 'rxfire/storage', tsKeys<typeof import('rxfire/storage')>(), {
      getDownloadURL: null,
      getMetadata: null,
      uploadBytesResumable: null,
      uploadString: null,
    }),
    reexport('storage', 'firebase', 'firebase/storage', tsKeys<typeof import('firebase/storage')>()),
    reexport('performance', 'rxfire', 'rxfire/performance', tsKeys<typeof import('rxfire/performance')>(), {
      getPerformance$: null,
      trace: null,
    }),
    reexport('performance', 'firebase', 'firebase/performance', tsKeys<typeof import('firebase/performance')>()),
    reexport('firestore/lite', 'rxfire', 'rxfire/firestore/lite', tsKeys<typeof import('rxfire/firestore/lite')>(), {
      doc: { exportName: 'docSnapshots' },
      collection: { exportName: 'collectionSnapshots' },
    }),
    reexport('firestore/lite', 'firebase', 'firebase/firestore/lite', tsKeys<typeof import('firebase/firestore/lite')>()),
  ]);
}

function webpackFirestoreProtos() {
  return new Promise<void>((resolve, reject) => {
    glob('./node_modules/@firebase/firestore/dist/src/protos/**/*.proto', {}, async (err, files) => {
      if (err) { reject(err); }
      const fileLoader = files.map(path =>
        `require('file-loader?name=${path.replace('./node_modules/@firebase/firestore/dist/', '')}!${path.replace('./node_modules/', '../../')}');`
      ).join('\n');
      await writeFile('./dist/packages-dist/firestore-protos.js', fileLoader);
      resolve();
    });
  });
}

function proxyPolyfillCompat() {
  const defaultObject = {
    'compat/analytics': tsKeys<firebase.analytics.Analytics>(),
    'compat/auth': tsKeys<firebase.auth.Auth>(),
    'compat/functions': tsKeys<firebase.functions.Functions>(),
    'compat/messaging': tsKeys<firebase.messaging.Messaging>(),
    'compat/performance': tsKeys<firebase.performance.Performance>(),
    'compat/remote-config': tsKeys<firebase.remoteConfig.RemoteConfig>(),
  };

  return Promise.all(Object.keys(defaultObject).map(module =>
    writeFile(`./src/${module}/base.ts`, `// DO NOT MODIFY, this file is autogenerated by tools/build.ts
// Export a null object with the same keys as firebase/${module}, so Proxy can work with proxy-polyfill in Internet Explorer
export const proxyPolyfillCompat = {
${defaultObject[module].map(it => `  ${it}: null,`).join('\n')}
};\n`)
  ));
}

const src = (...args: string[]) => join(process.cwd(), 'src', ...args);
const dest = (...args: string[]) => join(process.cwd(), 'dist', 'packages-dist', ...args);

const rootPackage = import(join(process.cwd(), 'package.json'));

async function replacePackageCoreVersion() {
  const root = await rootPackage;
  const replace = require('replace-in-file');
  return replace({
    files: dest('**', '*'),
    from: 'ANGULARFIRE2_VERSION',
    to: root.version
  });
}

async function replaceSchematicVersions() {
  const root = await rootPackage;
  const path = dest('schematics', 'versions.json');
  const dependencies = await import(path);
  Object.keys(dependencies.default).forEach(name => {
    dependencies.default[name].version = root.dependencies[name] || root.devDependencies[name];
  });
  Object.keys(dependencies.firebaseFunctions).forEach(name => {
    dependencies.firebaseFunctions[name].version = root.dependencies[name] || root.devDependencies[name];
  });
  return writeFile(path, JSON.stringify(dependencies, null, 2));
}

function spawnPromise(command: string, args: string[]) {
  return new Promise(resolve => spawn(command, args, { stdio: 'inherit' }).on('close', resolve));
}

async function compileSchematics() {
  await spawnPromise(`npx`, ['tsc', '-p', src('schematics', 'tsconfig.json')]);
  return Promise.all([
    copy(src('schematics', 'builders.json'), dest('schematics', 'builders.json')),
    copy(src('schematics', 'collection.json'), dest('schematics', 'collection.json')),
    copy(src('schematics', 'migration.json'), dest('schematics', 'migration.json')),
    copy(src('schematics', 'deploy', 'schema.json'), dest('schematics', 'deploy', 'schema.json')),
    replaceSchematicVersions()
  ]);
}

async function measure(module: string) {
  const path = dest('bundles', `${module}.umd.js`);
  const file = await readFile(path);
  const size = prettySize(file.byteLength, true);
  const gzip = prettySize(await gzipSizeFile(path), true);
  return { size, gzip };
}

async function fixImportForLazyModules() {
  await Promise.all(LAZY_MODULES.map(async module => {
    const packageJson = JSON.parse((await readFile(dest(module, 'package.json'))).toString());
    const entries = Array.from(new Set(Object.values(packageJson).filter(v => typeof v === 'string' && v.endsWith('.js')))) as string[];
    // TODO don't hardcode esm2015 here, perhaps we should scan all the entry directories
    //      e.g, if ng-packagr starts building other non-flattened entries we'll lose the dynamic import
    entries.push(`../${module.includes('/') ? '../' : ''}esm2015/${module}/public_api.js`);
    await Promise.all(entries.map(async path => {
      const source = (await readFile(dest(module, path))).toString();
      let newSource: string;
      if (path.endsWith('.umd.js')) {
        // in the UMD for lazy modules replace the dyanamic import
        newSource = source.replace(`import('firebase/${module}')`, 'rxjs.of(undefined)');
      } else {
        // in everything else get rid of the global side-effect import
        newSource = source.replace(new RegExp(`^import 'firebase/${module}'.+$`, 'gm'), '');
      }
      await writeFile(dest(module, path), newSource);
    }));
  }));
}

async function buildLibrary() {
  await proxyPolyfillCompat();
  await zoneWrapExports();
  await spawnPromise('npx', ['ng', 'build']);
  await Promise.all([
    copy(join(process.cwd(), '.npmignore'), dest('.npmignore')),
    copy(join(process.cwd(), 'README.md'), dest('README.md')),
    copy(join(process.cwd(), 'docs'), dest('docs')),
    compileSchematics(),
    replacePackageCoreVersion(),
    fixImportForLazyModules(),
    webpackFirestoreProtos(),
  ]);
}

function measureLibrary() {
  return Promise.all(UMD_NAMES.map(measure));
}

async function buildDocs() {
  // INVESTIGATE json to stdout rather than FS?
  await Promise.all(MODULES.map(module => spawnPromise('npx', ['typedoc', `${module === 'core' ? './src' : `./src/${module}`}`, '--json', `./dist/typedocs/${module}.json`])));
  const entries = await Promise.all(MODULES.map(async (module) => {

    const buffer = await readFile(`./dist/typedocs/${module}.json`);
    const typedoc = JSON.parse(buffer.toString());
    if (!typedoc.children) {
      console.error('typedoc fail', module);
    }
    // TODO infer the entryPoint from the package.json
    const entryPoint = typedoc.children.find((c: any) => c.name === '"public_api"');
    const allChildren = [].concat(...typedoc.children.map(child =>
      // TODO chop out the working directory and filename
      child.children ? child.children.map(c => ({ ...c, path: dirname(child.originalName.split(process.cwd())[1]) })) : []
    ));
    return (entryPoint.children || [])
      .filter(c => c.name[0] !== 'ɵ' && c.name[0] !== '_' /* private */)
      .map(child => ({ ...allChildren.find(c => child.target === c.id) }))
      .reduce((acc, child) => ({ ...acc, [encodeURIComponent(child.name)]: child }), {});
  }));
  const root = await rootPackage;
  const pipes = ['MonoTypeOperatorFunction', 'OperatorFunction', 'AuthPipe', 'UnaryFunction'];
  const tocType = child => {
    const decorators: string[] = child.decorators && child.decorators.map(d => d.name) || [];
    if (decorators.includes('NgModule')) {
      return 'NgModule';
    } else if (child.kindString === 'Type alias') {
      return 'Type alias';
    } else if (child.kindString === 'Variable' && child.defaultValue && child.defaultValue.startsWith('new InjectionToken')) {
      return 'InjectionToken';
    } else if (child.type) {
      return pipes.includes(child.type.name) ? 'Pipe' : child.type.name;
    } else if (child.signatures && child.signatures[0] && child.signatures[0].type && pipes.includes(child.signatures[0].type.name)) {
      return 'Pipe';
    } else {
      return child.kindString;
    }
  };
  const tableOfContents = entries.reduce((acc, entry, index) =>
      ({
        ...acc, [MODULES[index]]: {
          name: ENTRY_NAMES[index],
          exports: Object.keys(entry).reduce((acc, key) => ({ ...acc, [key]: tocType(entry[key]) }), {})
        }
      }),
    {}
  );
  const afdoc = entries.reduce((acc, entry, index) => ({ ...acc, [MODULES[index]]: entry }), { table_of_contents: tableOfContents });
  return writeFile(`./api-${root.version}.json`, JSON.stringify(afdoc, null, 2));
}

Promise.all([
  buildDocs(),
  buildLibrary()
]).then(measureLibrary).then(stats =>
  console.log(`
Package              Size    Gzipped
------------------------------------
${stats.map((s, i) => [MODULES[i].padEnd(21), s.size.padEnd(8), s.gzip].join('')).join('\n')}`
  )
);
