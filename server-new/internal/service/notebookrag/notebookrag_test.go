package notebookrag

import (
	"strings"
	"testing"
)

func TestRetrieve_PrefersMatchingTerms(t *testing.T) {
	nbs := []DocInput{
		{CourseCode: "C-1", CourseTitle: "Algebra", Markdown: "Chapter one covers linear equations and slope."},
	}
	ch := retrieveChunks("linear equations slope", nbs)
	if len(ch) == 0 {
		t.Fatal("expected chunks")
	}
	if !strings.Contains(ch[0].text, "linear") && !strings.Contains(ch[0].text, "slope") {
		t.Fatalf("chunk: %q", ch[0].text)
	}
}

func TestValidateRequest_Errors(t *testing.T) {
	if err := ValidateRequest("", nil); !IsValidationError(err) {
		t.Fatalf("expected validation: %v", err)
	}
	if err := ValidateRequest("q", nil); !IsValidationError(err) {
		t.Fatal(err)
	}
}

func TestFilterDocs(t *testing.T) {
	raw := []DocInput{
		{CourseCode: "  C  ", CourseTitle: " ", Markdown: "  body  "},
		{CourseCode: "", Markdown: "x"},
	}
	got := FilterDocs(raw)
	if len(got) != 1 || got[0].CourseCode != "C" || got[0].CourseTitle != "C" {
		t.Fatalf("%+v", got)
	}
}

func TestNormalizeMarkdownOutput(t *testing.T) {
	if g := normalizeMarkdownOutput("```\nline\n```"); g != "line" {
		t.Fatalf("%q", g)
	}
}

func TestExcerpt(t *testing.T) {
	s := excerpt("word " + stringRepeat("x", 500))
	if len(s) < 100 {
		t.Fatalf("len %d", len(s))
	}
}

func stringRepeat(s string, n int) string {
	b := make([]byte, 0, n*len(s))
	for i := 0; i < n; i++ {
		b = append(b, s...)
	}
	return string(b)
}

func TestIsGenerationError(t *testing.T) {
	if !IsGenerationError(&GenerationError{Message: "x"}) {
		t.Fatal("expected true")
	}
}
