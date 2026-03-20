use crate::error::Error;
use crate::APP;
use dirs::config_dir;
use log::info;
use reqwest_dav::{Auth, ClientBuilder, Depth};
use std::io::Write;
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;

const APP_CONFIG_DIR_CURRENT: &str = "com.transkit.desktop";
const APP_CONFIG_DIR_LEGACY: &str = "com.pot-app.desktop";
const WEBDAV_DIR_CURRENT: &str = "transkit-app";
const WEBDAV_DIR_LEGACY: &str = "pot-app";

fn base_config_dir() -> Result<PathBuf, Error> {
    config_dir().ok_or_else(|| Error::Error("Get Config Dir Error".into()))
}

fn primary_config_dir() -> Result<PathBuf, Error> {
    let base = base_config_dir()?;
    let identifier = APP
        .get()
        .map(|app| app.config().tauri.bundle.identifier.clone())
        .unwrap_or_else(|| APP_CONFIG_DIR_CURRENT.to_string());
    Ok(base.join(identifier))
}

fn legacy_config_dir() -> Result<PathBuf, Error> {
    Ok(base_config_dir()?.join(APP_CONFIG_DIR_LEGACY))
}

fn active_config_dir_for_put() -> Result<PathBuf, Error> {
    let current = primary_config_dir()?;
    let legacy = legacy_config_dir()?;
    if current.join("config.json").exists() {
        return Ok(current);
    }
    if legacy.join("config.json").exists() {
        return Ok(legacy);
    }
    Ok(current)
}

fn restore_extract_dir() -> Result<PathBuf, Error> {
    let current = primary_config_dir()?;
    std::fs::create_dir_all(&current)?;
    Ok(current)
}

fn scoped_webdav_client(
    url: &str,
    username: &str,
    password: &str,
    folder: &str,
) -> Result<reqwest_dav::Client, Error> {
    Ok(ClientBuilder::new()
        .set_host(format!("{}/{}", url.trim_end_matches('/'), folder))
        .set_auth(Auth::Basic(username.to_string(), password.to_string()))
        .build()?)
}

