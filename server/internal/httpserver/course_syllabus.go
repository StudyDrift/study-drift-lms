package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	userai "github.com/lextures/lextures/server/internal/repos/user"
	"github.com/lextures/lextures/server/internal/service/openrouter"
)

type syllabusResponse struct {
	Sections                  []course.SyllabusSection `json:"sections"`
	UpdatedAt                 string                   `json:"updatedAt"`
	RequireSyllabusAcceptance bool                     `json:"requireSyllabusAcceptance"`
	SyllabusAcceptancePending *bool                    `json:"syllabusAcceptancePending,omitempty"`
}

func (d Deps) syllabusView(r *http.Request, courseCode string, viewer uuid.UUID, p *course.SyllabusPayload) (syllabusResponse, error) {
	var resp syllabusResponse
	if p == nil {
		return resp, nil
	}
	isStudent, err := enrollment.UserHasEnrollmentRole(r.Context(), d.Pool, courseCode, viewer, "student")
	if err != nil {
		return resp, err
	}
	var pending *bool
	if isStudent && p.RequireSyllabusAcceptance {
		has, err := course.HasSyllabusAcceptance(r.Context(), d.Pool, p.CourseID, viewer)
		if err != nil {
			return resp, err
		}
		if !has {
			v := true
			pending = &v
		}
	}
	return syllabusResponse{
		Sections:                  p.Sections,
		UpdatedAt:                 p.UpdatedAt.UTC().Format(time.RFC3339Nano),
		RequireSyllabusAcceptance: p.RequireSyllabusAcceptance,
		SyllabusAcceptancePending: pending,
	}, nil
}

// handleGetCourseSyllabus is GET /api/v1/courses/{course_code}/syllabus
func (d Deps) handleGetCourseSyllabus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		p, err := course.GetSyllabusByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load syllabus.")
			return
		}
		if p == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		out, err := d.syllabusView(r, courseCode, viewer, p)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load syllabus.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

type patchSyllabusBody struct {
	Sections                  []course.SyllabusSection `json:"sections"`
	RequireSyllabusAcceptance bool                      `json:"requireSyllabusAcceptance"`
}

type generateSyllabusSectionBody struct {
	Instructions    string `json:"instructions"`
	SectionHeading  string `json:"sectionHeading"`
	ExistingMarkdown string `json:"existingMarkdown"`
}

// handlePatchCourseSyllabus is PATCH /api/v1/courses/{course_code}/syllabus
func (d Deps) handlePatchCourseSyllabus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		isStaff, err := enrollment.UserIsCourseStaff(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !isStaff {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		p0, err := course.GetSyllabusByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if p0 == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		var body patchSyllabusBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if body.Sections == nil {
			body.Sections = []course.SyllabusSection{}
		}
		_, err = course.UpsertSyllabus(r.Context(), d.Pool, p0.CourseID, body.Sections, body.RequireSyllabusAcceptance)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save syllabus.")
			return
		}
		p, err := course.GetSyllabusByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load syllabus.")
			return
		}
		if p == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		out, err := d.syllabusView(r, courseCode, viewer, p)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to build response.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleGenerateSyllabusSection is POST /api/v1/courses/{course_code}/syllabus/generate-section
func (d Deps) handleGenerateSyllabusSection() http.HandlerFunc {
	type resp struct {
		Markdown string `json:"markdown"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		isStaff, err := enrollment.UserIsCourseStaff(r.Context(), d.Pool, courseCode, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
			return
		}
		if !isStaff {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var body generateSyllabusSectionBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		instructions := strings.TrimSpace(body.Instructions)
		if instructions == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Instructions are required.")
			return
		}
		heading := strings.TrimSpace(body.SectionHeading)
		existing := strings.TrimSpace(body.ExistingMarkdown)

		or := d.openRouterClient()
		if or == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "AI generation is not configured. Set an OpenRouter API key in Platform Settings.")
			return
		}

		model, err := userai.GetCourseSetupModelID(r.Context(), d.Pool, viewer)
		if err != nil {
			model = userai.DefaultCourseSetupModelID
		}

		const sysPrompt = `You are an expert academic writer helping instructors author course syllabi. When given a section heading and instructions, write clear, concise syllabus content in Markdown. Use the heading level provided (## or ###) if one is given. Write in a professional but accessible tone suitable for university students. Output only the Markdown content — no preamble, no code fences, no commentary.`

		var userMsg strings.Builder
		if heading != "" {
			fmt.Fprintf(&userMsg, "Section heading: %s\n\n", heading)
		}
		fmt.Fprintf(&userMsg, "Instructions: %s", instructions)
		if existing != "" {
			fmt.Fprintf(&userMsg, "\n\nExisting content to revise or extend:\n%s", existing)
		}

		generated, err := or.ChatCompletion(model, []openrouter.Message{
			{Role: "system", Content: sysPrompt},
			{Role: "user", Content: userMsg.String()},
		})
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadGateway, apierr.CodeInternal, "AI generation failed: "+err.Error())
			return
		}

		markdown := strings.TrimSpace(generated)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Markdown: markdown})
	}
}

// handlePostSyllabusAccept is POST /api/v1/courses/{course_code}/syllabus/accept
func (d Deps) handlePostSyllabusAccept() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		p, err := course.GetSyllabusByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if p == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if err := course.RecordSyllabusAcceptance(r.Context(), d.Pool, p.CourseID, viewer); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to record acceptance.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSyllabusAcceptanceStatus is GET /api/v1/courses/{course_code}/syllabus/acceptance-status
func (d Deps) handleSyllabusAcceptanceStatus() http.HandlerFunc {
	type resp struct {
		RequireSyllabusAcceptance bool `json:"requireSyllabusAcceptance"`
		HasAcceptedSyllabus      bool `json:"hasAcceptedSyllabus"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		p, err := course.GetSyllabusByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load syllabus.")
			return
		}
		if p == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if !p.RequireSyllabusAcceptance {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(resp{
				RequireSyllabusAcceptance: false,
				HasAcceptedSyllabus:      true,
			})
			return
		}
		has, err := course.HasSyllabusAcceptance(r.Context(), d.Pool, p.CourseID, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load acceptance.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{
			RequireSyllabusAcceptance: true,
			HasAcceptedSyllabus:      has,
		})
	}
}
