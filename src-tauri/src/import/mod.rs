use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// App data workspace: <data_dir>/artifactgrid/imports/<uuid>/
pub fn imports_root() -> Result<PathBuf, String> {
    let data = dirs::data_dir().ok_or_else(|| "Could not resolve app data directory".to_string())?;
    let root = data.join("artifactgrid").join("imports");
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create imports dir: {e}"))?;
    Ok(root)
}

/// Copy source file into a fresh workspace folder. Returns (workspace_dir, working_copy_path).
pub fn copy_to_workspace(source: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !source.is_file() {
        return Err(format!("Not a file: {}", source.display()));
    }

    let id = Uuid::new_v4().to_string();
    let workspace = imports_root()?.join(&id);
    fs::create_dir_all(&workspace).map_err(|e| format!("Failed to create workspace: {e}"))?;

    let file_name = source
        .file_name()
        .ok_or_else(|| "Source path has no file name".to_string())?;
    let dest = workspace.join(file_name);

    fs::copy(source, &dest).map_err(|e| {
        format!(
            "Failed to copy '{}' to '{}': {e}",
            source.display(),
            dest.display()
        )
    })?;

    Ok((workspace, dest))
}