#[tauri::command(async)]
pub async fn webdav(
    operate: &str,
    url: String,
    username: String,
    password: String,
    name: Option<String>,
) -> Result<String, Error> {
    // build root and scoped clients
    let root_client = ClientBuilder::new()
        .set_host(url.clone())
        .set_auth(Auth::Basic(username.clone(), password.clone()))
        .build()?;
    let _ = root_client.mkcol(&format!("/{}", WEBDAV_DIR_CURRENT)).await;
    let client = scoped_webdav_client(&url, &username, &password, WEBDAV_DIR_CURRENT)?;
    let legacy_client = scoped_webdav_client(&url, &username, &password, WEBDAV_DIR_LEGACY)?;

    match operate {
        "list" => {
            let res = match client.list("/", Depth::Number(1)).await {
                Ok(v) if !v.is_empty() => v,
                Ok(_) => legacy_client
                    .list("/", Depth::Number(1))
                    .await
                    .unwrap_or_default(),
                Err(_) => legacy_client.list("/", Depth::Number(1)).await?,
            };
            let result = serde_json::to_string(&res)?;
            Ok(result)
        }
        "get" => {
            let file_name =
                name.ok_or_else(|| Error::Error("WebDav file name is required".into()))?;
            let res = match client.get(&format!("/{}", file_name)).await {
                Ok(v) => v,
                Err(_) => legacy_client.get(&format!("/{}", file_name)).await?,
            };
            let data = res.bytes().await?;
            let config_dir_path = restore_extract_dir()?;
            let zip_path = config_dir_path.join("archive.zip");

            let mut zip_file = std::fs::File::create(&zip_path)?;
            zip_file.write_all(&data)?;
            let mut zip_file = std::fs::File::open(&zip_path)?;
            let mut zip = ZipArchive::new(&mut zip_file)?;
            zip.extract(&config_dir_path)?;
            Ok("".to_string())
        }
        "put" => {
            let config_dir_path = active_config_dir_for_put()?;
            let zip_path = config_dir_path.join("archive.zip");
            let config_path = config_dir_path.join("config.json");
            let database_path = config_dir_path.join("history.db");
            let plugin_path = config_dir_path.join("plugins");

            let zip_file = std::fs::File::create(&zip_path)?;
            let mut zip = zip::ZipWriter::new(zip_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("config.json", options)?;
            zip.write(&std::fs::read(&config_path)?)?;
            if database_path.exists() {
                zip.start_file("history.db", options)?;
                zip.write(&std::fs::read(&database_path)?)?;
            }
            if plugin_path.exists() {
                for entry in WalkDir::new(plugin_path) {
                    let entry = entry?;
                    let path = entry.path();
                    let file_name = match path.strip_prefix(&config_dir_path)?.to_str() {
                        Some(v) => v,
                        None => return Err(Error::Error("WebDav Strip Prefix Error".into())),
                    };
                    if path.is_file() {
                        info!("adding file {path:?} as {file_name:?} ...");
                        zip.start_file(file_name, options)?;
                        zip.write(&std::fs::read(entry.path())?)?;
                    } else {
                        continue;
                    }
                }
            }

            zip.finish()?;
            match client
                .put(
                    &format!(
                        "/{}",
                        name.ok_or_else(|| Error::Error("WebDav file name is required".into()))?
                    ),
                    std::fs::read(&zip_path)?,
                )
                .await
            {
                Ok(()) => return Ok("".to_string()),
                Err(e) => {
                    return Err(Error::Error(format!("WebDav Put Error: {}", e).into()));
                }
            }
        }

        "delete" => {
            let file_name =
                name.ok_or_else(|| Error::Error("WebDav file name is required".into()))?;
            if client.delete(&format!("/{}", file_name)).await.is_ok() {
                return Ok("".to_string());
            }
            match legacy_client.delete(&format!("/{}", file_name)).await {
                Ok(()) => return Ok("".to_string()),
                Err(e) => {
                    return Err(Error::Error(format!("WebDav Delete Error: {}", e).into()));
                }
            }
        }
        _ => {
            return Err(Error::Error(
                format!("WebDav Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[tauri::command(async)]
pub async fn local(operate: &str, path: String) -> Result<String, Error> {
    match operate {
        "put" => {
            let config_dir_path = active_config_dir_for_put()?;
            let config_path = config_dir_path.join("config.json");
            let database_path = config_dir_path.join("history.db");
            let plugin_path = config_dir_path.join("plugins");

            let zip_file = std::fs::File::create(&path)?;
            let mut zip = zip::ZipWriter::new(zip_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("config.json", options)?;
            zip.write(&std::fs::read(&config_path)?)?;
            if database_path.exists() {
                zip.start_file("history.db", options)?;
                zip.write(&std::fs::read(&database_path)?)?;
            }
            if plugin_path.exists() {
                for entry in WalkDir::new(plugin_path) {
                    let entry = entry?;
                    let path = entry.path();
                    let file_name = match path.strip_prefix(&config_dir_path)?.to_str() {
                        Some(v) => v,
                        None => return Err(Error::Error("Strip Prefix Error".into())),
                    };
                    if path.is_file() {
                        info!("adding file {path:?} as {file_name:?} ...");
                        zip.start_file(file_name, options)?;
                        zip.write(&std::fs::read(entry.path())?)?;
                    } else {
                        continue;
                    }
                }
            }

            zip.finish()?;
            Ok("".to_string())
        }
        "get" => {
            let config_dir_path = restore_extract_dir()?;

            let mut zip_file = std::fs::File::open(&path)?;
            let mut zip = ZipArchive::new(&mut zip_file)?;
            zip.extract(config_dir_path)?;
            Ok("".to_string())
        }
        _ => {
            return Err(Error::Error(
                format!("Local Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[tauri::command(async)]
pub async fn aliyun(operate: &str, path: String, url: String) -> Result<String, Error> {
    match operate {
        "put" => {
            let _ = reqwest::Client::new()
                .put(&url)
                .body(std::fs::read(&path)?)
                .send()
                .await?;
            Ok("".to_string())
        }
        "get" => {
            let res = reqwest::Client::new().get(&url).send().await?;
            let data = res.bytes().await?;
            let config_dir_path = restore_extract_dir()?;
            let zip_path = config_dir_path.join("archive.zip");

            let mut zip_file = std::fs::File::create(&zip_path)?;
            zip_file.write_all(&data)?;
            let mut zip_file = std::fs::File::open(&zip_path)?;
            let mut zip = ZipArchive::new(&mut zip_file)?;
            zip.extract(config_dir_path)?;
            Ok("".to_string())
        }
        _ => {
            return Err(Error::Error(
                format!("Local Operate Error: {}", operate).into(),
            ));
        }
    }
}
