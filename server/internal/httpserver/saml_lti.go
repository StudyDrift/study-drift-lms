package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/lextures/lextures/server/internal/browsersaml"
)

// Public SAML 2.0 URL surface (server/src/routes/saml.rs).
func (d Deps) registerSAMLBrowserRoutes(r chi.Router) {
	r.Get("/auth/saml/metadata", d.handleSAMLMetadata())
	r.Get("/auth/saml/login", d.handleSAMLLoginGet())
	r.Post("/auth/saml/acs", d.handleSAMLACS())
	r.Post("/auth/saml/slo", d.handleSAMLSLO())
}

func (d Deps) handleSAMLMetadata() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !d.effectiveConfig().SAMLSSOEnabled {
			writeSAMLorLTIErr(w, http.StatusBadRequest, "SAML is not enabled on this server.")
			return
		}
		browsersaml.HandleMetadata(d.effectiveConfig(), w, r)
	}
}

func (d Deps) handleSAMLLoginGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !d.effectiveConfig().SAMLSSOEnabled {
			writeSAMLorLTIErr(w, http.StatusBadRequest, "SAML is not enabled on this server.")
			return
		}
		if d.Pool == nil {
			writeSAMLorLTIErr(w, http.StatusInternalServerError, "Database is not configured.")
			return
		}
		err := browsersaml.HandleLoginRedirect(r.Context(), d.Pool, d.effectiveConfig(), w, r)
		if err == nil {
			return
		}
		var he *browsersaml.HTTPStatusError
		if errors.As(err, &he) {
			writeSAMLorLTIErr(w, he.Code, he.Msg)
			return
		}
		writeSAMLorLTIErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (d Deps) handleSAMLACS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !d.effectiveConfig().SAMLSSOEnabled {
			writeSAMLorLTIErr(w, http.StatusBadRequest, "SAML is not enabled on this server.")
			return
		}
		if d.Pool == nil || d.JWTSigner == nil {
			writeSAMLorLTIErr(w, http.StatusInternalServerError, "Server is not fully configured.")
			return
		}
		err := browsersaml.HandleACS(r.Context(), d.Pool, d.effectiveConfig(), d.JWTSigner, d.effectiveConfig().PublicWebOrigin, w, r)
		if err == nil {
			return
		}
		var he *browsersaml.HTTPStatusError
		if errors.As(err, &he) {
			writeSAMLorLTIErr(w, he.Code, he.Msg)
			return
		}
		writeSAMLorLTIErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (d Deps) handleSAMLSLO() http.HandlerFunc {
	_ = d
	return func(w http.ResponseWriter, r *http.Request) {
		// Parity: server/src/routes/saml.rs saml_slo_unimplemented
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotImplemented)
		_, _ = w.Write([]byte("SAML Single Logout is not implemented yet."))
	}
}

func writeSAMLorLTIErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  "SAML",
		"error": msg,
	})
}

// LTI: JWKS, provider OIDC, NRPS, AGS, consumer frame; 501 for Rust-stub LTI subroutes.
func (d Deps) registerLTIHTTPRoutes(r chi.Router) {
	r.Get("/.well-known/jwks.json", d.handlePlatformJWKS())
	r.Get("/api/v1/lti/provider/jwks", d.handlePlatformJWKS())

	r.Post("/api/v1/lti/provider/login", d.handleLtiProviderLogin())
	r.Post("/api/v1/lti/provider/launch", d.handleLtiProviderLaunch())
	r.Get("/api/v1/lti/provider/nrps/memberships", d.handleLtiNRPSMemberships())
	r.Post("/api/v1/lti/scores", d.handleLtiAGSScores())
	r.Post("/api/v1/lti/deep-link", d.lti501DeepLink())
	r.Get("/api/v1/lti/callback", d.lti501Callback())
	r.Post("/api/v1/lti/launch/{registration_id}", d.lti501LaunchReg())
	r.Get("/api/v1/lti/consumer/frame", d.handleLtiConsumerFrame())
	r.Get("/api/v1/admin/lti/registrations", d.handleAdminListLTIRegistrations())
	r.Post("/api/v1/admin/lti/registrations", d.handleAdminPostLtiParentRegistration())
	r.Post("/api/v1/admin/lti/external-tools", d.handleAdminPostExternalTool())
	r.Put("/api/v1/admin/lti/registrations/{id}", d.handleAdminPutLtiParentRegistration())
	r.Delete("/api/v1/admin/lti/registrations/{id}", d.handleAdminDeleteLtiParentRegistration())
	r.Put("/api/v1/admin/lti/external-tools/{id}", d.handleAdminPutLtiExternalTool())
	r.Delete("/api/v1/admin/lti/external-tools/{id}", d.handleAdminDeleteLtiExternalTool())
}

func (d Deps) lti501DeepLink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		lti501JSON("Deep Linking 2.0 handler not yet implemented.")(w, r)
	}
}

func (d Deps) lti501Callback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		lti501JSON("LTI consumer OIDC callback not yet implemented.")(w, r)
	}
}

func (d Deps) lti501LaunchReg() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !d.requireLtiHandler(w) {
			return
		}
		lti501JSON("LTI platform launch initiation not yet implemented.")(w, r)
	}
}

func (d Deps) handlePlatformJWKS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if d.Lti == nil {
			writeSAMLorLTIErr(w, http.StatusBadRequest, "LTI is not enabled on this server.")
			return
		}
		b, err := d.Lti.Keys.JWKSBytes()
		if err != nil {
			writeSAMLorLTIErr(w, http.StatusInternalServerError, "failed to build LTI JWKS")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(b)
	}
}
