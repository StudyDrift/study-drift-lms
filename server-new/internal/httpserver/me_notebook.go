package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/service/notebookrag"
)

type notebookRagJSON struct {
	Question  string `json:"question"`
	Notebooks []struct {
		CourseCode  string `json:"courseCode"`
		CourseTitle string `json:"courseTitle"`
		Markdown    string `json:"markdown"`
	} `json:"notebooks"`
}

func (d Deps) handleNotebookQuery() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.openRouterClient() == nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeAiNotConfigured, "AI features are not configured on this server.")
			return
		}
		var body notebookRagJSON
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		docs := make([]notebookrag.DocInput, 0, len(body.Notebooks))
		for _, n := range body.Notebooks {
			docs = append(docs, notebookrag.DocInput{
				CourseCode:  n.CourseCode,
				CourseTitle: n.CourseTitle,
				Markdown:    n.Markdown,
			})
		}
		docs = notebookrag.FilterDocs(docs)
		resp, err := notebookrag.Answer(r.Context(), d.Pool, d.openRouterClient(), userID, body.Question, docs)
		if err != nil {
			if notebookrag.IsValidationError(err) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}
			if notebookrag.IsGenerationError(err) {
				msg := err.Error()
				if len(msg) > 800 {
					msg = msg[:800]
				}
				apierr.WriteJSON(w, http.StatusBadGateway, apierr.CodeAiGenerationFailed, msg)
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not complete notebook query.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
