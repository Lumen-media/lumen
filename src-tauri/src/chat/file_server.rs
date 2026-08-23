use std::path::PathBuf;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub struct ChatFileServer {
    port: u16,
    files_dir: PathBuf,
}

impl ChatFileServer {
    pub fn new(files_dir: PathBuf) -> Self {
        Self {
            port: 0,
            files_dir,
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn start(&mut self) -> Result<(), String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        self.port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let files_dir = self.files_dir.clone();

        tokio::spawn(async move {
            loop {
                let (stream, _addr) = match listener.accept().await {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let files_dir = files_dir.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_request(stream, &files_dir).await {
                        eprintln!("[chat-file-server] error: {}", e);
                    }
                });
            }
        });

        Ok(())
    }
}

async fn handle_request(
    mut stream: tokio::net::TcpStream,
    files_dir: &PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    if path == "/" || !path.starts_with("/files/") {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
        stream.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    let filename = &path[7..];
    if filename.is_empty()
        || filename.contains("..")
        || filename.contains('\\')
        || filename.contains('/')
    {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
        stream.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    let file_path = files_dir.join(filename);
    let mut file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
            stream.write_all(response.as_bytes()).await?;
            return Ok(());
        }
    };

    let mut contents = Vec::new();
    file.read_to_end(&mut contents).await?;

    let mime = guess_mime(filename);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        mime,
        contents.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(&contents).await?;

    Ok(())
}

fn guess_mime(filename: &str) -> &'static str {
    match filename.rsplit('.').next().unwrap_or("") {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}
