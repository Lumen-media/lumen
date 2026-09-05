'use client';

import { useTranslation } from '@/lib/i18n';
import { CheckCircle2, Cookie, DownloadCloud, Loader2, ShieldAlert, ShieldCheck, Video, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDownloadStore } from '@/stores/download-store';
import type { CookieValidation } from '@/services/types';
import { CardContent } from '../ui/card';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

const COOKIE_STATUS_META: Record<
  CookieValidation['status'],
  { label: string; help?: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }
> = {
  valid: { label: 'Cookies válidos', tone: 'ok' },
  rotated: {
    label: 'Cookies rotacionados — re-exporte',
    help: 'Os cookies foram revogados pelo Google. Reexporte-os pela instalação manual abaixo e valide novamente.',
    tone: 'bad',
  },
  blocked: {
    label: 'Exigindo confirmação de conta (PO token)',
    help: 'O YouTube está pedindo confirmação da conta. Reexporte os cookies de uma sessão logada pela instalação manual abaixo.',
    tone: 'bad',
  },
  no_account: {
    label: 'Nenhuma conta logada detectada',
    help: 'O app não encontrou uma sessão logada na leitura automática do navegador. Faça login no YouTube no seu navegador e valide de novo, ou use a instalação manual abaixo.',
    tone: 'warn',
  },
  missing: {
    label: 'Nenhuma conta detectada (auto e manual)',
    help: 'Nem a leitura automática do navegador nem um arquivo cookies.txt foram encontrados. Instale os cookies manualmente com os passos abaixo.',
    tone: 'neutral',
  },
  error: {
    label: 'Falha na validação',
    help: 'Não foi possível validar os cookies. Tente instalar os cookies manualmente com os passos abaixo e valide novamente.',
    tone: 'bad',
  },
};

