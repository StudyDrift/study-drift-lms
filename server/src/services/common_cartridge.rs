//! IMS Common Cartridge manifest helpers (plan 2.13).

use std::path::{Path, PathBuf};

use roxmltree::Document;

fn local_name<'a>(n: roxmltree::Node<'a, '_>) -> &'a str {
    n.tag_name().name()
}

fn is_qti_resource(resource_type: Option<&str>, href: &str) -> bool {
    let href_l = href.to_ascii_lowercase();
    let t = resource_type.unwrap_or("").to_ascii_lowercase();
    if t.contains("imsqti") || t.contains("qti") {
        return href_l.ends_with(".xml") || href_l.ends_with(".qti");
    }
    href_l.ends_with(".xml") && (href_l.contains("assessment") || href_l.contains("item"))
}

/// Returns QTI XML paths referenced by `imsmanifest.xml`, rooted at `extract_root`.
pub fn qti_xml_paths_from_manifest(
    manifest_xml: &str,
    extract_root: &Path,
) -> Result<Vec<PathBuf>, String> {
    let doc = Document::parse(manifest_xml).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for n in doc.descendants() {
        if local_name(n) != "resource" {
            continue;
        }
        let href = n.attribute("href").unwrap_or("").trim();
        if href.is_empty() {
            continue;
        }
        let typ = n.attribute("type");
        if !is_qti_resource(typ, href) {
            continue;
        }
        let p = extract_root.join(href);
        out.push(p);
    }
    Ok(out)
}

/// Recursively discovers XML files that may contain QTI items (fallback when manifest is missing).
pub fn discover_xml_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_dir(root, &mut out);
    out.sort();
    out.dedup();
    out
}

fn walk_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name == "__MACOSX" || name.starts_with('.') {
            continue;
        }
        if p.is_dir() {
            walk_dir(&p, out);
        } else if p.extension().and_then(|s| s.to_str()) == Some("xml") {
            out.push(p);
        }
    }
}
