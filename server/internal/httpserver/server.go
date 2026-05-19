package httpserver

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/commevents"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/lti"
	"github.com/lextures/lextures/server/internal/notifevents"
	"github.com/lextures/lextures/server/internal/openapi"
	"github.com/lextures/lextures/server/internal/platformstate"
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
	"github.com/lextures/lextures/server/internal/service/cleverauth"
	"github.com/lextures/lextures/server/internal/service/oidcauth"
	"github.com/lextures/lextures/server/internal/service/openrouter"
)

// Deps is the minimal set of server dependencies. Expand with auth, LTI, etc. during the migration.
type Deps struct {
	Pool      *pgxpool.Pool
	Ready     ReadyChecker
	JWTSigner *auth.JWTSigner
	// Config is the environment-only configuration (used with DB overrides in Platform).
	Config   config.Config
	Platform *platformstate.Platform
	OIDC     *oidcauth.Service
	Clever   *cleverauth.Service
	Comm     *commevents.Hub
	Lti      *lti.Runtime
	// BrandingResolver caches hostname→org branding (plan 5.7). Optional; nil builds an ephemeral resolver per request group via brandingResolver().
	BrandingResolver *orgbranding.Resolver
	// PasswordChecker overrides HIBP / password breach checks (tests). When nil, a production checker is built from Pool.
	PasswordChecker hibp.Checker
	// NotifHub broadcasts SSE signals for real-time in-app notification bell updates (plan 6.3). Optional.
	NotifHub *notifevents.Hub
}

func (d Deps) effectiveConfig() config.Config {
	if d.Platform != nil {
		return d.Platform.Config()
	}
	return d.Config
}

func (d Deps) openRouterClient() *openrouter.Client {
	if d.Platform != nil {
		return d.Platform.OpenRouter()
	}
	return nil
}

// NewHandler builds the HTTP API (routes only; does not start listening).
func NewHandler(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(corsAll)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	ready := d.Ready
	if ready == nil {
		ready = defaultReady(d.Pool)
	}
	r.Get("/api/openapi.json", openapi.ServeOpenAPI)
	r.Get("/api/docs", openapi.ServeDocs)
	r.Get("/health", handleHealth())
	r.Get("/health/ready", handleReady(ready))
	r.Post("/api/v1/public/onboarding/track", d.handlePublicOnboardingTrack())
	r.Get("/api/v1/public/branding/resolve", d.handlePublicBrandingResolve())
	r.Get("/api/v1/public/org-branding/{orgId}/{asset}", d.handlePublicOrgBrandAsset())
	r.Get("/api/v1/search", d.handleSearchIndex())
	r.Get("/api/v1/reports/learning-activity", d.handleLearningActivityReport())
	r.Post("/api/v1/recommendations/event", d.handleRecommendationEvent())
	r.Post("/api/v1/webhooks/originality/{provider}", d.handleOriginalityWebhook())
	r.Get("/oneroster/v1p2/*", d.handleOneRosterV1P2())
	d.registerSAMLBrowserRoutes(r)
	d.registerLTIHTTPRoutes(r)
	d.registerAuthRoutes(r)
	d.registerMeRoutes(r)
	d.registerParentRoutes(r)
	d.registerUserRoutes(r)
	d.registerOrgRoutes(r)
	d.registerCourseRoutes(r)
	d.registerMeetingRoutes(r)
	d.registerOfficeHoursRoutes(r)
	d.registerSurveyRoutes(r)
	d.registerLearnerRoutes(r)
	d.registerConceptRoutes(r)
	d.registerDiagnosticRoutes(r)
	d.registerCommunicationRoutes(r)
	d.registerImportRoutes(r)
	d.registerStandardsRoutes(r)
	d.registerSettingsRoutes(r)
	d.registerAdminRoutes(r)
	d.registerSCIMRoutes(r)
	r.Route("/api/v1", func(s chi.Router) { d.registerAccommodationRoutes(s) })
	d.registerUnimplementedV1(r)
	d.mountRouterErrorHandlers(r)
	return r
}

func defaultReady(p *pgxpool.Pool) ReadyChecker {
	if p == nil {
		return func() error { return errNoDBPool }
	}
	return func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return p.Ping(ctx)
	}
}

var errNoDBPool = &degradedErr{s: "database pool is not configured"}

// degradedErr is a lightweight error type for readiness.
type degradedErr struct{ s string }

func (e *degradedErr) Error() string { return e.s }
