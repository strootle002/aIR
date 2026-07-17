use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::import::copy_to_workspace;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDataset {
    pub id: String,
    pub file_name: String,
    pub original_path: String,
    pub working_copy_path: String,
    pub workspace_dir: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub working_copy_path: String,
    pub tagged_lines: Vec<usize>,
    pub column_widths: HashMap<String, f64>,
    pub hidden_columns: Vec<String>,
    pub word_wrap: bool,
    #[serde(default)]
    pub column_order: Vec<String>,
    #[serde(default)]
    pub group_by_columns: Vec<String>,
    #[serde(default)]
    pub user_columns: Vec<String>,
    #[serde(default)]
    pub row_highlights: HashMap<String, String>,
    #[serde(default)]
    pub column_highlights: HashMap<String, String>,
    #[serde(default)]
    pub column_tags: HashMap<String, String>,
    #[serde(default)]
    pub cell_tags: HashMap<String, String>,
    #[serde(default)]
    pub histogram_height: Option<f64>,
    #[serde(default)]
    pub advanced_filter: Option<serde_json::Value>,
    #[serde(default)]
    pub format_rules: Option<serde_json::Value>,
    #[serde(default)]
    pub dag_mapping: Option<serde_json::Value>,
    #[serde(default)]
    pub mind_mapping: Option<serde_json::Value>,
    #[serde(default)]
    pub sort_column: Option<String>,
    #[serde(default)]
    pub sort_dir: Option<String>,
    #[serde(default)]
    pub display_timezone: Option<String>,
    #[serde(default)]
    pub timestamp_assume_utc: Option<bool>,
}

fn value_to_cell(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn objects_to_table(
    objects: Vec<serde_json::Map<String, serde_json::Value>>,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    if objects.is_empty() {
        return Err("JSON/NDJSON file has no object records".to_string());
    }

    let mut columns: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for obj in &objects {
        for key in obj.keys() {
            if seen.insert(key.clone()) {
                columns.push(key.clone());
            }
        }
    }
    if columns.is_empty() {
        return Err("JSON/NDJSON objects have no fields".to_string());
    }

    let rows: Vec<Vec<String>> = objects
        .into_iter()
        .map(|obj| {
            columns
                .iter()
                .map(|col| obj.get(col).map(value_to_cell).unwrap_or_default())
                .collect()
        })
        .collect();

    Ok((columns, rows))
}

fn parse_delimited_file(
    path: &Path,
    delimiter: u8,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open working copy: {e}"))?;
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(BufReader::new(file));

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| format!("Failed to read headers: {e}"))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    if headers.is_empty() {
        return Err("File has no header row".to_string());
    }

    let col_count = headers.len();
    let mut rows: Vec<Vec<String>> = Vec::new();

    for (idx, result) in reader.records().enumerate() {
        let record =
            result.map_err(|e| format!("Parse error at data row {}: {e}", idx + 1))?;
        let mut row: Vec<String> = record.iter().map(|f| f.to_string()).collect();
        if row.len() < col_count {
            row.resize(col_count, String::new());
        } else if row.len() > col_count {
            row.truncate(col_count);
        }
        rows.push(row);
    }

    Ok((headers, rows))
}

fn parse_csv_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    parse_delimited_file(path, b',')
}

fn parse_tsv_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    parse_delimited_file(path, b'\t')
}

/// One column per non-empty line — useful for plain log dumps.
fn parse_plain_text_lines(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open working copy: {e}"))?;
    let reader = BufReader::new(file);
    let mut rows: Vec<Vec<String>> = Vec::new();
    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Failed to read text file: {e}"))?;
        // Keep blank lines as empty cells so line numbers stay aligned with the file
        rows.push(vec![line]);
    }
    if rows.is_empty() {
        return Err("Text file is empty".to_string());
    }
    Ok((vec!["text".to_string()], rows))
}

fn peek_first_nonempty_line(path: &Path) -> Result<Option<String>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open working copy: {e}"))?;
    let reader = BufReader::new(file);
    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Failed to read text file: {e}"))?;
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    Ok(None)
}

/// `.txt` may be CSV, TSV, JSON, NDJSON, or plain line-oriented logs.
fn parse_txt_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let first = peek_first_nonempty_line(path)?;
    let Some(first) = first else {
        return Err("Text file is empty".to_string());
    };

    if first.starts_with('[') {
        return parse_json_array_file(path);
    }
    if first.starts_with('{') {
        return parse_ndjson_file(path).or_else(|_| parse_json_array_file(path));
    }
    if first.contains('\t') {
        return parse_tsv_file(path).or_else(|_| parse_plain_text_lines(path));
    }
    // Prefer CSV when commas look like delimiters; otherwise one row per line
    if first.contains(',') {
        return parse_csv_file(path).or_else(|_| parse_plain_text_lines(path));
    }
    parse_plain_text_lines(path)
}

