//! Simple PDF export for SBG mastery transcript (plan 3.7).

use std::io::BufWriter;

use printpdf::{BuiltinFont, Mm, PdfDocument};

/// Build a one-page PDF listing the course, student, and one line per standard (code + level).
pub fn build_mastery_transcript_pdf(
    course_title: &str,
    course_code: &str,
    student_label: &str,
    lines: &[(String, String)],
) -> Result<Vec<u8>, printpdf::Error> {
    let (doc, page, layer) = PdfDocument::new("Mastery transcript", Mm(210.0), Mm(297.0), "L1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_small = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let layer_ref = doc.get_page(page).get_layer(layer);
    let mut y = 280.0;
    let left = 20.0;
    layer_ref.use_text(
        &format!("Mastery transcript — {course_title}"),
        14.0,
        Mm(left),
        Mm(y),
        &font,
    );
    y -= 8.0;
    layer_ref.use_text(
        &format!("Course: {course_code}  |  Learner: {student_label}"),
        10.0,
        Mm(left),
        Mm(y),
        &font_small,
    );
    y -= 12.0;
    for (code, label) in lines {
        y -= 6.0;
        if y < 20.0 {
            break;
        }
        let line = if code.is_empty() {
            label.clone()
        } else {
            format!("{code} — {label}")
        };
        let t = if line.len() > 120 {
            format!("{}…", &line[..120])
        } else {
            line
        };
        layer_ref.use_text(&t, 9.0, Mm(left), Mm(y), &font_small);
    }
    let mut out = Vec::new();
    {
        let mut w = BufWriter::new(&mut out);
        doc.save(&mut w)?;
    }
    Ok(out)
}
