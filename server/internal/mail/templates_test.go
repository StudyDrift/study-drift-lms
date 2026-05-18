package mail

import (
	"strings"
	"testing"
)

func TestRenderGradePosted(t *testing.T) {
	rendered, err := RenderTemplate("grade_posted", map[string]string{
		"courseName":     "Algebra I",
		"assignmentName": "Quiz 2",
		"link":           "http://localhost:5173/courses/ALG101/grades",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rendered.Subject, "Algebra I") {
		t.Fatalf("subject: %q", rendered.Subject)
	}
	if !strings.Contains(rendered.HTMLBody, "Quiz 2") {
		t.Fatalf("html missing assignment")
	}
}