fn parse_json_array_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open working copy: {e}"))?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| format!("Failed to read JSON file: {e}"))?;

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e}"))?;

    match value {
        serde_json::Value::Array(items) => {
            let mut objects = Vec::with_capacity(items.len());
            for (i, item) in items.into_iter().enumerate() {
                match item {
                    serde_json::Value::Object(map) => objects.push(map),
                    _ => {
                        return Err(format!(
                            "JSON array item {} is not an object (expected array of objects)",
                            i + 1
                        ));
                    }
                }
            }
            objects_to_table(objects)
        }
        serde_json::Value::Object(map) => objects_to_table(vec![map]),
        _ => Err(
            "JSON root must be an array of objects, or a single object".to_string(),
        ),
    }
}

fn parse_ndjson_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open working copy: {e}"))?;
    let reader = BufReader::new(file);
    let mut objects = Vec::new();

    for (idx, line_result) in reader.lines().enumerate() {
        let line = line_result.map_err(|e| format!("Failed to read line {}: {e}", idx + 1))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(trimmed).map_err(|e| {
            format!("NDJSON parse error at line {}: {e}", idx + 1)
        })?;
        match value {
            serde_json::Value::Object(map) => objects.push(map),
            _ => {
                return Err(format!(
                    "NDJSON line {} is not a JSON object",
                    idx + 1
                ));
            }
        }
    }

    objects_to_table(objects)
}

fn extension_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn parse_tabular_file(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let ext = extension_lower(path);
    match ext.as_str() {
        "csv" => parse_csv_file(path),
        "tsv" => parse_tsv_file(path),
        "txt" | "log" => parse_txt_file(path),
        "jsonl" | "ndjson" => parse_ndjson_file(path),
        "json" => {
            // Prefer JSON array; fall back to NDJSON for .json files that are line-delimited
            match parse_json_array_file(path) {
                Ok(table) => Ok(table),
                Err(array_err) => match parse_ndjson_file(path) {
                    Ok(table) => Ok(table),
                    Err(_) => Err(array_err),
                },
            }
        }
        "" => parse_txt_file(path).map_err(|_| {
            "Unrecognized file format. Use .csv, .tsv, .txt, .json, .jsonl, or .ndjson"
                .to_string()
        }),
        _ => Err(format!(
            "Unsupported file type '.{ext}'. Use .csv, .tsv, .txt, .json, .jsonl, or .ndjson"
        )),
    }
}

#[tauri::command]
pub fn import_csv(source_path: String) -> Result<ImportedDataset, String> {
    let source = PathBuf::from(&source_path);
    let (workspace, working_copy) = copy_to_workspace(&source)?;
    let (columns, rows) = parse_tabular_file(&working_copy)?;
    let total_lines = rows.len();

    let id = workspace
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let file_name = working_copy
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("data")
        .to_string();

    Ok(ImportedDataset {
        id,
        file_name,
        original_path: source_path,
        working_copy_path: working_copy.to_string_lossy().to_string(),
        workspace_dir: workspace.to_string_lossy().to_string(),
        columns,
        rows,
        total_lines,
    })
}

#[tauri::command]
pub fn export_csv(
    path: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<(), String> {
    let file = File::create(&path).map_err(|e| format!("Failed to create CSV: {e}"))?;
    let mut writer = csv::Writer::from_writer(BufWriter::new(file));
    writer
        .write_record(&columns)
        .map_err(|e| format!("Failed to write CSV header: {e}"))?;
    for row in rows {
        writer
            .write_record(&row)
            .map_err(|e| format!("Failed to write CSV row: {e}"))?;
    }
    writer
        .flush()
        .map_err(|e| format!("Failed to flush CSV: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_json(
    path: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<(), String> {
    let objects: Vec<serde_json::Map<String, serde_json::Value>> = rows
        .into_iter()
        .map(|row| {
            let mut map = serde_json::Map::new();
            for (i, col) in columns.iter().enumerate() {
                let val = row.get(i).cloned().unwrap_or_default();
                map.insert(col.clone(), serde_json::Value::String(val));
            }
            map
        })
        .collect();

    let json = serde_json::to_string_pretty(&objects)
        .map_err(|e| format!("Failed to serialize JSON: {e}"))?;
    let mut file = File::create(&path).map_err(|e| format!("Failed to create JSON: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write JSON: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_bytes(path: String, base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| format!("Failed to decode export data: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

fn session_path_for(working_copy_path: &str) -> PathBuf {
    PathBuf::from(format!("{working_copy_path}.ag_sess"))
}

#[tauri::command]
pub fn save_session(session: SessionData) -> Result<(), String> {
    let path = session_path_for(&session.working_copy_path);
    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("Failed to serialize session: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write session: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_session(working_copy_path: String) -> Result<Option<SessionData>, String> {
    let path = session_path_for(&working_copy_path);
    if !path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read session: {e}"))?;
    let session: SessionData =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse session: {e}"))?;
    Ok(Some(session))
}
