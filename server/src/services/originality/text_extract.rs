use lopdf::Document;

/// Best-effort plaintext for academic integrity checks (MVP: PDF + UTF-8 text-like MIME).
pub fn submission_bytes_to_plaintext(mime_type: &str, bytes: &[u8]) -> Result<String, String> {
    let mt = mime_type.split(';').next().unwrap_or(mime_type).trim().to_ascii_lowercase();
    if mt == "application/pdf" || mt.ends_with("/pdf") {
        return pdf_to_text(bytes);
    }
    if mt.starts_with("text/")
        || mt == "application/json"
        || mt == "application/javascript"
        || mt == "application/xml"
    {
        return String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string());
    }
    Err(format!("MIME type not supported for originality text extraction: {mime_type}"))
}

fn pdf_to_text(bytes: &[u8]) -> Result<String, String> {
    let doc = Document::load_mem(bytes).map_err(|e| e.to_string())?;
    let pages: Vec<u32> = doc.get_pages().into_keys().collect();
    let mut out = String::new();
    for n in pages {
        match doc.extract_text(&[n]) {
            Ok(s) => {
                out.push_str(&s);
                out.push('\n');
            }
            Err(_) => continue,
        }
    }
    let t = out.trim();
    if t.is_empty() {
        return Err("No extractable text in PDF.".into());
    }
    Ok(t.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_text_plain() {
        let s = submission_bytes_to_plaintext("text/plain; charset=utf-8", b"hello").unwrap();
        assert_eq!(s, "hello");
    }
}
