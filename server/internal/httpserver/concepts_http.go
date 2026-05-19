package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/concepts"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/service/conceptgraph"
)

const permConceptsManage = "global:app:concepts:manage"

func (d Deps) handleConceptsList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		q := concepts.ListConceptsQuery{}
		if v := r.URL.Query().Get("parent"); v != "" {
			q.ParentSlug = &v
		}
		if v := r.URL.Query().Get("bloom"); v != "" {
			q.Bloom = &v
		}
		if v := r.URL.Query().Get("q"); v != "" {
			q.Q = &v
		}
		rows, err := concepts.ListConcepts(r.Context(), d.Pool, q)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list concepts.")
			return
		}
		out := make([]conceptgraph.JSON, 0, len(rows))
		for i := range rows {
			out = append(out, conceptgraph.RowToJSON(rows[i]))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleConceptsSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "q is required.")
			return
		}
		rows, err := concepts.SearchConceptsFTS(r.Context(), d.Pool, q, 100)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Search failed.")
			return
		}
		out := make([]conceptgraph.JSON, 0, len(rows))
		for i := range rows {
			out = append(out, conceptgraph.RowToJSON(rows[i]))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleConceptCreate() http.HandlerFunc {
	type body struct {
		Name            string     `json:"name"`
		Description     *string    `json:"description,omitempty"`
		BloomLevel      *string    `json:"bloomLevel,omitempty"`
		ParentConceptID *uuid.UUID `json:"parentConceptId,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		n := strings.TrimSpace(b.Name)
		if n == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "name is required.")
			return
		}
		row, err := conceptgraph.CreateConcept(r.Context(), d.Pool, n, b.Description, b.BloomLevel, b.ParentConceptID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create concept.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(row)
	}
}

func (d Deps) handleConceptGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		row, err := concepts.GetByID(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load concept.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(conceptgraph.RowToJSON(*row))
	}
}

func (d Deps) handleConceptUpdate() http.HandlerFunc {
	type body struct {
		Name        string  `json:"name"`
		Description *string `json:"description,omitempty"`
		BloomLevel  *string `json:"bloomLevel,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if strings.TrimSpace(b.Name) == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "name is required.")
			return
		}
		j, err := conceptgraph.UpdateConcept(r.Context(), d.Pool, id, strings.TrimSpace(b.Name), b.Description, b.BloomLevel, nil)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update concept.")
			return
		}
		if j == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(*j)
	}
}

func (d Deps) handleConceptDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		okDel, err := concepts.DeleteConcept(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete concept.")
			return
		}
		if !okDel {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleConceptAddPrerequisite() http.HandlerFunc {
	type body struct {
		PrerequisiteID uuid.UUID `json:"prerequisiteId"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		err = conceptgraph.AddPrerequisite(r.Context(), d.Pool, id, b.PrerequisiteID)
		if err != nil {
			if errors.Is(err, conceptgraph.ErrSelfPrerequisite) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "A concept cannot be a prerequisite of itself.")
				return
			}
			if errors.Is(err, conceptgraph.ErrCircularPrerequisite) {
				apierr.WriteJSON(w, http.StatusUnprocessableEntity, apierr.CodeInvalidInput, "This prerequisite would create a circular dependency.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add prerequisite.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleConceptRemovePrerequisite() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		prereq, err := uuid.Parse(chi.URLParam(r, "prerequisite_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid prerequisite id.")
			return
		}
		okDel, err := conceptgraph.DeletePrerequisiteEdge(r.Context(), d.Pool, id, prereq)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to remove prerequisite.")
			return
		}
		if !okDel {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleConceptAncestors() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		g, err := concepts.ListAncestors(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load graph.")
			return
		}
		writeGraphBundle(w, g)
	}
}

func (d Deps) handleConceptDescendants() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid id.")
			return
		}
		g, err := concepts.ListDescendants(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load graph.")
			return
		}
		writeGraphBundle(w, g)
	}
}

func writeGraphBundle(w http.ResponseWriter, g *concepts.GraphBundle) {
	nodes := make([]conceptgraph.JSON, 0, len(g.Nodes))
	for i := range g.Nodes {
		nodes = append(nodes, conceptgraph.RowToJSON(g.Nodes[i]))
	}
	edges := make([][2]string, 0, len(g.Edges))
	for _, e := range g.Edges {
		edges = append(edges, [2]string{e[0].String(), e[1].String()})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"nodes": nodes, "edges": edges})
}

func (d Deps) handleConceptQuestionTagPost() http.HandlerFunc {
	type body struct {
		QuestionID uuid.UUID `json:"questionId"`
		ConceptID  uuid.UUID `json:"conceptId"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if err := concepts.InsertQuestionTag(r.Context(), d.Pool, b.ConceptID, b.QuestionID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add tag.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleConceptQuestionTagDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		okPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, permConceptsManage)
		if err != nil || !okPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		qid, err := uuid.Parse(r.URL.Query().Get("questionId"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "questionId is required.")
			return
		}
		cid, err := uuid.Parse(r.URL.Query().Get("conceptId"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "conceptId is required.")
			return
		}
		okDel, err := concepts.DeleteQuestionTag(r.Context(), d.Pool, cid, qid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to remove tag.")
			return
		}
		if !okDel {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) registerConceptRoutes(r chi.Router) {
	r.Get("/api/v1/concepts/search", d.handleConceptsSearch())
	r.Get("/api/v1/concepts", d.handleConceptsList())
	r.Post("/api/v1/concepts", d.handleConceptCreate())
	r.Get("/api/v1/concepts/{id}/ancestors", d.handleConceptAncestors())
	r.Get("/api/v1/concepts/{id}/descendants", d.handleConceptDescendants())
	r.Post("/api/v1/concepts/{id}/prerequisites", d.handleConceptAddPrerequisite())
	r.Delete("/api/v1/concepts/{id}/prerequisites/{prerequisite_id}", d.handleConceptRemovePrerequisite())
	r.Post("/api/v1/concepts/question-tags", d.handleConceptQuestionTagPost())
	r.Delete("/api/v1/concepts/question-tags", d.handleConceptQuestionTagDelete())
	r.Get("/api/v1/concepts/{id}", d.handleConceptGet())
	r.Put("/api/v1/concepts/{id}", d.handleConceptUpdate())
	r.Delete("/api/v1/concepts/{id}", d.handleConceptDelete())
}
