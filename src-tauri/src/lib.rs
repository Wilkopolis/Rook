use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: u64,
    pub modified_ms: u128,
    pub extension: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListResponse {
    pub path: String,
    pub parent_path: Option<String>,
    pub items: Vec<FsEntry>,
}

#[tauri::command]
fn list_directory(path: String) -> Result<DirListResponse, String> {
    let target = PathBuf::from(&path);
    let read_dir = fs::read_dir(&target).map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    for entry_res in read_dir.take(500) {
        if let Ok(entry) = entry_res {
            let full_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().ok();
            let is_directory = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_ms = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let extension = if is_directory {
                "folder".to_string()
            } else {
                full_path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
            };

            items.push(FsEntry {
                name,
                path: full_path.to_string_lossy().to_string(),
                is_directory,
                size_bytes,
                modified_ms,
                extension,
            });
        }
    }

    let parent_path = target
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    Ok(DirListResponse {
        path: target.to_string_lossy().to_string(),
        parent_path,
        items,
    })
}

#[tauri::command]
fn read_file_preview(path: String) -> Result<serde_json::Value, String> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        let mut children = Vec::new();
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.take(40).flatten() {
                children.push(e.file_name().to_string_lossy().to_string());
            }
        }
        return Ok(serde_json::json!({ "kind": "directory", "children": children }));
    }
    if meta.len() > 256 * 1024 {
        return Ok(serde_json::json!({
            "kind": "binary",
            "message": format!("Large file ({:.1} KB) — preview truncated", meta.len() as f64 / 1024.0)
        }));
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.iter().take(512).any(|&b| b == 0) {
        Ok(serde_json::json!({
            "kind": "binary",
            "message": format!("Binary file ({} bytes)", meta.len())
        }))
    } else {
        let text = String::from_utf8_lossy(&bytes).chars().take(8000).collect::<String>();
        Ok(serde_json::json!({ "kind": "text", "content": text }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_directory, read_file_preview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
