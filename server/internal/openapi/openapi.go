// Package openapi serves the API description and Swagger UI until a fuller generated spec exists.
package openapi

import (
	"net/http"
)

// spec is OpenAPI 3.0, aligned with the legacy Rust Utoipa bootstrap (title, one health path).
// Extend this document as route handlers are ported; clients may generate TS types from
// /api/openapi.json per migration notes.
const spec = `{
  "openapi": "3.0.3",
  "info": {
    "title": "StudyDrift API",
    "description": "Lextures LMS HTTP API. Generate TypeScript types: npx openapi-typescript http://localhost:8080/api/openapi.json -o src/lib/api-types.generated.ts (with the API running).",
    "version": "0.1.0"
  },
  "tags": [
    { "name": "meta", "description": "Health and API metadata" },
    { "name": "auth", "description": "Sign-in and password reset (ported from server/src/routes/auth.rs)" },
    { "name": "me", "description": "Current user (ported from server/src/routes/me.rs)" },
    { "name": "accommodations", "description": "Student accommodations (server/src/routes/accommodations.rs)" },
    { "name": "search", "description": "Global search index (server/src/routes/search.rs)" },
    { "name": "reports", "description": "Admin reports (server/src/routes/reports.rs); requires global:app:reports:view" },
    { "name": "communication", "description": "Inbox / messaging (server/src/routes/communication.rs)" },
    { "name": "courses", "description": "Course APIs (server/src/routes/courses.rs; partial in Go)" },
    { "name": "admin", "description": "Global Admin maintenance (server/src/routes/admin.rs; requires global:app:rbac:manage)" },
    { "name": "settings", "description": "Roles and permissions (server/src/routes/rbac.rs; requires global:app:rbac:manage)" }
  ],
  "paths": {
    "/health": {
      "get": {
        "tags": ["meta"],
        "summary": "Liveness",
        "responses": {
          "200": {
            "description": "JSON liveness payload"
          }
        }
      }
    },
    "/api/v1/auth/login": {
      "post": {
        "tags": ["auth"],
        "summary": "Email and password sign-in (short-lived access_token + refresh_token)",
        "responses": { "200": { "description": "Access token, refresh token, expires_in, user" }, "401": { "description": "Invalid credentials" } }
      }
    },
    "/api/v1/auth/signup": {
      "post": {
        "tags": ["auth"],
        "summary": "Create account (teacher role + welcome message; returns access + refresh tokens)",
        "responses": { "200": { "description": "Access token, refresh token, user" }, "409": { "description": "Email taken" } }
      }
    },
    "/api/v1/auth/forgot-password": {
      "post": {
        "tags": ["auth"],
        "summary": "Request password reset email",
        "responses": { "200": { "description": "Generic success message" } }
      }
    },
    "/api/v1/auth/reset-password": {
      "post": {
        "tags": ["auth"],
        "summary": "Complete password reset with one-time token",
        "responses": { "200": { "description": "Password updated" }, "400": { "description": "Invalid or expired token" } }
      }
    },
    "/api/v1/auth/refresh": {
      "post": {
        "tags": ["auth"],
        "summary": "Exchange refresh token for new access token (rotates refresh token)",
        "responses": { "200": { "description": "access_token, refresh_token, expires_in" }, "401": { "description": "Invalid or expired refresh token" } }
      }
    },
    "/api/v1/auth/logout": {
      "post": {
        "tags": ["auth"],
        "summary": "Revoke refresh token (JSON body: refresh_token)",
        "responses": { "200": { "description": "ok" }, "401": { "description": "Invalid refresh token" } }
      }
    },
    "/api/v1/auth/logout-all": {
      "post": {
        "tags": ["auth"],
        "summary": "Revoke all refresh tokens for the current user (Bearer access token)",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "ok" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/auth/magic-link/request": {
      "post": {
        "tags": ["auth"],
        "summary": "Request a one-time email sign-in link (MAGIC_LINK_ENABLED)",
        "responses": { "200": { "description": "Generic message (enumeration-safe)" }, "404": { "description": "Feature disabled" }, "429": { "description": "Rate limited" } }
      }
    },
    "/api/v1/auth/magic-link/consume": {
      "get": {
        "tags": ["auth"],
        "summary": "Consume magic link token from email (query: token, optional redirect_to for SPA)",
        "responses": { "200": { "description": "Access token or MFA pending" }, "410": { "description": "Used or expired token" } }
      },
      "post": {
        "tags": ["auth"],
        "summary": "Consume magic link token (JSON body: token)",
        "responses": { "200": { "description": "Access token or MFA pending" }, "410": { "description": "Used or expired token" } }
      }
    },
    "/api/v1/auth/saml/status": {
      "get": {
        "tags": ["auth"],
        "summary": "SAML IdP status for the login page (default IdP when enabled)",
        "responses": { "200": { "description": "enabled, optional idp" } }
      }
    },
    "/api/v1/auth/oidc/status": {
      "get": {
        "tags": ["auth"],
        "summary": "Which OIDC IdPs are configured (env + custom DB providers)",
        "responses": { "200": { "description": "enabled, apiBase, provider flags, custom" } }
      }
    },
    "/api/v1/auth/oidc/link": {
      "post": {
        "tags": ["auth"],
        "summary": "Start OIDC account linking (returns loginUrl with linkId); browser completes at /auth/oidc/...",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "ok, linkId, loginUrl" }, "400": { "description": "Invalid request" }, "401": { "description": "Not signed in" } }
      }
    },
    "/auth/oidc/{provider}/login": {
      "get": {
        "tags": ["auth"],
        "summary": "Begin OIDC authorization (redirect to IdP; query: next, linkId, configId for custom)",
        "parameters": [
          { "name": "provider", "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "next", "in": "query", "schema": { "type": "string" } },
          { "name": "linkId", "in": "query", "schema": { "type": "string", "format": "uuid" } },
          { "name": "configId", "in": "query", "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "307": { "description": "Redirect to IdP" }, "400": { "description": "Invalid input" }, "503": { "description": "No database" } }
      }
    },
    "/auth/oidc/{provider}/callback": {
      "get": {
        "tags": ["auth"],
        "summary": "OIDC callback; returns HTML with fragment access_token (same as SAML browser flow)",
        "parameters": [
          { "name": "provider", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "text/html" }, "400": { "description": "Invalid code/state" } }
      }
    },
    "/api/v1/search": {
      "get": {
        "tags": ["search", "me"],
        "summary": "Courses the user is enrolled in and people visible with enrollments:read on each course",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "courses, people" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/reports/learning-activity": {
      "get": {
        "tags": ["reports"],
        "summary": "Learning activity (user.user_audit) aggregates for a date range",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "from", "in": "query", "description": "RFC 3339 start (default: 30 days before to)" },
          { "name": "to", "in": "query", "description": "RFC 3339 end exclusive upper bound in SQL (default: now)" }
        ],
        "responses": { "200": { "description": "LearningActivityReport" }, "400": { "description": "Invalid range" }, "401": { "description": "Not signed in" }, "403": { "description": "Missing global:app:reports:view" } }
      }
    },
    "/api/v1/communication/messages": {
      "get": {
        "tags": ["communication", "me"],
        "summary": "List mailbox (folder, optional q); folders: inbox, starred, sent, drafts, trash",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "folder", "in": "query", "required": true, "schema": { "type": "string" } },
          { "name": "q", "in": "query", "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "messages" }, "400": { "description": "Invalid folder" }, "401": { "description": "Not signed in" } }
      },
      "post": {
        "tags": ["communication", "me"],
        "summary": "Send a message to a user by email, or save a draft",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "message id" }, "400": { "description": "Invalid request" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/communication/messages/{id}": {
      "get": {
        "tags": ["communication", "me"],
        "summary": "Get a single message",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } } ],
        "responses": { "200": { "description": "message" }, "404": { "description": "Not found" } }
      },
      "patch": {
        "tags": ["communication", "me"],
        "summary": "Mark read, star, or move to folder",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } } ],
        "responses": { "200": { "description": "ok" }, "400": { "description": "Invalid" }, "404": { "description": "Not found" } }
      }
    },
    "/api/v1/communication/unread-count": {
      "get": {
        "tags": ["communication", "me"],
        "summary": "Unread count for inbox",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "unreadInbox" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/communication/ws": {
      "get": {
        "tags": ["communication", "me"],
        "summary": "WebSocket; first text frame: JSON with authToken (login JWT); server pushes mailbox events",
        "responses": { "200": { "description": "WebSocket upgrade" }, "503": { "description": "realtime not configured" } }
      }
    },
    "/api/v1/courses/{course_code}/course-context": {
      "post": {
        "tags": ["courses", "me"],
        "summary": "Record course visit or content open/leave (LMS state sync; user.user_audit)",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "course_code", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["kind"],
                "properties": {
                  "kind": { "type": "string", "description": "course_visit | content_open | content_leave" },
                  "structureItemId": { "type": "string", "format": "uuid", "description": "Required for content_open / content_leave" }
                }
              }
            }
          }
        },
        "responses": {
          "204": { "description": "Recorded" },
          "400": { "description": "Invalid input" },
          "401": { "description": "Not signed in" },
          "404": { "description": "Not enrolled, unknown course, or content item" }
        }
      }
    },
    "/api/v1/me/permissions": {
      "get": {
        "tags": ["me"],
        "summary": "Effective permission strings (optional courseCode, viewAs query)",
        "parameters": [
          { "name": "courseCode", "in": "query", "schema": { "type": "string" } },
          { "name": "viewAs", "in": "query", "schema": { "type": "string", "enum": ["teacher", "student"] } }
        ],
        "responses": { "200": { "description": "permissionStrings" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/me/oidc-identities": {
      "get": {
        "tags": ["me"],
        "summary": "Linked OIDC identities (id, provider, email)",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "identities array" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/me/oidc-identities/{id}": {
      "delete": {
        "tags": ["me"],
        "summary": "Unlink an OIDC identity by id",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "200": { "description": "ok" }, "401": { "description": "Not signed in" }, "404": { "description": "Not found" } }
      }
    },
    "/api/v1/me/notebooks/query": {
      "post": {
        "tags": ["me"],
        "summary": "RAG over client-supplied course notebook Markdown (OpenRouter)",
        "security": [ { "bearerAuth": [] } ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "question": { "type": "string" },
                  "notebooks": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "courseCode": { "type": "string" },
                        "courseTitle": { "type": "string" },
                        "markdown": { "type": "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "answerMarkdown, sources" },
          "400": { "description": "Invalid input" },
          "401": { "description": "Not signed in" },
          "502": { "description": "Model / OpenRouter error" },
          "503": { "description": "AI not configured" }
        }
      }
    },
    "/api/v1/accommodations/users": {
      "get": {
        "tags": ["accommodations"],
        "summary": "Search learners for accommodation management (q= email, name, sid, or uuid)",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "q", "in": "query", "required": true, "schema": { "type": "string" } } ],
        "responses": { "200": { "description": "users" }, "400": { "description": "Invalid input" }, "401": { "description": "Not signed in" }, "403": { "description": "Missing global:user:accommodations:manage" } }
      }
    },
    "/api/v1/enrollments/{enrollmentID}/accommodation-summary": {
      "get": {
        "tags": ["accommodations"],
        "summary": "Instructor summary of effective accommodation flags for the enrollment (requires course enrollments read on that course)",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "enrollmentID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } } ],
        "responses": { "200": { "description": "hasAccommodation, flags" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" }, "404": { "description": "Not found" } }
      }
    },
    "/api/v1/users/{userID}/accommodations": {
      "get": {
        "tags": ["accommodations"],
        "summary": "List a learner’s accommodation records (coordinator perm)",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "userID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } } ],
        "responses": { "200": { "description": "Array of accommodation records" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      },
      "post": {
        "tags": ["accommodations"],
        "summary": "Create a learner accommodation row",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [ { "name": "userID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } } ],
        "responses": { "200": { "description": "Record" }, "400": { "description": "Validation or unknown course" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/users/{userID}/accommodations/{accommodationID}": {
      "put": {
        "tags": ["accommodations"],
        "summary": "Update an accommodation row",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "userID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } },
          { "name": "accommodationID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "200": { "description": "Record" }, "400": { "description": "Validation" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" }, "404": { "description": "Not found" } }
      },
      "delete": {
        "tags": ["accommodations"],
        "summary": "Delete an accommodation row",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "userID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } },
          { "name": "accommodationID", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "204": { "description": "No content" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" }, "404": { "description": "Not found" } }
      }
    },
    "/api/v1/me/accommodations": {
      "get": {
        "tags": ["accommodations", "me"],
        "summary": "List this learner’s active (by date range) accommodation summary entries",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "accommodations" }, "401": { "description": "Not signed in" } }
      }
    },
    "/api/v1/admin/jobs/irt-calibrate": {
      "post": {
        "tags": ["admin"],
        "summary": "Start IRT calibration (202 + jobId; 2PL body not yet ported in Go — background is a no-op log)",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "202": { "description": "Accepted" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/originality-config": {
      "put": {
        "tags": ["admin"],
        "summary": "Upsert platform originality provider settings",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "ok" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/users/{userId}/dsar-export": {
      "get": {
        "tags": ["admin"],
        "summary": "DSAR FERPA slice: originality report metadata for a user",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "userId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "200": { "description": "Export" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/users/{userId}/sessions": {
      "delete": {
        "tags": ["admin"],
        "summary": "Revoke all refresh tokens and bump session version for a user (plan 4.8)",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "userId", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "200": { "description": "ok" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/saml/config": {
      "get": {
        "tags": ["admin"],
        "summary": "Default SAML IdP config (or { config: null })",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "IdP or null config" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      },
      "put": {
        "tags": ["admin"],
        "summary": "Create or update SAML IdP",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "id, entityId" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/oidc/providers": {
      "get": {
        "tags": ["admin"],
        "summary": "List custom OIDC provider configurations",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "providers" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      },
      "put": {
        "tags": ["admin"],
        "summary": "Create or update a custom OIDC provider",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "id" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      }
    },
    "/api/v1/admin/provisioning/oneroster/upload": {
      "post": {
        "tags": ["admin"],
        "summary": "Upload OneRoster CSV bundle (multipart; ONEROSTER_ENABLED=1)",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "201": { "description": "syncRunId" }, "400": {}, "401": {}, "403": {}, "404": { "description": "Feature off" } }
      }
    },
    "/api/v1/admin/provisioning/oneroster/sync-runs": {
      "get": {
        "tags": ["admin"],
        "summary": "List OneRoster sync runs for an institution",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "syncRuns" }, "401": {}, "403": {}, "404": {} }
      }
    },
    "/api/v1/admin/provisioning/oneroster/sync-runs/{id}": {
      "get": {
        "tags": ["admin"],
        "summary": "OneRoster sync run event log",
        "security": [ { "bearerAuth": [] } ],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": { "200": { "description": "events" }, "401": {}, "403": {}, "404": {} }
      }
    },
    "/api/v1/admin/provisioning/oneroster/bearer-credentials": {
      "post": {
        "tags": ["admin"],
        "summary": "Register hashed bearer token for GET /oneroster/v1p2/*",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "ok" }, "401": {}, "403": {}, "404": {} }
      }
    },
    "/oneroster/v1p2/users": {
      "get": {
        "tags": ["admin"],
        "summary": "OneRoster-style users collection (Bearer token from admin credential)",
        "responses": { "200": {}, "401": {} }
      }
    },
      "get": {
        "tags": ["settings"],
        "summary": "List all permission rows",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "permissions" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      },
      "post": {
        "tags": ["settings"],
        "summary": "Create a permission",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "permission" }, "400": { "description": "Invalid input" }, "401": {}, "403": {} }
      }
    },
    "/api/v1/settings/roles": {
      "get": {
        "tags": ["settings"],
        "summary": "List app roles and attached permissions",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "roles" }, "401": { "description": "Not signed in" }, "403": { "description": "Forbidden" } }
      },
      "post": {
        "tags": ["settings"],
        "summary": "Create an app role (empty permissions)",
        "security": [ { "bearerAuth": [] } ],
        "responses": { "200": { "description": "role" }, "400": {}, "401": {}, "403": {} }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" }
    }
  }
}`

const docHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>StudyDrift API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin="anonymous"></script>
<script>
  window.onload = function () {
    window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });
  };
</script>
</body>
</html>
`

// ServeOpenAPI returns the OpenAPI JSON document.
func ServeOpenAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(spec))
}

// ServeDocs returns HTML that loads Swagger UI against /api/openapi.json.
func ServeDocs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(docHTML))
}
