//! Minimal QTI 2.1 `assessmentItem` parsing for bank import (plan 2.13).

use roxmltree::Node;
use serde_json::{json, Value as JsonValue};

use crate::services::question_bank::normalize_question_options_json;

#[derive(Debug, Clone)]
pub struct ParsedQtiItem {
    pub identifier: String,
    pub title: Option<String>,
    pub stem: String,
    pub question_type: String,
    pub options: Option<JsonValue>,
    pub correct_answer: Option<JsonValue>,
    pub points: f64,
    pub shuffle_choices_override: Option<bool>,
    pub status: &'static str,
    pub needs_review_note: Option<String>,
}

fn local_name<'a>(n: Node<'a, '_>) -> &'a str {
    n.tag_name().name()
}

fn attr<'a>(n: Node<'a, '_>, name: &str) -> Option<&'a str> {
    n.attribute(name)
}

fn text_descendants(n: Node<'_, '_>) -> String {
    let mut parts = Vec::new();
    for d in n.descendants() {
        if d.is_text() {
            if let Some(t) = d.text() {
                let s = t.trim();
                if !s.is_empty() {
                    parts.push(s);
                }
            }
        }
    }
    parts
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_first_item_body<'a>(root: Node<'a, '_>) -> Option<Node<'a, 'a>> {
    root.descendants().find(|n| local_name(*n) == "itemBody")
}

fn response_correct_map(root: Node<'_, '_>) -> std::collections::HashMap<String, Vec<String>> {
    let mut m = std::collections::HashMap::new();
    for n in root.descendants() {
        if local_name(n) != "responseDeclaration" {
            continue;
        }
        let Some(id) = attr(n, "identifier") else {
            continue;
        };
        let mut values = Vec::new();
        for v in n.descendants() {
            if local_name(v) == "value" {
                if let Some(t) = v.text() {
                    let s = t.trim();
                    if !s.is_empty() {
                        values.push(s.to_string());
                    }
                }
            }
        }
        if !values.is_empty() {
            m.insert(id.to_string(), values);
        }
    }
    m
}

fn parse_choice_interaction(
    root: Node<'_, '_>,
    ix: Node<'_, '_>,
    correct_map: &std::collections::HashMap<String, Vec<String>>,
) -> ParsedQtiItem {
    let identifier = attr(root, "identifier").unwrap_or("unknown").to_string();
    let title = attr(root, "title").map(|s| s.to_string());
    let response_id = attr(ix, "responseIdentifier")
        .unwrap_or("RESPONSE")
        .to_string();
    let max_choices = attr(ix, "maxChoices")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(1);
    let shuffle = attr(ix, "shuffle")
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);

    let mut prompt_text = String::new();
    let mut choices: Vec<(String, String)> = Vec::new();
    for ch in ix.children() {
        let name = local_name(ch);
        if name == "prompt" {
            let t = text_descendants(ch);
            if !t.is_empty() {
                prompt_text = t;
            }
        } else if name == "simpleChoice" {
            let id = attr(ch, "identifier").unwrap_or("").to_string();
            let label = text_descendants(ch);
            choices.push((id, label));
        }
    }

    let options = if choices.is_empty() {
        None
    } else {
        let arr: Vec<JsonValue> = choices
            .iter()
            .map(|(_, label)| json!({ "text": label }))
            .collect();
        normalize_question_options_json(Some(&JsonValue::Array(arr)))
    };

    let correct_vals = correct_map.get(&response_id).cloned().unwrap_or_default();
    let correct_answer = if max_choices <= 1 {
        let idx = choices
            .iter()
            .position(|(id, _)| correct_vals.iter().any(|v| v == id));
        idx.map(|i| json!({ "correctChoiceIndex": i }))
    } else {
        let mut idxs: Vec<usize> = Vec::new();
        for v in &correct_vals {
            if let Some(i) = choices.iter().position(|(id, _)| id == v) {
                idxs.push(i);
            }
        }
        idxs.sort_unstable();
        idxs.dedup();
        if idxs.is_empty() {
            None
        } else {
            Some(json!({ "correctChoiceIndices": idxs }))
        }
    };

    let question_type = if max_choices <= 1 {
        "mc_single"
    } else {
        "mc_multiple"
    };

    let needs_review_note = if correct_answer.is_none() {
        Some("Could not determine correct answer for choice interaction.".into())
    } else {
        None
    };

    ParsedQtiItem {
        identifier,
        title,
        stem: if prompt_text.is_empty() {
            "(imported)".into()
        } else {
            prompt_text
        },
        question_type: question_type.to_string(),
        options,
        correct_answer,
        points: 1.0,
        shuffle_choices_override: if shuffle { None } else { Some(false) },
        status: "draft",
        needs_review_note,
    }
}

