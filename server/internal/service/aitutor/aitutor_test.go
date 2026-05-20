package aitutor

import (
	"strings"
	"testing"
)

func TestRedactPII_Email(t *testing.T) {
	in := "please email me at student@example.com about this"
	out := RedactPII(in)
	if strings.Contains(out, "student@example.com") {
		t.Errorf("email not redacted: %q", out)
	}
	if !strings.Contains(out, "[REDACTED]") {
		t.Errorf("no redaction marker: %q", out)
	}
}

func TestRedactPII_Phone(t *testing.T) {
	cases := []string{
		"call me at 555-867-5309",
		"my number is (555) 867-5309",
		"reach me at 555.867.5309",
	}
	for _, in := range cases {
		out := RedactPII(in)
		if strings.Contains(out, "5309") {
			t.Errorf("phone not redacted for %q: got %q", in, out)
		}
	}
}

func TestRedactPII_SSN(t *testing.T) {
	in := "my ssn is 123-45-6789"
	out := RedactPII(in)
	if strings.Contains(out, "123-45-6789") {
		t.Errorf("SSN not redacted: %q", out)
	}
}

func TestRedactPII_NoPII(t *testing.T) {
	in := "What is the derivative of x squared?"
	out := RedactPII(in)
	if out != in {
		t.Errorf("clean message was modified: %q -> %q", in, out)
	}
}

func TestBuildSystemPrompt_ContainsCourseTitle(t *testing.T) {
	prompt := BuildSystemPrompt("Introduction to Calculus")
	if !strings.Contains(prompt, "Introduction to Calculus") {
		t.Errorf("course title missing from prompt: %q", prompt)
	}
}
