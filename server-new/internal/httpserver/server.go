package httpserver

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/commevents"
	"github.com/lextures/lextures/server-new/internal/config"
	"github.com/lextures/lextures/server-new/internal/lti"
	"github.com/lextures/lextures/server-new/internal/openapi"
	"github.com/lextures/lextures/server-new/internal/service/oidcauth"
	"github.com/lextures/lextures/server-new/internal/service/openrouter"
)

// Deps is the minimal set of server dependencies. Expand with auth, LTI, etc. during the migration.
type Deps struct {
	Pool       *pgxpool.Pool
	Ready      ReadyChecker
	JWTSigner  *auth.JWTSigner
	Config     config.Config
	OpenRouter *openrouter.Client
	OIDC       *oidcauth.Service
	Comm       *commevents.Hub
	Lti        *lti.Runtime
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
	d.registerSAMLBrowserRoutes(r)
	d.registerLTIHTTPRoutes(r)
	r.Get("/auth/oidc/{provider}/login", d.handleOIDCLogin())
	r.Get("/auth/oidc/{provider}/callback", d.handleOIDCCallback())
	r.Post("/api/v1/auth/login", d.handleLogin())
	r.Post("/api/v1/auth/signup", d.handleSignup())
	r.Post("/api/v1/auth/forgot-password", d.handleForgotPassword())
	r.Post("/api/v1/auth/reset-password", d.handleResetPassword())
	r.Get("/api/v1/auth/saml/status", d.handleSAMLStatus())
	r.Get("/api/v1/auth/oidc/status", d.handleOIDCStatus())
	r.Post("/api/v1/auth/oidc/link", d.handleOIDCLink())
	r.Get("/api/v1/me/permissions", d.handleMyPermissions())
	r.Get("/api/v1/courses", d.handleListCourses())
	r.Post("/api/v1/courses", d.handleCreateCourse())
	// One Route for /api/v1/courses/{course_code} so GET and PATCH /markdown-theme share the same chi subtree
	// (registering a separate r.Get + r.Route on the same path prefix drops the leaf GET).
	r.Route("/api/v1/courses/{course_code}", func(cr chi.Router) {
		cr.Get("/", d.handleGetCourse())
		cr.Put("/", d.handlePutCourse())
		cr.Patch("/markdown-theme", d.handlePatchCourseMarkdownTheme())
	})
	r.Get("/api/v1/settings/account", d.handleGetSettingsAccount())
	r.Patch("/api/v1/settings/account", d.handlePatchSettingsAccount())
	// More specific /settings/ai/* first (before registerUnimplementedV1).
	r.Get("/api/v1/settings/ai/models", d.handleListAIModels())
	r.Get("/api/v1/settings/ai", d.handleGetSettingsAI())
	r.Put("/api/v1/settings/ai", d.handlePutSettingsAI())
	r.Get("/api/v1/settings/system-prompts", d.handleListSystemPrompts())
	r.Put("/api/v1/settings/system-prompts/{key}", d.handlePutSystemPrompt())
	r.Get("/api/v1/search", d.handleSearchIndex())
	r.Get("/api/v1/reports/learning-activity", d.handleLearningActivityReport())
	r.Post("/api/v1/courses/{course_code}/course-context", d.handlePostCourseContext())
	r.Get("/api/v1/me/oidc-identities", d.handleMyOIDCIdentities())
	r.Delete("/api/v1/me/oidc-identities/{id}", d.handleDeleteMyOIDCIdentity())
	r.Post("/api/v1/me/notebooks/query", d.handleNotebookQuery())
	// LMS dashboard: registered before registerUnimplementedV1 so /api/v1/learners/* is not 501.
	r.Get("/api/v1/learners/{user_id}/review-stats", d.handleLearnerReviewStats())
	r.Get("/api/v1/learners/{user_id}/recommendations", d.handleLearnerRecommendations())
	r.Get("/api/v1/courses/{course_code}/structure", d.handleCourseStructure())
	r.Get("/api/v1/courses/{course_code}/structure/archived", d.handleCourseStructureArchived())
	r.Post("/api/v1/courses/{course_code}/structure/modules", d.handleCreateCourseModule())
	r.Get("/api/v1/courses/{course_code}/assignments/{item_id}", d.handleGetModuleAssignment())
	r.Patch("/api/v1/courses/{course_code}/assignments/{item_id}", d.handlePatchModuleAssignment())
	r.Get("/api/v1/courses/{course_code}/assignments/{item_id}/markups", d.handleListAssignmentMarkups())
	r.Get("/api/v1/courses/{course_code}/grading", d.handleGetCourseGrading())
	r.Put("/api/v1/courses/{course_code}/grading", d.handlePutCourseGrading())
	r.Get("/api/v1/courses/{course_code}/grading-scheme", d.handleGetCourseGradingScheme())
	r.Put("/api/v1/courses/{course_code}/grading-scheme", d.handlePutCourseGradingScheme())
	r.Get("/api/v1/courses/{course_code}/course-files/{file_id}/content", d.handleGetCourseFileContent())
	r.Patch("/api/v1/courses/{course_code}/structure/items/{item_id}", d.handlePatchCourseStructureItem())
	r.Delete("/api/v1/courses/{course_code}/structure/items/{item_id}", d.handleDeleteCourseStructureItem())
	r.Get("/api/v1/courses/{course_code}/my-grades", d.handleCourseMyGrades())
	r.Get("/api/v1/courses/{course_code}/feed/channels", d.handleFeedChannels())
	r.Post("/api/v1/courses/{course_code}/feed/channels", d.handleCreateFeedChannel())
	r.Get("/api/v1/courses/{course_code}/feed/channels/{channel_id}/messages", d.handleFeedMessagesList())
	r.Post("/api/v1/courses/{course_code}/feed/channels/{channel_id}/messages", d.handleFeedMessagePost())
	r.Get("/api/v1/courses/{course_code}/feed/roster", d.handleFeedRoster())
	r.Get("/api/v1/courses/{course_code}/gradebook/grid", d.handleGradebookGrid())
	r.Get("/api/v1/courses/{course_code}/enrollments", d.handleCourseEnrollmentsList())
	r.Patch("/api/v1/courses/{course_code}/features", d.handlePatchCourseFeatures())
	r.Patch("/api/v1/courses/{course_code}/archived", d.handlePatchCourseArchived())
	r.Get("/api/v1/courses/{course_code}/outcomes", d.handleCourseOutcomesList())
	r.Post("/api/v1/courses/{course_code}/factory-reset", d.handlePostFactoryResetCourse())
	// Nesting keeps /syllabus/markups, /syllabus/accept, etc. on the same chi subtree so longer paths
	// are not lost to a mis-ordered /syllabus leaf.
	r.Route("/api/v1/courses/{course_code}/syllabus", func(s chi.Router) {
		s.Get("/acceptance-status", d.handleSyllabusAcceptanceStatus())
		s.Get("/markups", d.handleListSyllabusMarkups())
		s.Post("/markups", d.handleCreateSyllabusMarkup())
		s.Delete("/markups/{markup_id}", d.handleDeleteSyllabusMarkup())
		s.Post("/generate-section", d.handleGenerateSyllabusSection())
		s.Get("/", d.handleGetCourseSyllabus())
		s.Patch("/", d.handlePatchCourseSyllabus())
		s.Post("/accept", d.handlePostSyllabusAccept())
	})
	r.Get("/api/v1/courses/{course_code}/feed/ws", d.handleFeedWS())
	r.Get("/api/v1/courses/{course_code}/import/canvas/ws", d.handleCourseImportCanvasWS())
	r.Get("/api/v1/communication/messages", d.handleCommMessagesList())
	r.Post("/api/v1/communication/messages", d.handleCommMessagesPost())
	r.Get("/api/v1/communication/messages/{id}", d.handleCommMessageGet())
	r.Patch("/api/v1/communication/messages/{id}", d.handleCommMessagePatch())
	r.Get("/api/v1/communication/unread-count", d.handleCommUnread())
	r.Get("/api/v1/communication/ws", d.handleCommWS())
	r.Route("/api/v1", func(s chi.Router) { d.registerAccommodationRoutes(s) })
	r.Route("/api/v1/settings", func(s chi.Router) { d.registerSettingsRBAC(s) })
	r.Post("/api/v1/admin/jobs/irt-calibrate", d.handleAdminIRTCalibrate())
	r.Put("/api/v1/admin/originality-config", d.handleAdminPutOriginality())
	r.Get("/api/v1/admin/users/{userId}/dsar-export", d.handleAdminDSARExport())
	r.Get("/api/v1/admin/saml/config", d.handleAdminSAMLGet())
	r.Put("/api/v1/admin/saml/config", d.handleAdminSAMLPut())
	r.Get("/api/v1/admin/oidc/providers", d.handleAdminOIDCProvidersGet())
	r.Put("/api/v1/admin/oidc/providers", d.handleAdminOIDCProviderPut())
	r.Get("/api/v1/standards/search", d.handleSearchStandards())
	r.Get("/api/v1/standards/{id}", d.handleGetStandard())
	r.Get("/api/v1/standards", d.handleListStandards())
	r.Post("/api/v1/imports/qti", d.handleQTIImportStart())
	r.Get("/api/v1/imports/{job_id}/status", d.handleImportStatus())
	r.Get("/api/v1/imports", d.handleListImports())
	r.Post("/api/v1/recommendations/event", d.handleRecommendationEvent())
	r.Post("/api/v1/webhooks/originality/{provider}", d.handleOriginalityWebhook())
	r.Get("/api/v1/surveys/{id}", d.handleGetSurvey())
	r.Put("/api/v1/surveys/{id}", d.handlePutSurvey())
	r.Post("/api/v1/surveys/{id}/respond", d.handleSurveyRespond())
	r.Get("/api/v1/surveys/{id}/results", d.handleSurveyResults())
	r.Get("/api/v1/courses/{course_code}/surveys", d.handleListCourseSurveys())
	r.Post("/api/v1/courses/{course_code}/surveys", d.handleCreateCourseSurvey())
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
