package httpserver

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
)

const maxOrgBrandUploadBytes = 4 << 20

func hostFromPublicOrigin(origin string) string {
	o := strings.TrimSpace(origin)
	if o == "" {
		return ""
	}
	u, err := url.Parse(o)
	if err != nil || u.Host == "" {
		return ""
	}
	return orgbranding.NormalizeHost(u.Host)
}

func (d Deps) brandingResolver() *orgbranding.Resolver {
	if d.BrandingResolver != nil {
		return d.BrandingResolver
	}
	cfg := d.effectiveConfig()
	return orgbranding.NewResolver(d.Pool, cfg.BrandingMultitenantHostSuffix, hostFromPublicOrigin(cfg.PublicWebOrigin))
}

func effectiveHostForBranding(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-Branding-Host")); v != "" {
		return orgbranding.NormalizeHost(v)
	}
	if v := strings.TrimSpace(r.URL.Query().Get("host")); v != "" {
		return orgbranding.NormalizeHost(v)
	}
	return orgbranding.NormalizeHost(r.Host)
}

// GET /api/v1/public/branding/resolve
func (d Deps) handlePublicBrandingResolve() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		ctx := r.Context()
		host := effectiveHostForBranding(r)
		res, err := d.brandingResolver().ResolveForHost(ctx, host)
		if err != nil {
			res = orgbranding.Resolved{
				PrimaryColor:   orgbranding.DefaultPrimaryHex,
				SecondaryColor: orgbranding.DefaultSecondaryHex,
			}
		}
		slugLog := res.OrgSlug
		if slugLog == "" {
			slugLog = "(default)"
		}
		log.Printf("branding resolve: host=%q org_slug=%s", host, slugLog)

		warnPrimary := false
		var ratioPrimary *float64
		ok, ratio, err := orgbranding.MeetsWCAGAANormalText(res.PrimaryColor)
		if err == nil && !ok {
			warnPrimary = true
			ratioPrimary = &ratio
		}
		payload := map[string]any{
			"orgId":            uuidPtrStr(res.OrgID),
			"orgSlug":          nilOrStr(res.OrgSlug),
			"logoUrl":          res.LogoURL,
			"faviconUrl":       res.FaviconURL,
			"primaryColor":     res.PrimaryColor,
			"secondaryColor":   res.SecondaryColor,
			"customDomain":     res.CustomDomain,
			"customEmailDisplayName": res.EmailDisplayName,
			"contrastWarningPrimary":   warnPrimary,
			"contrastRatioPrimary":     ratioPrimary,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(payload)
	}
}

func uuidPtrStr(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}

func nilOrStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

type brandingPutBody struct {
	LogoURL                *string `json:"logoUrl"`
	FaviconURL             *string `json:"faviconUrl"`
	PrimaryColor           *string `json:"primaryColor"`
	SecondaryColor         *string `json:"secondaryColor"`
	CustomDomain           *string `json:"customDomain"`
	CustomEmailDisplayName *string `json:"customEmailDisplayName"`
}

