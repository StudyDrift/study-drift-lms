//! Best-effort “flattened” PDF export for inline submission annotations (plan 3.1).
//! Highlights (normalized rects) are drawn in PDF space; other tools are skipped when unsafe.

use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde_json::Value as JsonValue;

use crate::repos::submission_annotations::AnnotationRow;

fn pdf_num(obj: &Object) -> Option<f64> {
    match obj {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(f64::from(*r)),
        _ => None,
    }
}

fn media_box_wh(doc: &Document, page_id: ObjectId) -> (f64, f64) {
    let Ok(Object::Dictionary(page)) = doc.get_object(page_id) else {
        return (612.0, 792.0);
    };
    let Ok(mb) = page.get(b"MediaBox") else {
        return (612.0, 792.0);
    };
    let Object::Array(a) = mb else {
        return (612.0, 792.0);
    };
    if a.len() != 4 {
        return (612.0, 792.0);
    }
    let x0 = a.first().and_then(pdf_num).unwrap_or(0.0);
    let y0 = a.get(1).and_then(pdf_num).unwrap_or(0.0);
    let x1 = a.get(2).and_then(pdf_num).unwrap_or(612.0);
    let y1 = a.get(3).and_then(pdf_num).unwrap_or(792.0);
    let w = (x1 - x0).abs();
    let h = (y1 - y0).abs();
    if w <= 1.0 || h <= 1.0 {
        (612.0, 792.0)
    } else {
        (w, h)
    }
}

fn hex_to_rgb01(hex: &str) -> (f64, f64, f64) {
    let t = hex.trim().trim_start_matches('#');
    if t.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&t[0..2], 16),
            u8::from_str_radix(&t[2..4], 16),
            u8::from_str_radix(&t[4..6], 16),
        ) {
            return (
                f64::from(r) / 255.0,
                f64::from(g) / 255.0,
                f64::from(b) / 255.0,
            );
        }
    }
    (1.0, 1.0, 0.0)
}

fn norm_highlight_rect(coords: &JsonValue) -> Option<(f64, f64, f64, f64)> {
    let o = coords.as_object()?;
    let x1 = o.get("x1")?.as_f64()?;
    let y1 = o.get("y1")?.as_f64()?;
    let x2 = o.get("x2")?.as_f64()?;
    let y2 = o.get("y2")?.as_f64()?;
    Some((x1, y1, x2, y2))
}

fn norm_pin(coords: &JsonValue) -> Option<(f64, f64)> {
    let o = coords.as_object()?;
    let x = o.get("x")?.as_f64()?;
    let y = o.get("y")?.as_f64()?;
    Some((x, y))
}

fn norm_points(coords: &JsonValue) -> Vec<(f64, f64)> {
    let Some(arr) = coords.get("points").and_then(|p| p.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|p| {
            let o = p.as_object()?;
            let x = o.get("x")?.as_f64()?;
            let y = o.get("y")?.as_f64()?;
            Some((x, y))
        })
        .collect()
}

fn to_pdf_rect(w: f64, h: f64, nx1: f64, ny1: f64, nx2: f64, ny2: f64) -> (f64, f64, f64, f64) {
    let minx = nx1.min(nx2) * w;
    let maxx = nx1.max(nx2) * w;
    let miny = ny1.min(ny2);
    let maxy = ny1.max(ny2);
    let lly = (1.0 - maxy) * h;
    let ury = (1.0 - miny) * h;
    (minx, lly, (maxx - minx).max(0.5), (ury - lly).max(0.5))
}

fn to_pdf_xy(w: f64, h: f64, nx: f64, ny: f64) -> (f64, f64) {
    (nx * w, (1.0 - ny) * h)
}

