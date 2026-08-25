# Chat — Guia de Uso

Chat privado entre o **operador** (desktop) e os **dispositivos pareados** (controles remotos via WebSocket). Não é um chat público: apenas dispositivos autenticados com permissão `chat` participam.

---

## Abrir o Chat

- **Botão no header:** clique no ícone 💬 (ou `Ctrl+Shift+C`).
- **Comportamento da tab:** o aside tem 3 tabs visíveis: Queue, Notes e um slot que muda entre **Chat** e **Themes**.
  - Ao clicar no botão do header, o slot vira **Chat** (selecionado).
  - Ao mudar para Queue ou Notes, o slot volta para **Themes**.
  - Para voltar ao chat, clique novamente no botão do header.

> Se o chat não está habilitado nas configurações, o ícone do header aparece mas não abre mensagens até ser ativado.

---

## Enviar Mensagens

1. Digite na caixa de texto na parte inferior do chat.
2. Pressione `Enter` para enviar, ou `Shift+Enter` para nova linha.
3. **Responder:** clique no ícone de reply ↩ que aparece ao passar o mouse sobre uma mensagem, ou clique com botão direito → Reply.
4. **Limite:** 4000 caracteres por mensagem. O contador aparece no canto inferior direito da caixa de texto e fica vermelho se exceder.

---

## Enviar Arquivos

1. Clique no ícone 📎 (clip) ao lado da caixa de texto.
2. Selecione o arquivo no dialog.
3. Opcionalmente adicione uma legenda na caixa de texto.
4. **Limite:** 25 MB por arquivo.
5. **Tipos bloqueados:** `.exe`, `.bat`, `.cmd`, `.com`, `.msi`, `.scr`, `.pif`, `.ps1`, `.vbs`, `.js`, `.hta`, `.cpl`, `.lnk`, `.inf`, `.reg`.

---

## Reagir a Mensagens

1. Passe o mouse sobre a mensagem.
2. Os botões de emoji aparecem abaixo (ou no canto).
3. Clique para adicionar/remover a reação (toggle — mesmo emoji do mesmo remetente = remove).

---

## Deletar Mensagens

1. Clique com botão direito na mensagem → **Delete**.
2. A mensagem é removida do chat e do histórico.
3. Se a mensagem tinha um arquivo anexado, o arquivo também é removido do disco.

---

## Links do YouTube

- **Links em formato markdown** (`[texto](url)`) com URL do YouTube são clicáveis e abrem um dialog com preview (thumbnail, título, canal, duração).
- **No dialog:**
  - **Play Now:** abre a mídia no player do Lumen.
  - **Add to Queue:** adiciona à fila de reprodução.
- **Links de outros sites:** abrem no navegador padrão.
- **URLs cruas** (coladas como texto puro, sem formatação markdown) **não são clicáveis** — são exibidas como texto normal.

---

## Preview de Arquivos

### Imagens
- Miniatura exibida na bolha da mensagem.
- Clique para abrir em tamanho maior no dialog.
- **Tipos:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`.

### PDFs
- Miniatura da primeira página exibida na bolha.
- Clique abre o visualizador de PDF do Lumen.

### Apresentações (PPT/PPTX)
- Miniatura do primeiro slide gerada automaticamente.
- Clique abre no dialog com botão **Present** → abre a apresentação em janela separada.
- **Nota:** gerar a miniatura de PPT é pesado (abre o arquivo, renderiza slide, captura imagem). O resultado é cacheado — na segunda vez que o mesmo arquivo for visualizado, carrega instantaneamente.

---

## Indicado de Leitura (Read Receipts)

- ✓ (check simples) = mensagem enviada.
- ✓✓ (check duplo azul) = pelo menos um dispositivo leu a mensagem.
- O indicador aparece ao lado do timestamp, apenas para mensagens do operador.

---

## Indicador de Digitação

Quando um dispositivo está digitando, aparece o nome do dispositivo + animação de pontos suspensivos na parte inferior do chat. O indicador some automaticamente após 3 segundos sem atividade.

---

## Notificações

Configurável em **Settings → Advanced → Chat → Notifications**:

| Modo | Comportamento |
|---|---|
| **Off** | Sem notificações. |
| **In-App** | Toast dentro do aplicativo. |
| **System** | Notificação do sistema operacional. |

> Um ponto pulsante no ícone do header indica mensagens não lidas.

---

## Configurações do Chat

Em **Settings → Advanced → Chat**:

| Configuração | Descrição |
|---|---|
| **Enable Chat** | Liga/desliga o chat globalmente. Quando desligado, dispositivos não podem enviar mensagens. |
| **Persist Messages** | Se desligado, as mensagens são apagadas ao reiniciar o app. Se ligado, sobrevivem a restarts. |
| **History Limit** | Quantas mensagens manter em memória (padrão: 200). |
| **Notifications** | Modo de notificação (Off / In-App / System). |
| **Per-Device Permissions** | Em Devices, cada dispositivo tem uma flag "Chat" para permitir/negar acesso ao chat. |

---

## Atalhos de Teclado

| Atalho | Ação |
|---|---|
| `Ctrl+Shift+C` | Abre o chat (foca no editor). |
| `Enter` | Envia a mensagem. |
| `Shift+Enter` | Nova linha na caixa de texto. |
