import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import type { Plugin, ViteDevServer } from 'vite';

const _require = createRequire(import.meta.url);

function makeNamedExportWrapper(specifier: string, viteUrl: string): string {
  const mod = _require(specifier) as Record<string, unknown>;
  const keys = Object.keys(mod).filter(k => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k));
  const exports = keys.map(k => `export const ${k} = _mod.${k};`).join('\n');
  return `import _mod from ${JSON.stringify(viteUrl)};\n${exports}\nexport default _mod;\n`;
}

const MODULE_SDK_STUB = `
var noop = function() {};
var stub = function(v) { return function() { return v; }; };
var noopDisposable = { dispose: noop };
var noopPromise = function(v) { return function() { return Promise.resolve(v); }; };

export function createMockHost(overrides) {
  var id = (overrides && overrides.meta && overrides.meta.id) || 'test-module';
  var version = (overrides && overrides.meta && overrides.meta.version) || '0.0.0';
  var win = (overrides && overrides.window) || 'main';

  var base = {
    meta: { id: id, version: version },
    window: win,
    app: { version: '0.0.0', locale: 'en-US' },

    panels: {
      add: function() { return noopDisposable; },
    },

    commands: {
      add: function() { return noopDisposable; },
      invoke: stub(undefined),
      addPrefix: function() { return noopDisposable; },
    },
    menus: {
      register: function() { return noopDisposable; },
      addItem: function() { return noopDisposable; },
    },
    ui: {
      notify: noop,
      confirm: stub(Promise.resolve(false)),
      prompt: stub(Promise.resolve(null)),
      openCommandPalette: noop,
      openDialog: noop,
      openBackgroundPicker: noop,
    },

    bus: { emit: noop, on: function() { return noopDisposable; } },
    events: { emit: noop, on: function() { return noopDisposable; } },

    data: {
      json: {
        load: noopPromise({}),
        save: noopPromise(),
        get: function(_key, fallback) { return Promise.resolve(fallback); },
        set: noopPromise(),
        delete: noopPromise(),
      },
      sqlite: noopPromise({
        exec: noopPromise(),
        query: noopPromise([]),
        migrate: noopPromise(),
      }),
    },
    settings: {
      register: function() { return noopDisposable; },
      get: stub(undefined),
      set: noop,
      onChange: function() { return noopDisposable; },
    },

    lyrics: {
      list: noopPromise([]),
      get: noopPromise(null),
      currentSlide: stub(null),
      advance: noop,
      back: noop,
    },
    queue: {
      items: stub([]),
      currentIndex: stub(-1),
      add: noop, remove: noop, reorder: noop, shuffle: noop, markPlayed: noop,
      state: stub({ items: [], currentIndex: null }),
      onChange: function() { return noopDisposable; },
      next: noop,
      previous: noop,
      goTo: noop,
      registerTrigger: function() { return noopDisposable; },
    },
    library: {
      list: noopPromise([]),
      get: noopPromise(null),
      metadata: noopPromise({}),
      thumbnail: noopPromise(''),
    },
    player: {
      current: stub(null),
      state: stub('idle'),
      play: noop, pause: noop, seek: noop,
      volume: stub(1),
      next: noop, prev: noop,
    },
    presentation: {
      state: stub('idle'),
      onStateChange: function() { return noopDisposable; },
      project: noop,
      clear: noop,
      isWindowOpen: stub(false),
    },
    overlay: {
      state: stub('idle'),
      onStateChange: function() { return noopDisposable; },
      project: noop,
      clear: noop,
      isWindowOpen: stub(false),
    },
    surface: {
      state: stub(win === 'surface' ? 'live' : 'idle'),
      onStateChange: function() { return noopDisposable; },
      openWindow: noop,
      clear: noop,
      isWindowOpen: stub(win === 'surface'),
    },
    fonts: {
      list: noopPromise([]),
    },
    themes: {
      current: stub({ id: 'default', name: 'Default', colorMode: 'dark', accentId: 'cyan' }),
      list: stub([]),
      apply: noop,
      defaultBackground: stub(null),
      onDefaultBackgroundChange: function() { return noopDisposable; },
    },

    fs: {
      read: noopPromise(new Uint8Array()),
      write: noopPromise(),
      exists: noopPromise(false),
      list: noopPromise([]),
      remove: noopPromise(),
    },
    net: {
      request: noopPromise({ ok: false, status: 0, statusText: '', headers: {}, url: '', redirected: false, data: null }),
    },
    i18n: {
      t: function(key, _params) { return key; },
      locale: stub('en-US'),
    },
    log: {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    },
  };

  if (!overrides) return base;
  var merged = {};
  var keys = Object.keys(base);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (overrides[k] != null) {
      if (typeof overrides[k] === 'object' && !Array.isArray(overrides[k]) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        merged[k] = Object.assign({}, base[k], overrides[k]);
      } else {
        merged[k] = overrides[k];
      }
    } else {
      merged[k] = base[k];
    }
  }
  return merged;
}

export class LumenPlugin {
  constructor() {}
  async onload(_host) {}
  async onunload() {}
}
`.trimStart();

const HOST_DEPS_PROD: Record<string, string> = {
  'react.js': 'react',
  'react-dom.js': 'react-dom',
  'react-jsx-runtime.js': 'react/jsx-runtime',
  'react-jsx-dev-runtime.js': 'react/jsx-dev-runtime',
};

const cache = new Map<string, string>();

async function bundleDep(entrypoint: string): Promise<string> {
  if (cache.has(entrypoint)) return cache.get(entrypoint)!;

  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(entrypoint)}; export { default } from ${JSON.stringify(entrypoint)};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    write: false,
    minify: true,
    platform: 'browser',
  });

  const code = result.outputFiles[0].text;
  cache.set(entrypoint, code);
  return code;
}

