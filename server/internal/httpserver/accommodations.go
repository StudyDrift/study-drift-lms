package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lextures/lextures/server/internal/apierr"
	acmodel "github.com/lextures/lextures/server/internal/models/accommodations"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/coursegrants"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	stac "github.com/lextures/lextures/server/internal/repos/studentaccommodations"
	"github.com/lextures/lextures/server/internal/repos/user"
	acsvc "github.com/lextures/lextures/server/internal/service/accommodations"
)

func (d Deps) registerAccommodationRoutes(r chi.Router) {
	r.Get("/accommodations/users", d.handleAccommodationUserSearch())
	r.Get("/enrollments/{enrollmentID}/accommodation-summary", d.handleEnrollmentAccommodationSummary())
	r.Route("/users/{userID}/accommodations", func(ur chi.Router) {
		ur.Get("/", d.handleListUserAccommodations())
		ur.Post("/", d.handleCreateUserAccommodation())
		ur.Put("/{accommodationID}", d.handleUpdateUserAccommodation())
		ur.Delete("/{accommodationID}", d.handleDeleteUserAccommodation())
	})
	r.Get("/me/accommodations", d.handleMyAccommodations())
}

func (d Deps) handleAccommodationUserSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		has, err := rbac.UserHasPermission(ctx, d.Pool, uid, acmodel.PermManage)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if !has {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, `Query parameter "q" is required (email, name, sid, or user id).`)
			return
		}
		if len(q) < 2 {
			_, perr := uuid.Parse(q)
			if perr != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Enter at least 2 characters, or paste the learner's full user id.")
				return
			}
		}
		rows, err := user.SearchForAccommodationLookup(ctx, d.Pool, q)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		out := acmodel.UserSearchResponse{Users: make([]acmodel.UserSearchHit, 0, len(rows))}
		for _, row := range rows {
			hit := acmodel.UserSearchHit{
				ID:    row.ID.String(),
				Email: row.Email,
			}
			if row.DisplayName != nil {
				hit.DisplayName = row.DisplayName
			}
			if row.FirstName != nil {
				hit.FirstName = row.FirstName
			}
			if row.LastName != nil {
				hit.LastName = row.LastName
			}
			if row.Sid != nil {
				hit.Sid = row.Sid
			}
			out.Users = append(out.Users, hit)
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (d Deps) handleEnrollmentAccommodationSummary() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		eid, err := uuid.Parse(chi.URLParam(r, "enrollmentID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		ctx := r.Context()
		en, err := enrollment.GetByID(ctx, d.Pool, eid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if en == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		required := coursegrants.CourseEnrollmentsReadPermission(en.CourseCode)
		var hasPerm bool
		hasPerm, err = courseroles.UserHasPermission(ctx, d.Pool, uid, required)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		eff := acsvc.ResolveEffectiveOrDefault(ctx, d.Pool, en.UserID, en.CourseID)
		flags := acsvc.InstructorFlagLabels(eff)
		has := len(flags) > 0
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(acmodel.AccommodationSummaryPublic{HasAccommodation: has, Flags: flags})
	}
}

func (d Deps) handleListUserAccommodations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		if !requireAccManage(ctx, w, d, uid) {
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "userID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		rows, err := stac.ListForUserWithCourse(ctx, d.Pool, tid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		out := make([]acmodel.StudentAccommodation, 0, len(rows))
		for i := range rows {
			out = append(out, rowToAPI(&rows[i].Row, rows[i].CourseCode))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func requireAccManage(ctx context.Context, w http.ResponseWriter, d Deps, userID uuid.UUID) bool {
	ok, err := rbac.UserHasPermission(ctx, d.Pool, userID, acmodel.PermManage)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return false
	}
	if !ok {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return false
	}
	return true
}

func (d Deps) handleCreateUserAccommodation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		if !requireAccManage(ctx, w, d, uid) {
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "userID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		var b acmodel.CreateRequest
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		tm := 1.0
		if b.TimeMultiplier != nil {
			tm = *b.TimeMultiplier
		}
		if tm < 1.0 || tm > 99.99 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "timeMultiplier must be between 1.0 and 99.99.")
			return
		}
		extra := int32(0)
		if b.ExtraAttempts != nil {
			extra = *b.ExtraAttempts
		}
		if extra < 0 || extra > 500 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "extraAttempts must be between 0 and 500.")
			return
		}
		if extra < 0 {
			extra = 0
		}
		h := false
		if b.HintsAlwaysEnabled != nil {
			h = *b.HintsAlwaysEnabled
		}
		rd := false
		if b.ReducedDistraction != nil {
			rd = *b.ReducedDistraction
		}
		efrom, euntil, st := parseAccEffectiveDates(b.EffectiveFrom, b.EffectiveUntil, w)
		if !st {
			return
		}
		var courseID *uuid.UUID
		if b.CourseCode != nil {
			c := strings.TrimSpace(*b.CourseCode)
			if c != "" {
				cid, err := course.GetIDByCourseCode(ctx, d.Pool, c)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
					return
				}
				if cid == nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeUnknownCourseCode, "Unknown courseCode.")
					return
				}
				courseID = cid
			}
		}
		row, err := stac.InsertRow(ctx, d.Pool, tid, courseID, tm, extra, h, rd, b.AlternativeFormat, efrom, euntil, uid)
		if err != nil {
			if isUniqueViolation(err) {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "An accommodation already exists for this learner in that scope.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		var cc *string
		if row.CourseID != nil {
			cc, err = course.GetCourseCodeByID(ctx, d.Pool, *row.CourseID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(rowToAPI(row, cc))
	}
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func parseAccEffectiveDates(ef, eu *string, w http.ResponseWriter) (from, until *time.Time, ok bool) {
	f, err := acmodel.ParseDate(ef)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid effectiveFrom date (use YYYY-MM-DD).")
		return nil, nil, false
	}
	u, err := acmodel.ParseDate(eu)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid effectiveUntil date (use YYYY-MM-DD).")
		return nil, nil, false
	}
	return f, u, true
}

func (d Deps) handleUpdateUserAccommodation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		if !requireAccManage(ctx, w, d, uid) {
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "userID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		aid, err := uuid.Parse(chi.URLParam(r, "accommodationID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid accommodation id.")
			return
		}
		var b acmodel.UpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if b.TimeMultiplier < 1.0 || b.TimeMultiplier > 99.99 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "timeMultiplier must be between 1.0 and 99.99.")
			return
		}
		if b.ExtraAttempts < 0 || b.ExtraAttempts > 500 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "extraAttempts must be between 0 and 500.")
			return
		}
		efrom, euntil, st := parseAccEffectiveDates(b.EffectiveFrom, b.EffectiveUntil, w)
		if !st {
			return
		}
		updated, err := stac.UpdateRow(ctx, d.Pool, aid, tid, b.TimeMultiplier, b.ExtraAttempts,
			b.HintsAlwaysEnabled, b.ReducedDistraction, b.AlternativeFormat, efrom, euntil, uid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if updated == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		var cc *string
		if updated.CourseID != nil {
			cc, err = course.GetCourseCodeByID(ctx, d.Pool, *updated.CourseID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(rowToAPI(updated, cc))
	}
}

func (d Deps) handleDeleteUserAccommodation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		if !requireAccManage(ctx, w, d, uid) {
			return
		}
		tid, err := uuid.Parse(chi.URLParam(r, "userID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid user id.")
			return
		}
		aid, err := uuid.Parse(chi.URLParam(r, "accommodationID"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid accommodation id.")
			return
		}
		deleted, err := stac.DeleteRow(ctx, d.Pool, aid, tid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleMyAccommodations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		uid, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		rows, err := stac.ListForUserWithCourse(ctx, d.Pool, uid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
			return
		}
		today := time.Now().UTC()
		entries := make([]acmodel.MyEntry, 0, len(rows))
		for i := range rows {
			rr := rows[i]
			if !acsvc.RowActiveOnDate(rr.Row.EffectiveFrom, rr.Row.EffectiveUntil, today) {
				continue
			}
			entries = append(entries, acmodel.MyEntry{
				CourseCode:            rr.CourseCode,
				HasExtendedTime:        rr.Row.TimeMultiplier > 1.000001,
				HasExtraAttempts:        rr.Row.ExtraAttempts > 0,
				HintsAlwaysAvailable:   rr.Row.HintsAlwaysEnabled,
				ReducedDistraction:     rr.Row.ReducedDistraction,
				EffectiveFrom:          acmodel.YYYYMMDDFromNull(rr.Row.EffectiveFrom),
				EffectiveUntil:         acmodel.YYYYMMDDFromNull(rr.Row.EffectiveUntil),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(acmodel.MyResponse{Accommodations: entries})
	}
}

func rowToAPI(r *stac.Row, courseCode *string) acmodel.StudentAccommodation {
	if r == nil {
		return acmodel.StudentAccommodation{}
	}
	var cid *string
	if r.CourseID != nil {
		s := r.CourseID.String()
		cid = &s
	}
	var ub *string
	if r.UpdatedBy != nil {
		s := r.UpdatedBy.String()
		ub = &s
	}
	return acmodel.StudentAccommodation{
		ID:                 r.ID.String(),
		UserID:             r.UserID.String(),
		CourseID:           cid,
		CourseCode:         courseCode,
		TimeMultiplier:     r.TimeMultiplier,
		ExtraAttempts:      r.ExtraAttempts,
		HintsAlwaysEnabled: r.HintsAlwaysEnabled,
		ReducedDistraction: r.ReducedDistraction,
		AlternativeFormat:  r.AlternativeFormat,
		EffectiveFrom:      acmodel.YYYYMMDDFromNull(r.EffectiveFrom),
		EffectiveUntil:     acmodel.YYYYMMDDFromNull(r.EffectiveUntil),
		CreatedBy:          r.CreatedBy.String(),
		UpdatedBy:          ub,
		CreatedAt:          r.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          r.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