func (d Deps) handleOrgBrandingItem() http.HandlerFunc {
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
			row, err := orgbranding.Get(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load branding.")
				return
			}
			primary := orgbranding.DefaultPrimaryHex
			second := orgbranding.DefaultSecondaryHex
			var logo, fav, dom, email *string
			if row != nil {
				primary = row.PrimaryColor
				second = row.SecondaryColor
				logo = row.LogoURL
				fav = row.FaviconURL
				dom = row.CustomDomain
				email = row.CustomEmailDisplayName
			}
			warn := false
			var ratio *float64
			if ok, rat, err := orgbranding.MeetsWCAGAANormalText(primary); err == nil && !ok {
				warn = true
				ratio = &rat
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"logoUrl":                logo,
				"faviconUrl":             fav,
				"primaryColor":           primary,
				"secondaryColor":         second,
				"customDomain":           dom,
				"customEmailDisplayName": email,
				"contrastWarningPrimary": warn,
				"contrastRatioPrimary":   ratio,
			})
		case http.MethodPut:
			var body brandingPutBody
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			cur, err := orgbranding.Get(ctx, d.Pool, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load branding.")
				return
			}
			logo := mergeStrPtr(cur, func(row *orgbranding.Row) *string {
				if row == nil {
					return nil
				}
				return row.LogoURL
			}, body.LogoURL)
			fav := mergeStrPtr(cur, func(row *orgbranding.Row) *string {
				if row == nil {
					return nil
				}
				return row.FaviconURL
			}, body.FaviconURL)
			p1 := orgbranding.DefaultPrimaryHex
			if cur != nil && strings.TrimSpace(cur.PrimaryColor) != "" {
				p1 = cur.PrimaryColor
			}
			if body.PrimaryColor != nil {
				v, err := orgbranding.ValidateHexColor(*body.PrimaryColor)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid primaryColor (use #RRGGBB).")
					return
				}
				p1 = v
			}
			p2 := orgbranding.DefaultSecondaryHex
			if cur != nil && strings.TrimSpace(cur.SecondaryColor) != "" {
				p2 = cur.SecondaryColor
			}
			if body.SecondaryColor != nil {
				v, err := orgbranding.ValidateHexColor(*body.SecondaryColor)
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid secondaryColor (use #RRGGBB).")
					return
				}
				p2 = v
			}
			var domPtr *string
			if body.CustomDomain != nil {
				t := strings.TrimSpace(strings.ToLower(*body.CustomDomain))
				if t != "" {
					if orgbranding.NormalizeHost(t) != t || strings.Contains(t, "/") {
						apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid customDomain.")
						return
					}
					domPtr = &t
				} else {
					domPtr = nil
				}
			} else if cur != nil {
				domPtr = cur.CustomDomain
			}
			emailPtr := mergeStrPtr(cur, func(row *orgbranding.Row) *string {
				if row == nil {
					return nil
				}
				return row.CustomEmailDisplayName
			}, body.CustomEmailDisplayName)

			if domPtr != nil {
				var conflict uuid.UUID
				qerr := d.Pool.QueryRow(ctx, `
SELECT org_id FROM tenant.org_branding WHERE LOWER(TRIM(custom_domain)) = $1 AND org_id <> $2
`, *domPtr, orgID).Scan(&conflict)
				if qerr == nil {
					apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "That custom domain is already mapped to another organization.")
					return
				}
				if !errors.Is(qerr, pgx.ErrNoRows) {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to validate custom domain.")
					return
				}
			}

			o, err := organization.GetByID(ctx, d.Pool, orgID)
			if err != nil || o == nil {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Organization not found.")
				return
			}

			if err := orgbranding.UpsertReplace(ctx, d.Pool, orgID, logo, fav, p1, p2, domPtr, emailPtr); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save branding.")
				return
			}
			d.brandingResolver().InvalidateAll()

			warn := false
			var ratio *float64
			if ok, rat, err := orgbranding.MeetsWCAGAANormalText(p1); err == nil && !ok {
				warn = true
				ratio = &rat
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"logoUrl":                logo,
				"faviconUrl":             fav,
				"primaryColor":           p1,
				"secondaryColor":         p2,
				"customDomain":           domPtr,
				"customEmailDisplayName": emailPtr,
				"contrastWarningPrimary": warn,
				"contrastRatioPrimary":   ratio,
			})
		default:
			w.Header().Set("Allow", strings.Join([]string{http.MethodGet, http.MethodPut}, ", "))
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

func mergeStrPtr(cur *orgbranding.Row, prev func(*orgbranding.Row) *string, body *string) *string {
	if body != nil {
		s := strings.TrimSpace(*body)
		if s == "" {
			return nil
		}
		out := s
		return &out
	}
	return prev(cur)
}