function viteDepUrl(server: ViteDevServer, specifier: string): string {
  const relCacheDir = path.relative(server.config.root, server.config.cacheDir).replace(/\\/g, '/');
  const flatId = specifier.replace(/\//g, '_');
  const base = `/${relCacheDir}/deps/${flatId}.js`;

  try {
    const metadataPath = path.join(server.config.cacheDir, 'deps', '_metadata.json');
    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { browserHash?: string; hash?: string };
    const hash = meta.browserHash ?? meta.hash;
    if (hash) return `${base}?v=${hash}`;
  } catch {
    // metadata not ready yet — fall through
  }

  return base;
}

export function lumenHostModules(): Plugin {
  let projectRoot = process.cwd();

  return {
    name: 'lumen-host-modules',

    config(cfg) {
      if (cfg.root) projectRoot = cfg.root;
    },

    transformIndexHtml() {
      const imports: Record<string, string> = {
        '@lumen-media/module-sdk': '/__lumen/module-sdk.js',
      };

      imports['react'] = '/__lumen/react.js';
      imports['react-dom'] = '/__lumen/react-dom.js';
      imports['react-dom/client'] = '/__lumen/react-dom.js';
      imports['react/jsx-runtime'] = '/__lumen/react-jsx-runtime.js';
      imports['react/jsx-dev-runtime'] = '/__lumen/react-jsx-dev-runtime.js';
      imports['@lumen-media/ui'] = '/__lumen/ui.js';
      imports['@lumen-media/module-sdk/ui'] = '/__lumen/ui.js';

      return [
        {
          tag: 'script',
          attrs: { type: 'importmap' },
          children: JSON.stringify({ imports }),
          injectTo: 'head-prepend',
        },
      ];
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__modules/')) return next();
        const urlPath = req.url.slice('/__modules/'.length).split('?')[0];
        const [moduleId, ...fileParts] = urlPath.split('/');
        const fileRelative = fileParts.join('/');

        const appData = process.env.APPDATA ?? path.join(os.homedir(), '.local', 'share');
        const candidates = [
          path.join(appData, 'com.lumen.media', 'modules'),
          path.join(appData, 'Lumen', 'modules'),
        ];
        const filePath = candidates
          .map(dir => path.join(dir, moduleId, fileRelative))
          .find(p => fs.existsSync(p));

        if (filePath) {
          try {
            const content = fs.readFileSync(filePath);
            const ext = path.extname(fileRelative);
            const mime = ext === '.js' || ext === '.mjs' ? 'application/javascript'
              : ext === '.css' ? 'text/css'
              : ext === '.json' ? 'application/json'
              : 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 200;
            res.end(content);
            return;
          } catch {
            // fall through to dev server
          }
        }

        try {
          const devRes = await fetch(`http://127.0.0.1:5179/module-files/${moduleId}/${fileRelative}`);
          if (!devRes.ok) throw new Error('not found');
          const content = Buffer.from(await devRes.arrayBuffer());
          const contentType = devRes.headers.get('content-type') || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 200;
          res.end(content);
        } catch {
          res.statusCode = 404;
          res.end(`module file not found: ${moduleId}/${fileRelative}`);
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__lumen/')) return next();

        const file = req.url.slice('/__lumen/'.length).split('?')[0];

        res.setHeader('Content-Type', 'application/javascript');

        if (file === 'module-sdk.js') {
          res.end(MODULE_SDK_STUB);
          return;
        }

        if (file === 'ui.js') {
          const uiEntry = path.resolve(server.config.root, 'src/lib/module-ui.ts');
          try {
            const result = await server.transformRequest(uiEntry);
            if (result?.code) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(result.code);
              return;
            }
          } catch (err) {
            console.error('[lumen-host-modules] Failed to serve ui.js:', err);
          }
          res.statusCode = 500;
          res.end('// Failed to load ui.js');
          return;
        }

        const DEV_WRAPPERS: Record<string, string> = {
          'react.js': 'react',
          'react-dom.js': 'react-dom',
          'react-jsx-runtime.js': 'react/jsx-runtime',
          'react-jsx-dev-runtime.js': 'react/jsx-dev-runtime',
        };

        const dep = DEV_WRAPPERS[file];
        if (dep) {
          const viteUrl = viteDepUrl(server, dep);
          res.end(makeNamedExportWrapper(dep, viteUrl));
          return;
        }

        res.statusCode = 404;
        res.end(`Not found: /__lumen/${file}`);
      });
    },

    async generateBundle() {
      for (const [file, dep] of Object.entries(HOST_DEPS_PROD)) {
        const code = await bundleDep(dep);
        this.emitFile({ type: 'asset', fileName: `__lumen/${file}`, source: code });
      }

      this.emitFile({ type: 'asset', fileName: '__lumen/module-sdk.js', source: MODULE_SDK_STUB });

      const uiEntry = path.resolve(projectRoot, 'src/lib/module-ui.ts');
      if (fs.existsSync(uiEntry)) {
        const uiResult = await build({
          entryPoints: [uiEntry],
          bundle: true,
          format: 'esm',
          write: false,
          minify: true,
          platform: 'browser',
          external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
          alias: { '@': path.resolve(projectRoot, 'src') },
          loader: { '.tsx': 'tsx', '.ts': 'ts' },
        });
        this.emitFile({ type: 'asset', fileName: '__lumen/ui.js', source: uiResult.outputFiles[0].text });
      }
    },
  };
}
