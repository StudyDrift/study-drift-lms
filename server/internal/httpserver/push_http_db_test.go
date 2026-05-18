package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/notifevents"
	"github.com/lextures/lextures/server/internal/repos/notificationsinbox"
)

func TestPushHTTP_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	cfg := config.Config{
		PublicWebOrigin:          "http://localhost:5173",
		PushNotificationsEnabled: true,
		VAPIDPublicKey:           "BNIpFbFi5jEBClXBM6RNzVu0B9PJh0GdHfmQnTW4JdBKpuU5U6xIW2LfpXyHn_iy4ixSL1Rj_tDl5rPXpd7JqV0",
	}
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	jwtSecret := "01234567890123456789012345678901"
	d := Deps{
		Pool:            pool,
		JWTSigner:       auth.NewJWTSignerWithPool(jwtSecret, pool),
		Config:          cfg,
		PasswordChecker: stub,
		NotifHub:        notifevents.New(),
	}
	h := NewHandler(d)

	// Sign up a test user.
	email := "push-test-" + time.Now().Format("20060102150405.000") + "@e.invalid"
	password := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	signupBody, _ := json.Marshal(map[string]any{
		"email":        email,
		"password":     password,
		"display_name": "Push Tester",
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", bytes.NewReader(signupBody))
	req = req.WithContext(ctx)
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("signup: %d %s", rr.Code, rr.Body.String())
	}
	var signupResp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&signupResp); err != nil {
		t.Fatalf("decode signup: %v", err)
	}
	token, _ := signupResp["access_token"].(string)
	if token == "" {
		t.Fatal("no access_token in signup response")
	}

	// Extract user ID from token for direct DB operations.
	authUser, err := d.JWTSigner.Verify(ctx, token)
	if err != nil {
		t.Fatalf("verify token: %v", err)
	}
	userID := uuid.MustParse(authUser.UserID)

	t.Run("vapid_public_key_no_auth", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/push/vapid-public-key", nil)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("vapid key: %d %s", rr.Code, rr.Body.String())
		}
		var resp map[string]string
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		if resp["publicKey"] == "" {
			t.Fatal("expected publicKey in response")
		}
	})

	t.Run("register_push_subscription", func(t *testing.T) {
		subBody, _ := json.Marshal(map[string]any{
			"endpoint":  "https://push.example.com/endpoint-" + time.Now().Format("150405.000"),
			"keys":      map[string]string{"p256dh": "BNIpFbFi5jEBClXBM6RNzVu0", "auth": "dGVzdA"},
			"userAgent": "TestAgent/1.0",
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/me/push-subscriptions", bytes.NewReader(subBody))
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("register subscription: %d %s", rr.Code, rr.Body.String())
		}
		var resp map[string]string
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		if resp["id"] == "" {
			t.Fatal("expected id in response")
		}
	})

	t.Run("delete_push_subscription", func(t *testing.T) {
		endpoint := "https://push.example.com/del-" + time.Now().Format("150405.000")
		subBody, _ := json.Marshal(map[string]any{
			"endpoint": endpoint,
			"keys":     map[string]string{"p256dh": "BNIpFbFi5jEBClXBM6RNzVu0", "auth": "dGVzdA"},
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/me/push-subscriptions", bytes.NewReader(subBody))
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create for delete: %d", rr.Code)
		}
		var createResp map[string]string
		_ = json.NewDecoder(rr.Body).Decode(&createResp)
		id := createResp["id"]

		rr2 := httptest.NewRecorder()
		req2 := httptest.NewRequest(http.MethodDelete, "/api/v1/me/push-subscriptions/"+id, nil)
		req2 = req2.WithContext(ctx)
		req2.Header.Set("Authorization", "Bearer "+token)
		h.ServeHTTP(rr2, req2)
		if rr2.Code != http.StatusNoContent {
			t.Fatalf("delete subscription: %d %s", rr2.Code, rr2.Body.String())
		}
	})

	t.Run("get_notifications_empty", func(t *testing.T) {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/me/notifications", nil)
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get notifications: %d %s", rr.Code, rr.Body.String())
		}
		var resp map[string]any
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		if resp["unreadCount"] == nil {
			t.Fatal("expected unreadCount in response")
		}
	})

	t.Run("mark_all_read", func(t *testing.T) {
		_, err := notificationsinbox.Insert(ctx, pool, userID, "grade_posted", "Test Grade", "Your grade was posted.", "")
		if err != nil {
			t.Fatalf("insert notification: %v", err)
		}

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/me/notifications/read-all", nil)
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("mark all read: %d %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("mark_single_read", func(t *testing.T) {
		notifID, err := notificationsinbox.Insert(ctx, pool, userID, "grade_posted", "Grade 2", "Another grade.", "")
		if err != nil {
			t.Fatalf("insert notification: %v", err)
		}

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/me/notifications/"+notifID.String()+"/read", nil)
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("mark read: %d %s", rr.Code, rr.Body.String())
		}
	})

	t.Run("push_subscription_requires_auth", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"endpoint": "https://push.example.com/x",
			"keys":     map[string]string{"p256dh": "a", "auth": "b"},
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/me/push-subscriptions", bytes.NewReader(body))
		req = req.WithContext(ctx)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rr.Code)
		}
	})

	t.Run("notifications_unread_count_after_insert", func(t *testing.T) {
		// Insert a fresh notification.
		_, err := notificationsinbox.Insert(ctx, pool, userID, "assignment_created", "New Assignment", "Check it out.", "/courses/test")
		if err != nil {
			t.Fatalf("insert: %v", err)
		}

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/me/notifications", nil)
		req = req.WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get notifications: %d", rr.Code)
		}
		var resp map[string]any
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		unread, _ := resp["unreadCount"].(float64)
		if unread < 1 {
			t.Fatalf("expected unreadCount >= 1, got %v", unread)
		}
	})
}