export function DownloadsSection() {
  const { t } = useTranslation();
  const {
    dependencyStatus,
    isInstallingDeps,
    checkDeps,
    installDeps,
    cookieValidation,
    cookieValidationLoading,
    refreshCookieValidation,
  } = useDownloadStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!dependencyStatus) {
      checkDeps().catch(() => {});
    }
  }, [dependencyStatus, checkDeps]);

  const toolsDir = dependencyStatus?.toolsDir ?? '';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await checkDeps();
    } finally {
      setRefreshing(false);
    }
  };

  const handleInstall = async () => {
    try {
      await installDeps();
      await checkDeps();
    } catch (e) {
      console.error('[downloads-section] install deps failed:', e);
    }
  };

  const handleValidateCookies = async () => {
    try {
      await refreshCookieValidation();
    } catch (e) {
      console.error('[downloads-section] validate cookies failed:', e);
    }
  };

  const steps = [
    {
      title: t('1. Faça login no YouTube'),
      text: t(
        'Abra o YouTube no seu navegador (Chrome, Edge ou Firefox) e faça login na sua conta como faria normalmente. É a sessão logada que será usada.'
      ),
    },
    {
      title: t('2. Instale a extensão'),
      text: t(
        'Instale a extensão "Get cookies.txt LOCALLY" na loja de extensões do seu navegador. Ela apenas exporta os cookies da sessão logada.'
      ),
    },
    {
      title: t('3. Exporte os cookies'),
      text: t(
        'Estando na página do YouTube, clique na extensão e depois em "Exportar". Um arquivo chamado cookies.txt será baixado.'
      ),
    },
    {
      title: t('4. Copie para a pasta de ferramentas'),
      text: t('Copie o arquivo cookies.txt para o seguinte caminho, substituindo o arquivo se já existir:'),
      code: toolsDir ? `${toolsDir}\\cookies.txt` : '',
    },
    {
      title: t('5. Pronto!'),
      text: t(
        'O app detecta o arquivo automaticamente e o usa para autenticar os downloads, dispensando a leitura automática do navegador. Nenhuma palavra-passe é enviada: apenas os cookies de sessão.'
      ),
    },
  ];

  const ytStatus = dependencyStatus?.ytdlpInstalled;
  const ffmpegStatus = dependencyStatus?.ffmpegInstalled;
  const ytOutdated = dependencyStatus?.ytdlpOutdated;
  const nodeStatus = dependencyStatus?.nodeInstalled;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('Downloads & Ferramentas')}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t(
            'Para baixar vídeos em qualidade alta, o YouTube exige uma conta logada. O app usa o yt-dlp, que lê os cookies automaticamente do navegador em que você está logado (Chrome, Edge ou Firefox) — na maioria dos casos, nenhuma configuração é necessária.'
          )}
        </p>
      </div>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 pl-3">
          <DownloadCloud className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Ferramentas instaladas')}</span>
        </div>

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div className="flex items-center gap-2.5">
            {ytStatus ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-destructive" />
            )}
            <div>
              <p className="text-sm font-medium">yt-dlp</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ytStatus
                  ? `${dependencyStatus?.ytdlpVersion ?? 'Instalado'}${ytOutdated ? ` - ${t('atualização disponível')}` : ''}`
                  : t('Não instalado')}
              </p>
            </div>
          </div>
          {(!ytStatus || ytOutdated) && (
            <Button size="sm" onClick={handleInstall} disabled={isInstallingDeps}>
              {isInstallingDeps ? t('Instalando...') : ytOutdated ? t('Atualizar') : t('Instalar')}
            </Button>
          )}
        </CardContent>

        <Separator />

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div className="flex items-center gap-2.5">
            {ffmpegStatus ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-destructive" />
            )}
            <div>
              <p className="text-sm font-medium">FFmpeg</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ffmpegStatus ? t('Instalado') : t('Não instalado')}
              </p>
            </div>
          </div>
          {!ffmpegStatus && (
            <Button size="sm" onClick={handleInstall} disabled={isInstallingDeps}>
              {isInstallingDeps ? t('Instalando...') : t('Instalar')}
            </Button>
          )}
        </CardContent>

        <Separator />

        <CardContent className="flex items-center justify-between rounded-lg p-4">
          <div className="flex items-center gap-2.5">
            {nodeStatus ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-destructive" />
            )}
            <div>
              <p className="text-sm font-medium">Node.js</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {nodeStatus ? t('Instalado') : t('Não instalado')}
              </p>
            </div>
          </div>
          {!nodeStatus && (
            <Button size="sm" onClick={handleInstall} disabled={isInstallingDeps}>
              {isInstallingDeps ? t('Instalando...') : t('Instalar')}
            </Button>
          )}
        </CardContent>

        <Separator />

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Atualizar ferramentas')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Verifica e instala a versão mais recente do yt-dlp (necessário quando o YouTube muda).')}
            </p>
          </div>
          <Button size="sm" onClick={handleInstall} disabled={isInstallingDeps}>
            {isInstallingDeps ? t('Atualizando...') : t('Verificar')}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg p-4">
          <div>
            <p className="text-sm font-medium">{t('Verificar status')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Reavalia a presença e a versão das ferramentas de download.')}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? t('Verificando...') : t('Verificar')}
          </Button>
        </div>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 pl-3">
          <Cookie className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Login do YouTube (cookies)')}</span>
        </div>

        <CardContent className="rounded-lg p-4 space-y-3">
          <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
            <p className="text-sm font-medium">{t('Como funciona (leitura automática)')}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
              <li>{t('O app usa o yt-dlp para baixar os vídeos do YouTube.')}</li>
              <li>
                {t(
                  'O yt-dlp lê os cookies da sua sessão logada diretamente do seu navegador (Chrome, Edge, Firefox, Brave ou Chromium). Se você já está logado no YouTube em um deles, os downloads em alta qualidade funcionam sem nenhuma configuração.'
                )}
              </li>
              <li>
                {t(
                  'As etapas abaixo são apenas para quando essa leitura automática falha: navegador bloqueado ou fechado, conta não detectada ou cookies revogados pelo Google.'
                )}
              </li>
            </ul>
          </div>

          <p className="text-sm font-medium pt-1">{t('Instalação manual (só se a automática falhar)')}</p>

          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                {i + 1}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.text}</p>
                {step.code && (
                  <code
                    className={cn(
                      'mt-1.5 block rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] break-all'
                    )}
                  >
                    {step.code}
                  </code>
                )}
              </div>
            </div>
          ))}

          <Separator />

          <div className="flex items-center justify-between rounded-lg p-1">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('Validar cookies')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t(
                  'Testa os cookies atuais (arquivo instalado ou leitura automática do navegador) sem baixar nada, para saber se ainda estão válidos.'
                )}
              </p>
              {cookieValidation && (
                <div className="mt-2 flex items-start gap-2">
                  {cookieValidation.status === 'valid' ? (
                    <ShieldCheck className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : cookieValidation.status === 'no_account' ? (
                    <ShieldAlert className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="size-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        cookieValidation.status === 'valid' && 'text-emerald-500',
                        cookieValidation.status === 'no_account' && 'text-amber-500',
                        cookieValidation.status !== 'valid' &&
                          cookieValidation.status !== 'no_account' &&
                          'text-destructive'
                      )}
                    >
                      {COOKIE_STATUS_META[cookieValidation.status].label}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {cookieValidation.detail}
                    </p>
                    {COOKIE_STATUS_META[cookieValidation.status].help && (
                      <p className="text-xs text-destructive/90 break-words">
                        {COOKIE_STATUS_META[cookieValidation.status].help}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleValidateCookies}
              disabled={cookieValidationLoading}
              className="shrink-0"
            >
              {cookieValidationLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('Validando...')}
                </>
              ) : (
                t('Validar')
              )}
            </Button>
          </div>
        </CardContent>
      </CardContent>

      <CardContent variant="muted" className="gap-3 p-4 rounded-xl">
        <div className="flex items-center gap-2.5 pl-3">
          <Video className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('Sobre a qualidade')}</span>
        </div>
        <CardContent className="rounded-lg p-4">
          <p className="text-xs text-muted-foreground">
            {t(
              'Sem uma sessão logada, o YouTube limita muitos vídeos à qualidade 360p ou bloqueia o download. Com os cookies de uma conta logada — lidos do navegador ou instalados manualmente — a qualidade alta e a maioria dos vídeos são desbloqueados automaticamente.'
            )}
          </p>
        </CardContent>
      </CardContent>
    </div>
  );
}