fn parse_text_entry(root: Node<'_, '_>, _ix: Node<'_, '_>) -> ParsedQtiItem {
    let identifier = attr(root, "identifier").unwrap_or("unknown").to_string();
    let title = attr(root, "title").map(|s| s.to_string());
    let body = find_first_item_body(root);
    let stem = body
        .map(text_descendants)
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "(imported)".into());
    ParsedQtiItem {
        identifier,
        title,
        stem,
        question_type: "short_answer".into(),
        options: None,
        correct_answer: None,
        points: 1.0,
        shuffle_choices_override: None,
        status: "needs_review",
        needs_review_note: Some(
            "Imported text entry; correct responses require manual configuration.".into(),
        ),
    }
}

fn parse_numeric(root: Node<'_, '_>, _ix: Node<'_, '_>) -> ParsedQtiItem {
    let identifier = attr(root, "identifier").unwrap_or("unknown").to_string();
    let title = attr(root, "title").map(|s| s.to_string());
    let body = find_first_item_body(root);
    let stem = body
        .map(text_descendants)
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "(imported)".into());
    ParsedQtiItem {
        identifier,
        title,
        stem,
        question_type: "numeric".into(),
        options: None,
        correct_answer: None,
        points: 1.0,
        shuffle_choices_override: None,
        status: "needs_review",
        needs_review_note: Some(
            "Imported numeric interaction; set correct value and tolerance.".into(),
        ),
    }
}

fn parse_stub_needs_review(root: Node<'_, '_>, question_type: &str, note: &str) -> ParsedQtiItem {
    let identifier = attr(root, "identifier").unwrap_or("unknown").to_string();
    let title = attr(root, "title").map(|s| s.to_string());
    let body = find_first_item_body(root);
    let stem = body
        .map(text_descendants)
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "(imported)".into());
    ParsedQtiItem {
        identifier,
        title,
        stem,
        question_type: question_type.to_string(),
        options: None,
        correct_answer: None,
        points: 1.0,
        shuffle_choices_override: None,
        status: "needs_review",
        needs_review_note: Some(note.to_string()),
    }
}

/// Parses a QTI 2.1 `assessmentItem` document when `xml` is valid UTF-8.
pub fn parse_assessment_item_xml(xml: &str) -> Result<ParsedQtiItem, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| e.to_string())?;
    let root = doc.root_element();
    if local_name(root) != "assessmentItem" {
        return Err("root element is not assessmentItem".into());
    }
    let correct_map = response_correct_map(root);
    let Some(body) = find_first_item_body(root) else {
        return Ok(parse_stub_needs_review(
            root,
            "short_answer",
            "Missing itemBody; imported as stub.",
        ));
    };

    let interaction = body.descendants().find(|n| {
        matches!(
            local_name(*n),
            "choiceInteraction"
                | "textEntryInteraction"
                | "extendedTextInteraction"
                | "matchInteraction"
                | "orderInteraction"
                | "hotspotInteraction"
                | "numericInteraction"
                | "uploadInteraction"
        )
    });

    let Some(ix) = interaction else {
        return Ok(parse_stub_needs_review(
            root,
            "short_answer",
            "No supported interaction found.",
        ));
    };

    let mut out = match local_name(ix) {
        "choiceInteraction" => parse_choice_interaction(root, ix, &correct_map),
        "textEntryInteraction" | "extendedTextInteraction" => parse_text_entry(root, ix),
        "numericInteraction" => parse_numeric(root, ix),
        "matchInteraction" => parse_stub_needs_review(
            root,
            "matching",
            "Matching interaction imported; complete pairings in the editor.",
        ),
        "orderInteraction" => parse_stub_needs_review(
            root,
            "ordering",
            "Ordering interaction imported; verify item list and correct order.",
        ),
        "hotspotInteraction" => parse_stub_needs_review(
            root,
            "hotspot",
            "Hotspot interaction imported; configure regions and correct area.",
        ),
        "uploadInteraction" => parse_stub_needs_review(
            root,
            "file_upload",
            "File upload interaction is not auto-configured.",
        ),
        _ => parse_stub_needs_review(root, "short_answer", "Unsupported interaction type."),
    };

    if out.needs_review_note.is_some() {
        out.status = "needs_review";
    }

    Ok(out)
}

/// Returns true when the document appears to contain a QTI assessment item.
pub fn looks_like_assessment_item(xml: &str) -> bool {
    xml.contains("assessmentItem")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_choice_single() {
        let xml = r#"<?xml version="1.0"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="Q1" title="T1">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>A</value></correctResponse>
  </responseDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">
      <prompt><p>Pick one</p></prompt>
      <simpleChoice identifier="A">Alpha</simpleChoice>
      <simpleChoice identifier="B">Beta</simpleChoice>
    </choiceInteraction>
  </itemBody>
</assessmentItem>"#;
        let p = parse_assessment_item_xml(xml).unwrap();
        assert_eq!(p.identifier, "Q1");
        assert_eq!(p.question_type, "mc_single");
        assert!(p.stem.contains("Pick one"));
        assert!(p.correct_answer.is_some());
    }
}
