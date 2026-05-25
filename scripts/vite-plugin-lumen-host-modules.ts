import { build } from 'esbuild';
import type { Plugin } from 'vite';

const HOST_DEPS: Record<string, string> = {
  'react.js': 'react',
  'react-dom.js': 'react-dom/client',
};

const MODULE_SDK_STUB = `
export class LumenPlugin {
  constructor() {}
  async onload(_host) {}
  async onunload() {}
}
`.trimStart();

const cache = new Map<string, string>();

async function bundleDep(entrypoint: string): Promise<string> {
  if (cache.has(entrypoint)) return cache.get(entrypoint)!;

  const result = await build({
    entryPoints: [entrypoint],
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

export function lumenHostModules(): Plugin {
  return {
    name: 'lumen-host-modules',

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__lumen/')) return next();

        const file = req.url.slice('/__lumen/'.length);

        res.setHeader('Content-Type', 'application/javascript');

        if (file === 'module-sdk.js') {
          res.end(MODULE_SDK_STUB);
          return;
        }

        if (file === 'ui.js') {
          res.end('// @lumen/ui not yet packaged — use host components via React props');
          return;
        }

        const dep = HOST_DEPS[file];
        if (!dep) {
          res.statusCode = 404;
          res.end(`Not found: /__lumen/${file}`);
          return;
        }

        try {
          const code = await bundleDep(dep);
          res.end(code);
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },

    async generateBundle() {
      for (const [file, dep] of Object.entries(HOST_DEPS)) {
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
