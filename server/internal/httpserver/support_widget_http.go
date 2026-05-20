package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/supportwidget"
)

// GET /api/v1/orgs/{orgId}/settings/support-widget
// PUT /api/v1/orgs/{orgId}/settings/support-widget
func (d Deps) handleOrgSupportWidgetItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		if _, _, ok := d.adminOrgOrUnitAccess(w, r, orgID); !ok {
			return
		}
		ctx := r.Context()
		switch r.Method {
		case http.MethodGet:
			row, err := supportwidget.Get(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load support widget config.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(toWidgetJSON(orgID, row))

		case http.MethodPut:
			var body supportWidgetPutBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			if err := validateWidgetBody(body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
				return
			}

			cur, err := supportwidget.Get(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load support widget config.")
				return
			}

			enabled := mergeWidgetBool(cur, func(r *supportwidget.Row) bool { return r.Enabled }, body.Enabled, true)
			provider := mergeWidgetStr(cur, func(r *supportwidget.Row) string { return r.Provider }, body.Provider, "crisp")
			var websiteID *string
			if body.WebsiteID != nil {
				s := strings.TrimSpace(*body.WebsiteID)
				if s != "" {
					websiteID = &s
				}
			} else if cur != nil {
				websiteID = cur.WebsiteID
			}
			var dpaAt *time.Time
			if body.DPAConfirm != nil && *body.DPAConfirm {
				now := time.Now().UTC()
				dpaAt = &now
			} else if cur != nil {
				dpaAt = cur.DPAConfirmedAt
			}

			if err := supportwidget.Upsert(ctx, d.Pool, orgID, enabled, provider, websiteID, dpaAt); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save support widget config.")
				return
			}
			updated, err := supportwidget.Get(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to reload support widget config.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(toWidgetJSON(orgID, updated))

		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPut}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

type supportWidgetPutBody struct {
	Enabled    *bool   `json:"enabled"`
	Provider   *string `json:"provider"`
	WebsiteID  *string `json:"websiteId"`
	DPAConfirm *bool   `json:"dpaConfirm"`
}

func validateWidgetBody(b supportWidgetPutBody) error {
	if b.Provider != nil {
		switch *b.Provider {
		case "crisp", "intercom", "none":
		default:
			return &widgetErr{s: `provider must be one of: "crisp", "intercom", "none"`}
		}
	}
	return nil
}

type widgetErr struct{ s string }

func (e *widgetErr) Error() string { return e.s }

func mergeWidgetBool(cur *supportwidget.Row, get func(*supportwidget.Row) bool, override *bool, def bool) bool {
	if override != nil {
		return *override
	}
	if cur != nil {
		return get(cur)
	}
	return def
}

func mergeWidgetStr(cur *supportwidget.Row, get func(*supportwidget.Row) string, override *string, def string) string {
	if override != nil {
		if s := strings.TrimSpace(*override); s != "" {
			return s
		}
	}
	if cur != nil {
		if s := get(cur); s != "" {
			return s
		}
	}
	return def
}

func toWidgetJSON(orgID uuid.UUID, row *supportwidget.Row) map[string]any {
	if row == nil {
		return map[string]any{
			"orgId":          orgID.String(),
			"enabled":        true,
			"provider":       "crisp",
			"websiteId":      nil,
			"dpaConfirmedAt": nil,
		}
	}
	var dpaStr any
	if row.DPAConfirmedAt != nil {
		dpaStr = row.DPAConfirmedAt.UTC().Format(time.RFC3339)
	}
	var wsID any
	if row.WebsiteID != nil {
		wsID = *row.WebsiteID
	}
	return map[string]any{
		"orgId":          row.OrgID.String(),
		"enabled":        row.Enabled,
		"provider":       row.Provider,
		"websiteId":      wsID,
		"dpaConfirmedAt": dpaStr,
	}
}

// GET /api/v1/help/contextual-articles?route=<path>
//
// Returns help article stubs relevant to the current route. Since the help center
// (plan 20.3) is not yet built, this serves a static mapping keyed by route prefix.
func (d Deps) handleHelpContextualArticles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if _, ok := d.meUserID(w, r); !ok {
			return
		}
		route := strings.TrimSpace(r.URL.Query().Get("route"))
		articles := contextualArticlesForRoute(route)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"articles": articles})
	}
}

type helpArticle struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Slug  string `json:"slug"`
}

// contextualArticlesForRoute returns a small list of relevant articles by
// matching the route prefix against a static mapping.
func contextualArticlesForRoute(route string) []helpArticle {
	for _, entry := range articleMapping {
		if strings.HasPrefix(route, entry.prefix) {
			return entry.articles
		}
	}
	return defaultArticles
}

var defaultArticles = []helpArticle{
	{
		Title: "Finding Your Course for the First Time",
		Slug:  "finding-your-course",
		URL:   "https://lextures.com/#/docs/finding-your-course",
	},
	{
		Title: "Navigating the Course Interface",
		Slug:  "navigating-the-course-interface",
		URL:   "https://lextures.com/#/docs/navigating-the-course-interface",
	},
}

var articleMapping = []struct {
	prefix   string
	articles []helpArticle
}{
	{
		prefix: "/courses",
		articles: []helpArticle{
			{
				Title: "Finding Your Course for the First Time",
				Slug:  "finding-your-course",
				URL:   "https://lextures.com/#/docs/finding-your-course",
			},
			{
				Title: "Navigating the Course Interface",
				Slug:  "navigating-the-course-interface",
				URL:   "https://lextures.com/#/docs/navigating-the-course-interface",
			},
		},
	},
	{
		prefix: "/quiz",
		articles: []helpArticle{
			{
				Title: "Navigating the Course Interface",
				Slug:  "navigating-the-course-interface",
				URL:   "https://lextures.com/#/docs/navigating-the-course-interface",
			},
		},
	},
	{
		prefix: "/gradebook",
		articles: []helpArticle{
			{
				Title: "Navigating the Course Interface",
				Slug:  "navigating-the-course-interface",
				URL:   "https://lextures.com/#/docs/navigating-the-course-interface",
			},
		},
	},
	{
		prefix: "/settings",
		articles: []helpArticle{
			{
				Title: "Finding Your Course for the First Time",
				Slug:  "finding-your-course",
				URL:   "https://lextures.com/#/docs/finding-your-course",
			},
		},
	},
	{
		prefix: "/inbox",
		articles: []helpArticle{
			{
				Title: "Navigating the Course Interface",
				Slug:  "navigating-the-course-interface",
				URL:   "https://lextures.com/#/docs/navigating-the-course-interface",
			},
		},
	},
}