fn build_overlay_ops(page_w: f64, page_h: f64, rows: &[&AnnotationRow]) -> String {
    let mut ops = String::from("q\n");
    for row in rows {
        if row.tool_type == "highlight" {
            if let Some((nx1, ny1, nx2, ny2)) = norm_highlight_rect(&row.coords_json) {
                let (r, g, b) = hex_to_rgb01(&row.colour);
                let (x, y, rw, rh) = to_pdf_rect(page_w, page_h, nx1, ny1, nx2, ny2);
                ops.push_str(&format!(
                    "{} {} {} rg\n{} {} {} {} re f\n",
                    r, g, b, x, y, rw, rh
                ));
            }
        } else if row.tool_type == "pin" {
            if let Some((nx, ny)) = norm_pin(&row.coords_json) {
                let (r, g, b) = hex_to_rgb01(&row.colour);
                let (cx, cy) = to_pdf_xy(page_w, page_h, nx, ny);
                let d = (page_w + page_h) * 0.004;
                let (x, y, rw, rh) = (cx - d, cy - d, d * 2.0, d * 2.0);
                ops.push_str(&format!(
                    "{} {} {} rg\n{} {} {} {} re f\n",
                    r, g, b, x, y, rw, rh
                ));
            }
        } else if row.tool_type == "draw" {
            let pts = norm_points(&row.coords_json);
            if pts.len() >= 2 {
                let (r, g, b) = hex_to_rgb01(&row.colour);
                ops.push_str(&format!("{} {} {} RG\n", r, g, b));
                ops.push_str("1 w\n");
                let (x0, y0) = to_pdf_xy(page_w, page_h, pts[0].0, pts[0].1);
                ops.push_str(&format!("{} {} m\n", x0, y0));
                for (nx, ny) in pts.iter().skip(1) {
                    let (x, y) = to_pdf_xy(page_w, page_h, *nx, *ny);
                    ops.push_str(&format!("{} {} l\n", x, y));
                }
                ops.push_str("S\n");
            }
        } else if row.tool_type == "text" {
            // Text boxes need embedded or standard-14 font resources on the page; skip in export v1.
        }
    }
    ops.push_str("Q\n");
    ops
}

fn append_overlay_to_page(
    doc: &mut Document,
    page_id: ObjectId,
    overlay_ops: String,
) -> Result<(), String> {
    let stream = Stream::new(dictionary! {}, overlay_ops.into_bytes());
    let stream_id = doc.add_object(Object::Stream(stream));

    let page_obj = doc
        .objects
        .get_mut(&page_id)
        .ok_or_else(|| "missing page object".to_string())?;
    let Object::Dictionary(page_dict) = page_obj else {
        return Err("page object not a dictionary".to_string());
    };

    let old = page_dict.remove(b"Contents");
    let new_val = match old {
        Some(Object::Reference(r)) => {
            Object::Array(vec![Object::Reference(r), Object::Reference(stream_id)])
        }
        Some(Object::Array(mut a)) => {
            a.push(Object::Reference(stream_id));
            Object::Array(a)
        }
        Some(other) => Object::Array(vec![other, Object::Reference(stream_id)]),
        None => Object::Reference(stream_id),
    };
    page_dict.set("Contents", new_val);

    Ok(())
}

/// Returns PDF bytes with vector overlays merged when possible; falls back to the original bytes.
pub fn merge_annotations_into_pdf(pdf_bytes: &[u8], annotations: &[AnnotationRow]) -> Vec<u8> {
    if annotations.is_empty() {
        return pdf_bytes.to_vec();
    }
    let mut doc = match Document::load_from(pdf_bytes) {
        Ok(d) => d,
        Err(_) => return pdf_bytes.to_vec(),
    };

    let pages = doc.get_pages();
    if pages.is_empty() {
        return pdf_bytes.to_vec();
    }

    let mut by_page: std::collections::BTreeMap<i32, Vec<&AnnotationRow>> =
        std::collections::BTreeMap::new();
    for a in annotations {
        if a.tool_type == "highlight"
            || a.tool_type == "draw"
            || a.tool_type == "pin"
            || a.tool_type == "text"
        {
            by_page.entry(a.page).or_default().push(a);
        }
    }

    for (page_no, rows) in by_page {
        let page_u = u32::try_from(page_no).unwrap_or(1);
        let Some(&page_id) = pages.get(&page_u) else {
            continue;
        };
        let (pw, ph) = media_box_wh(&doc, page_id);
        let ops = build_overlay_ops(pw, ph, &rows);
        if let Err(e) = append_overlay_to_page(&mut doc, page_id, ops) {
            tracing::warn!(error = %e, page = page_no, "could not append annotation overlay stream");
        }
    }

    let mut out = Vec::new();
    if doc.save_to(&mut out).is_err() {
        return pdf_bytes.to_vec();
    }
    out
}
