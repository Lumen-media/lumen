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
export class LumenPlugin {
  constructor() {}
  async onload(_host) {}
  async onunload() {}
}
`.trimStart();

const HOST_DEPS_PROD: Record<string, string> = {
  'react.js': 'react',
  'react-dom.js': 'react-dom/client',
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
  return `/${relCacheDir}/deps/${flatId}.js`;
}

export function lumenHostModules(): Plugin {
  return {
    name: 'lumen-host-modules',

    transformIndexHtml() {
      const imports: Record<string, string> = {
        '@lumen-media/module-sdk': '/__lumen/module-sdk.js',
      };

      imports['react'] = '/__lumen/react.js';
      imports['react-dom'] = '/__lumen/react-dom.js';
      imports['react-dom/client'] = '/__lumen/react-dom.js';
      imports['react/jsx-runtime'] = '/__lumen/react-jsx-runtime.js';
      imports['react/jsx-dev-runtime'] = '/__lumen/react-jsx-dev-runtime.js';

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
      server.middlewares.use((req, res, next) => {
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

        try {
          if (!filePath) throw new Error('not found');
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
        } catch {
          res.statusCode = 404;
          res.end(`module file not found: ${filePath ?? 'undefined'}`);
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
          res.end('// @lumen/ui not yet packaged — use host components via React props');
          return;
        }

        const DEV_WRAPPERS: Record<string, string> = {
          'react.js': 'react',
          'react-dom.js': 'react-dom/client',
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
      this.emitFile({
        type: 'asset',
        fileName: '__lumen/ui.js',
        source: '// @lumen/ui not yet packaged — use host components via React props',
      });
    },
  };
}
