use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
};

use axum::{
    Json, Router,
    extract::{
        ConnectInfo, State as AxumState,
        ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
    },
    response::{Html, IntoResponse},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use local_ip_address::local_ip;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::async_runtime;
use tauri::async_runtime::JoinHandle;
use tokio::{
    net::TcpListener,
    sync::{RwLock, broadcast},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideUpdate {
    pub lines: Vec<String>,
    pub font: Option<String>,
    pub font_size: Option<u32>,
    pub alignment: Option<String>,
    pub background: Option<String>,
    pub slide_index: usize,
    pub total_slides: usize,
    pub active: bool,
}

#[derive(Clone)]
struct HtmlServerState {
    tx: broadcast::Sender<String>,
    latest: Arc<RwLock<Option<String>>>,
}

pub struct HtmlServerRuntime {
    port: Option<u16>,
    state: Option<HtmlServerState>,
    task: Option<JoinHandle<()>>,
}

impl HtmlServerRuntime {
    pub fn new() -> Self {
        Self {
            port: None,
            state: None,
            task: None,
        }
    }

    pub fn start(&mut self, port: u16) {
        if self.is_active() && self.port == Some(port) {
            return;
        }

        self.stop();

        let bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
        let (tx, _) = broadcast::channel::<String>(128);
        let latest = Arc::new(RwLock::new(None));
        let state = HtmlServerState {
            tx: tx.clone(),
            latest: latest.clone(),
        };

        let app_state = state.clone();

        let task = async_runtime::spawn(async move {
            let listener = match TcpListener::bind(bind_addr).await {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("Failed to bind HTML server on {}: {}", bind_addr, error);
                    return;
                }
            };

            let router = Router::new()
                .route("/", get(html_index))
                .route("/health", get(html_health))
                .route("/ws", get(html_ws))
                .with_state(app_state);

            if let Err(error) = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                eprintln!("HTML server error: {}", error);
            }
        });

        self.port = Some(port);
        self.state = Some(state);
        self.task = Some(task);
    }

    pub fn stop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }

        self.port = None;
        self.state = None;
    }

    pub fn is_active(&self) -> bool {
        self.task.is_some()
    }

    pub fn url(&self) -> Option<String> {
        let port = self.port?;
        local_ip().ok().map(|ip| format!("http://{}:{}", ip, port))
    }

    pub fn push_slide(&self, slide: SlideUpdate) {
        let Some(state) = &self.state else {
            return;
        };

        let payload = json!({
            "type": "slide",
            "lines": slide.lines,
            "font": slide.font,
            "font_size": slide.font_size,
            "alignment": slide.alignment,
            "background": slide.background,
            "slide_index": slide.slide_index,
            "total_slides": slide.total_slides,
            "active": slide.active,
        })
        .to_string();

        let _ = state.tx.send(payload.clone());
        let latest = state.latest.clone();
        async_runtime::spawn(async move {
            *latest.write().await = Some(payload);
        });
    }

    pub fn push_blank(&self) {
        let Some(state) = &self.state else {
            return;
        };

        let payload = json!({ "type": "blank" }).to_string();
        let _ = state.tx.send(payload.clone());
        let latest = state.latest.clone();
        async_runtime::spawn(async move {
            *latest.write().await = Some(payload);
        });
    }
}

impl Drop for HtmlServerRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn html_ws(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<HtmlServerState>,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        handle_html_ws(socket, state).await;
    })
}

async fn handle_html_ws(socket: WebSocket, state: HtmlServerState) {
    let (mut sender, mut receiver) = socket.split();

    if let Some(initial_payload) = state.latest.read().await.clone() {
        let _ = sender
            .send(AxumWsMessage::Text(initial_payload.into()))
            .await;
    }

    let mut subscription = state.tx.subscribe();

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(AxumWsMessage::Ping(payload))) => {
                        if sender.send(AxumWsMessage::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(AxumWsMessage::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            outgoing = subscription.recv() => {
                match outgoing {
                    Ok(message) => {
                        if sender.send(AxumWsMessage::Text(message.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn html_index() -> impl IntoResponse {
    Html(HTML_TEMPLATE)
}

async fn html_health() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

const HTML_TEMPLATE: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lumen HTML Presentation</title>
  <style>
    :root {
      --font-family: Inter, Segoe UI, sans-serif;
      --font-size: 48px;
      --text-align: center;
    }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #000;
      color: #fff;
      overflow: hidden;
    }
    #root {
      position: relative;
      width: 100%;
      height: 100%;
      background: #000 center/cover no-repeat;
      transition: opacity 250ms ease;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 5vw;
      box-sizing: border-box;
    }
    #text {
      width: 100%;
      font-family: var(--font-family);
      font-size: var(--font-size);
      text-align: var(--text-align);
      text-transform: uppercase;
      font-weight: 700;
      line-height: 1.4;
    }
    .line { margin: 0.15em 0; }
  </style>
</head>
<body>
  <div id="root"><div id="text"></div></div>
  <script>
    const root = document.getElementById('root');
    const text = document.getElementById('text');
    function clearSlide() {
      root.style.background = '#000';
      text.innerHTML = '';
    }
    function applySlide(payload) {
      root.style.opacity = '0';
      window.setTimeout(() => {
        document.documentElement.style.setProperty('--font-family', payload.font || 'Inter, Segoe UI, sans-serif');
        document.documentElement.style.setProperty('--font-size', `${payload.font_size || 48}px`);
        document.documentElement.style.setProperty('--text-align', payload.alignment || 'center');
        const background = payload.background || '#000000';
        if (background.startsWith('#')) {
          root.style.background = background;
        } else {
          root.style.background = `#000 url("${background}") center/cover no-repeat`;
        }
        text.innerHTML = '';
        for (const line of payload.lines || []) {
          const div = document.createElement('div');
          div.className = 'line';
          div.textContent = line;
          text.appendChild(div);
        }
        root.style.opacity = '1';
      }, 250);
    }
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'blank' || payload.active === false) {
            clearSlide();
            return;
          }
          if (payload.type === 'slide') {
            applySlide(payload);
          }
        } catch (_) {}
      };
      ws.onclose = () => window.setTimeout(connect, 1000);
    }
    connect();
  </script>
</body>
</html>
"#;
