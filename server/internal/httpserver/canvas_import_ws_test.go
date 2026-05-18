package httpserver

import (
	"strings"
	"testing"
)

func TestCanvasEnrollmentTypeToRole_TeacherAndTA(t *testing.T) {
	for _, typ := range []string{"TeacherEnrollment", "TaEnrollment", "teacher", "ta", "head_ta"} {
		if got := canvasEnrollmentTypeToRole(typ); got != "instructor" {
			t.Errorf("canvasEnrollmentTypeToRole(%q) = %q, want instructor", typ, got)
		}
	}
}

func TestCanvasEnrollmentTypeToRole_OtherMapsToStudent(t *testing.T) {
	for _, typ := range []string{"StudentEnrollment", "DesignerEnrollment", "ObserverEnrollment", "", "unknown"} {
		if got := canvasEnrollmentTypeToRole(typ); got != "student" {
			t.Errorf("canvasEnrollmentTypeToRole(%q) = %q, want student", typ, got)
		}
	}
}

func TestCanvasImportInclude_WithDefaults_AllFalseGivesAll(t *testing.T) {
	got := (canvasImportInclude{}).withDefaults()
	want := canvasImportInclude{Modules: true, Assignments: true, Quizzes: true, Enrollments: true, Grades: true, Settings: true}
	if got != want {
		t.Fatalf("withDefaults on zero include = %+v, want %+v", got, want)
	}
}

func TestCanvasImportInclude_WithDefaults_PartialUnchanged(t *testing.T) {
	partial := canvasImportInclude{Modules: true, Enrollments: true}
	if got := partial.withDefaults(); got != partial {
		t.Fatalf("withDefaults on partial should return as-is, got %+v", got)
	}
}

func TestMarkdownFromHTML_ConvertsBasicFormatting(t *testing.T) {
	md := markdownFromHTML("<h2>Title</h2><p>Hello <strong>world</strong> and <a href=\"https://example.com\">link</a>.</p>")
	if !strings.Contains(md, "## Title") {
		t.Fatalf("expected heading markdown, got: %q", md)
	}
	if !strings.Contains(md, "**world**") {
		t.Fatalf("expected bold markdown, got: %q", md)
	}
	if !strings.Contains(md, "[link](https://example.com)") {
		t.Fatalf("expected link markdown, got: %q", md)
	}
}

func TestHTMLToPlainText_StripsTagsAndNormalizesBreaks(t *testing.T) {
	plain := htmlToPlainText("<p>One</p><p>Two<br/>Three</p>")
	if plain != "One\n\nTwo\nThree" {
		t.Fatalf("unexpected plain output: %q", plain)
	}
}
