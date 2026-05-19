// Package aitutor implements the conversational AI tutor for course pages (plan 6.9).
package aitutor

import (
	"regexp"
	"strings"
)

const systemPromptTemplate = `You are an AI tutor for the course "{COURSE_TITLE}". Your role is to help students understand course material, answer questions, and guide their learning.

Rules:
- Be encouraging and constructive. Guide students toward understanding rather than giving direct answers.
- When a student is stuck, provide hints and ask guiding questions.
- Keep responses concise and clear. Use Markdown formatting where helpful.
- Do not help students cheat or complete graded work for them; instead scaffold their thinking.
- If you are unsure about a topic, say so clearly.
- Focus on the subject matter of this course.`

// piiPatterns are simple regexes for redacting common PII from student messages.
var piiPatterns = []*regexp.Regexp{
	// Email addresses
	regexp.MustCompile(`\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b`),
	// US phone numbers (various formats)
	regexp.MustCompile(`\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b`),
	// SSN
	regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`),
}

// RedactPII replaces common PII patterns with [REDACTED].
func RedactPII(s string) string {
	for _, re := range piiPatterns {
		s = re.ReplaceAllString(s, "[REDACTED]")
	}
	return s
}

// BuildSystemPrompt fills the course title into the system prompt template.
func BuildSystemPrompt(courseTitle string) string {
	return strings.ReplaceAll(systemPromptTemplate, "{COURSE_TITLE}", courseTitle)
}
