'use client';

import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '@/lib/i18n';
import { CheckCircle2, Cookie, ExternalLink, FileUp, Loader2, LogIn, StepForward, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDownloadStore } from '@/stores/download-store';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';

export function DownloadsCookiesDialog() {
  const { t } = useTranslation();
  const { cookiesDialogOpen, closeCookiesDialog, dependencyStatus, installCookies, openCookiesDialog } =
    useDownloadStore();

  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('open-cookies-dialog', () => openCookiesDialog())
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [openCookiesDialog]);

  const toolsDir = dependencyStatus?.toolsDir ?? '';
  const cookiesPath = toolsDir ? `${toolsDir}\\cookies.txt` : '...\\tools\\cookies.txt';

  const handlePickFile = async () => {
    setBusy(true);
    setError(null);
    setInstalled(false);
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Cookies',
            extensions: ['txt'],
          },
        ],
        title: 'Selecta o arquivo cookies.txt exportado',
      });
      if (!selected) {
        setBusy(false);
        return;
      }
      await installCookies(String(selected));
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      title: 'Faça login no YouTube',
      text: 'Abra o YouTube no seu navegador (Chrome, Edge ou Firefox) e entre na sua conta como de costume.',
      icon: <LogIn className="size-4" />,
    },
    {
      title: 'Instale a extensão',
      text: 'Instale a extensão "Get cookies.txt LOCALLY" na loja de extensões.',
      icon: <StepForward className="size-4" />,
      action: (
        <a
          href={EXTENSION_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('Abrir na Chrome Web Store')}
          <ExternalLink className="size-3" />
        </a>
      ),
    },
    {
      title: 'Exporte os cookies',
      text: 'Estando na página do YouTube, clique na extensão e depois em "Exportar". Você receberá um arquivo chamado www.youtube.com_cookies.txt.',
      icon: <Cookie className="size-4" />,
    },
  ];

  return (
    <Dialog open={cookiesDialogOpen} onOpenChange={(open) => !open && closeCookiesDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="size-5 text-primary" />
            {t('O YouTube bloqueou o download')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'O YouTube agora exige autenticação para baixar vídeos em qualidade alta. Adicione os cookies da sua conta em 3 passos e depois selecione o arquivo baixado:'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                {i + 1}
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {step.icon}
                  {t(step.title)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{t(step.text)}</p>
                {step.action}
              </div>
            </div>
          ))}

          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-sm font-medium">{t('Depois de exportar, selecione o arquivo abaixo:')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('O arquivo pode ter qualquer nome (ex: www.youtube.com_cookies.txt). O app valida e instala automaticamente.')}
            </p>

            <div className="mt-3 flex flex-col gap-2">
              <Button
                className="w-full gap-2"
                disabled={busy}
                onClick={handlePickFile}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileUp className="size-4" />
                )}
                {busy ? t('Selecionando...') : t('Selecionar cookies.txt')}
              </Button>

              {installed && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="size-3.5" />
                  {t('Cookies instalados com sucesso! Agora é só tentar baixar de novo.')}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-1.5 text-xs text-destructive">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <code
                className={cn(
                  'mt-1 block rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] break-all'
                )}
              >
                {t('Será salvo em:')} {cookiesPath}
              </code>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t(
              'Somente cookies de sessão — nenhuma palavra-passe é enviada. Depois de instalar, feche esta janela e tente baixar de novo.'
            )}
          </p>
        </div>

        <div className="flex justify-end">
          {installed ? (
            <Button onClick={closeCookiesDialog}>{t('Fechar')}</Button>
          ) : (
            <Button variant="ghost" onClick={closeCookiesDialog}>
              {t('Agora não')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