func (d Deps) handleOrgBrandingUpload(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
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
		if err := r.ParseMultipartForm(maxOrgBrandUploadBytes); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid multipart form.")
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing file field \"file\".")
			return
		}
		defer func() { _ = f.Close() }()
		data, err := io.ReadAll(f)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read upload.")
			return
		}
		if len(data) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Empty file.")
			return
		}
		ct := sniffImageKind(data, hdr.Filename)
		if ct == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Unsupported image type (use PNG, JPEG, GIF, or SVG).")
			return
		}
		ext := extForKind(ct)
		root := strings.TrimSpace(d.effectiveConfig().CourseFilesRoot)
		if root == "" {
			root = "data/course-files"
		}
		dir := filepath.Join(root, "org-branding", orgID.String())
		if err := os.MkdirAll(dir, 0o755); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not store file.")
			return
		}
		base := "logo"
		if kind == "favicon" {
			base = "favicon"
		}
		dest := filepath.Join(dir, base+ext)
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not store file.")
			return
		}
		rel := fmt.Sprintf("/api/v1/public/org-branding/%s/%s", orgID.String(), base)
		cur, err := orgbranding.Get(ctx, d.Pool, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load branding.")
			return
		}
		p1 := orgbranding.DefaultPrimaryHex
		p2 := orgbranding.DefaultSecondaryHex
		var logo, fav, dom, email *string
		if cur != nil {
			p1 = cur.PrimaryColor
			p2 = cur.SecondaryColor
			logo = cur.LogoURL
			fav = cur.FaviconURL
			dom = cur.CustomDomain
			email = cur.CustomEmailDisplayName
		}
		if kind == "logo" {
			logo = &rel
		} else {
			fav = &rel
		}
		if err := orgbranding.UpsertReplace(ctx, d.Pool, orgID, logo, fav, p1, p2, dom, email); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update branding row.")
			return
		}
		d.brandingResolver().InvalidateAll()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"url": rel,
		})
	}
}

func extForKind(ct string) string {
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	default:
		return ".bin"
	}
}

func sniffImageKind(data []byte, filename string) string {
	fn := strings.ToLower(filename)
	switch {
	case bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png"
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		return "image/gif"
	case bytes.HasPrefix(bytes.TrimSpace(data), []byte("<svg")) || svgSnippetLooksLikeSVG(data):
		return "image/svg+xml"
	}
	if strings.HasSuffix(fn, ".png") {
		return "image/png"
	}
	if strings.HasSuffix(fn, ".jpg") || strings.HasSuffix(fn, ".jpeg") {
		return "image/jpeg"
	}
	if strings.HasSuffix(fn, ".gif") {
		return "image/gif"
	}
	if strings.HasSuffix(fn, ".svg") {
		return "image/svg+xml"
	}
	return ""
}

func svgSnippetLooksLikeSVG(data []byte) bool {
	n := len(data)
	if n == 0 {
		return false
	}
	if n > 512 {
		n = 512
	}
	return bytes.Contains(bytes.ToLower(data[:n]), []byte("<svg"))
}

// GET /api/v1/public/org-branding/{orgId}/{asset}
func (d Deps) handlePublicOrgBrandAsset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgStr := strings.TrimSpace(chi.URLParam(r, "orgId"))
		orgID, err := uuid.Parse(orgStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		asset := strings.TrimSpace(strings.ToLower(chi.URLParam(r, "asset")))
		if asset != "logo" && asset != "favicon" {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		root := strings.TrimSpace(d.effectiveConfig().CourseFilesRoot)
		if root == "" {
			root = "data/course-files"
		}
		dir := filepath.Join(root, "org-branding", orgID.String())
		var match string
		for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".svg"} {
			p := filepath.Join(dir, asset+ext)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				match = p
				break
			}
		}
		if match == "" {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		data, err := os.ReadFile(match)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not read file.")
			return
		}
		ct := sniffImageKind(data, match)
		if ct == "" {
			ct = "application/octet-stream"
		}
		sum := sha256.Sum256(data)
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sum))
		mod := time.Now()
		if st, statErr := os.Stat(match); statErr == nil {
			mod = st.ModTime()
		}
		http.ServeContent(w, r, filepath.Base(match), mod, bytes.NewReader(data))
	}
}
