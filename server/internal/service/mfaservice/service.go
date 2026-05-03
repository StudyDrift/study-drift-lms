package mfaservice

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/go-webauthn/webauthn/protocol"
	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/hotp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/user"
)

const (
	maxMFAFailuresPerWindow = 10
	mfaLockoutDuration      = 15 * time.Minute
	mfaRateWindow           = 15 * time.Minute
	backupCodeCount         = 10
	backupCodeBytes         = 5 // 10 hex chars
	bcryptCost              = 12
)

var (
	ErrMFAInvalid           = errors.New("mfa: invalid code")
	ErrMFAReplay            = errors.New("mfa: code replay")
	ErrMFADisabled          = errors.New("mfa: feature disabled")
	ErrMFAWebAuthnNotReady  = errors.New("mfa: webauthn not configured")
	ErrMFAEnrolmentRequired = errors.New("mfa: enrolment required")
	errReplay               = errors.New("replay")
)

// WebAuthnFromConfig builds a WebAuthn instance from public web origin (RPID = host).
func WebAuthnFromConfig(cfg config.Config) (*webauthnlib.WebAuthn, error) {
	origin := strings.TrimSpace(cfg.PublicWebOrigin)
	if origin == "" {
		return nil, fmt.Errorf("public web origin required for webauthn")
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("invalid public web origin")
	}
	rpID := u.Hostname()
	if rpID == "" {
		return nil, fmt.Errorf("invalid rp id")
	}
	wcfg := &webauthnlib.Config{
		RPDisplayName: "Lextures",
		RPID:          rpID,
		RPOrigins:     []string{strings.TrimRight(origin, "/")},
		Timeouts: webauthnlib.TimeoutsConfig{
			Login: webauthnlib.TimeoutConfig{
				Enforce: true,
				Timeout: 60 * time.Second,
			},
			Registration: webauthnlib.TimeoutConfig{
				Enforce: true,
				Timeout: 60 * time.Second,
			},
		},
	}
	return webauthnlib.New(wcfg)
}

type webUser struct {
	id          uuid.UUID
	email       string
	displayName string
	creds       []webauthnlib.Credential
}

func (w webUser) WebAuthnID() []byte {
	return []byte(w.id.String())
}

func (w webUser) WebAuthnName() string {
	return w.email
}

func (w webUser) WebAuthnDisplayName() string {
	if strings.TrimSpace(w.displayName) != "" {
		return w.displayName
	}
	return w.email
}

func (w webUser) WebAuthnCredentials() []webauthnlib.Credential {
	return w.creds
}

func loadWebUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (webUser, error) {
	row, err := user.FindByID(ctx, pool, userID)
	if err != nil {
		return webUser{}, err
	}
	if row == nil {
		return webUser{}, errors.New("user not found")
	}
	dn := ""
	if row.DisplayName != nil {
		dn = *row.DisplayName
	}
	rows, err := pool.Query(ctx, `
SELECT credential_id, public_key_cbor, sign_count::bigint
FROM "user".mfa_webauthn_credentials WHERE user_id = $1
`, userID)
	if err != nil {
		return webUser{}, err
	}
	defer rows.Close()
	var creds []webauthnlib.Credential
	for rows.Next() {
		var cid, pk []byte
		var sc int64
		if err := rows.Scan(&cid, &pk, &sc); err != nil {
			return webUser{}, err
		}
		creds = append(creds, webauthnlib.Credential{
			ID:        cid,
			PublicKey: pk,
			Authenticator: webauthnlib.Authenticator{
				SignCount: uint32(sc),
			},
		})
	}
	return webUser{id: userID, email: row.Email, displayName: dn, creds: creds}, rows.Err()
}

func checkMFAEnabled(cfg config.Config) error {
	if !cfg.MFAEnabled {
		return ErrMFADisabled
	}
	return nil
}

func readLockout(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (*time.Time, error) {
	var until sql.NullTime
	err := pool.QueryRow(ctx, `SELECT mfa_lockout_until FROM "user".users WHERE id = $1`, userID).Scan(&until)
	if err != nil {
		return nil, err
	}
	if until.Valid {
		t := until.Time.UTC()
		return &t, nil
	}
	return nil, nil
}

func isLockedOut(lock *time.Time) bool {
	if lock == nil {
		return false
	}
	return time.Now().UTC().Before(*lock)
}

func recordMFAFailure(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var windowStart sql.NullTime
	var failures int
	var lockUntil sql.NullTime
	err = tx.QueryRow(ctx, `
SELECT mfa_rate_window_start, mfa_rate_failures, mfa_lockout_until
FROM "user".users WHERE id = $1 FOR UPDATE
`, userID).Scan(&windowStart, &failures, &lockUntil)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	nextFailures := 1
	nextWindow := now
	if windowStart.Valid && now.Sub(windowStart.Time) < mfaRateWindow {
		nextFailures = failures + 1
		nextWindow = windowStart.Time
	}
	var lock *time.Time
	if nextFailures >= maxMFAFailuresPerWindow {
		t := now.Add(mfaLockoutDuration)
		lock = &t
	}
	if lock != nil {
		_, err = tx.Exec(ctx, `
UPDATE "user".users SET
  mfa_rate_failures = $2,
  mfa_rate_window_start = $3,
  mfa_lockout_until = $4
WHERE id = $1
`, userID, 0, now, lock)
	} else {
		_, err = tx.Exec(ctx, `
UPDATE "user".users SET
  mfa_rate_failures = $2,
  mfa_rate_window_start = $3
WHERE id = $1
`, userID, nextFailures, nextWindow)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func clearMFAFailureWindow(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
UPDATE "user".users SET mfa_rate_failures = 0, mfa_rate_window_start = NULL, mfa_lockout_until = NULL WHERE id = $1
`, userID)
	return err
}

// BeginTOTPEnrol creates an unverified TOTP credential and returns the otpauth URI for QR display.
func BeginTOTPEnrol(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, userID uuid.UUID) (credID string, otpauthURI string, err error) {
	if err := checkMFAEnabled(cfg); err != nil {
		return "", "", err
	}
	row, err := user.FindByID(ctx, pool, userID)
	if err != nil || row == nil {
		return "", "", errors.New("user not found")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := deleteUnverifiedTOTPTx(ctx, tx, userID); err != nil {
		return "", "", err
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Lextures",
		AccountName: row.Email,
	})
	if err != nil {
		return "", "", err
	}
	id, err := insertTOTPSecretTx(ctx, tx, userID, key.Secret())
	if err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	insertAudit(ctx, pool, userID, "totp_enrol_begin", nil)
	return id.String(), key.URL(), nil
}

// VerifyTOTPEnrol confirms the first OTP, marks TOTP verified, and returns one-time backup codes.
func VerifyTOTPEnrol(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, userID uuid.UUID, credID uuid.UUID, code string) ([]string, error) {
	if err := checkMFAEnabled(cfg); err != nil {
		return nil, err
	}
	secret, verified, _, err := getTOTPCred(ctx, pool, credID, userID)
	if err != nil {
		return nil, err
	}
	if verified {
		return nil, errors.New("already verified")
	}
	if !totp.Validate(strings.TrimSpace(code), secret) {
		return nil, ErrMFAInvalid
	}
	codes, hashes, err := generateBackupCodes()
	if err != nil {
		return nil, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := verifyTOTPCredential(ctx, tx, credID); err != nil {
		return nil, err
	}
	if err := replaceBackupCodesTx(ctx, tx, userID, hashes); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	insertAudit(ctx, pool, userID, "totp_enrol_complete", map[string]any{"credentialId": credID.String()})
	return codes, nil
}

func generateBackupCodes() (plain []string, hashes []string, err error) {
	plain = make([]string, backupCodeCount)
	hashes = make([]string, backupCodeCount)
	for i := range plain {
		var raw [backupCodeBytes]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return nil, nil, err
		}
		s := fmt.Sprintf("%X", raw[:])
		plain[i] = s
		h, err := bcrypt.GenerateFromPassword([]byte(s), bcryptCost)
		if err != nil {
			return nil, nil, err
		}
		hashes[i] = string(h)
	}
	return plain, hashes, nil
}

// TOTPChallenge verifies a TOTP during login (mfa_pending token consumed by caller).
func TOTPChallenge(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, userID uuid.UUID, code string) error {
	if err := checkMFAEnabled(cfg); err != nil {
		return err
	}
	lock, err := readLockout(ctx, pool, userID)
	if err != nil {
		return err
	}
	if isLockedOut(lock) {
		return errors.New("mfa: too many attempts; try again later")
	}
	code = strings.TrimSpace(code)
	rows, err := pool.Query(ctx, `
SELECT id, secret, last_used_period FROM "user".mfa_totp_credentials
WHERE user_id = $1 AND verified
`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	now := time.Now().UTC()
	cur := now.Unix() / 30
	for rows.Next() {
		var id uuid.UUID
		var secret string
		var lp sql.NullInt64
		if err := rows.Scan(&id, &secret, &lp); err != nil {
			return err
		}
		for delta := -1; delta <= 1; delta++ {
			period := cur + int64(delta)
			if period < 0 {
				continue
			}
			ok, err := hotp.ValidateCustom(code, uint64(period), secret, hotp.ValidateOpts{
				Digits:    otp.DigitsSix,
				Algorithm: otp.AlgorithmSHA1,
			})
			if err != nil || !ok {
				continue
			}
			if lp.Valid && lp.Int64 == period {
				_ = recordMFAFailure(ctx, pool, userID)
				insertAudit(ctx, pool, userID, "totp_challenge_fail", map[string]any{"reason": "replay"})
				return ErrMFAReplay
			}
			if err := markTOTPUsed(ctx, pool, id, period); err != nil {
				if errors.Is(err, errReplay) {
					_ = recordMFAFailure(ctx, pool, userID)
					insertAudit(ctx, pool, userID, "totp_challenge_fail", map[string]any{"reason": "replay"})
					return ErrMFAReplay
				}
				return err
			}
			_ = clearMFAFailureWindow(ctx, pool, userID)
			insertAudit(ctx, pool, userID, "totp_challenge_success", nil)
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = recordMFAFailure(ctx, pool, userID)
	insertAudit(ctx, pool, userID, "totp_challenge_fail", map[string]any{"reason": "invalid"})
	return ErrMFAInvalid
}

// BackupCodeChallenge verifies a backup code during login.
func BackupCodeChallenge(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, userID uuid.UUID, code string) error {
	if err := checkMFAEnabled(cfg); err != nil {
		return err
	}
	lock, err := readLockout(ctx, pool, userID)
	if err != nil {
		return err
	}
	if isLockedOut(lock) {
		return errors.New("mfa: too many attempts; try again later")
	}
	code = strings.TrimSpace(strings.ToUpper(code))
	if len(code) < 8 {
		_ = recordMFAFailure(ctx, pool, userID)
		return ErrMFAInvalid
	}
	rows, err := pool.Query(ctx, `SELECT id, code_hash FROM "user".mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var hash string
		if err := rows.Scan(&id, &hash); err != nil {
			return err
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(code)) == nil {
			ok, err := consumeBackupCode(ctx, pool, userID, hash)
			if err != nil {
				return err
			}
			if !ok {
				continue
			}
			_ = clearMFAFailureWindow(ctx, pool, userID)
			insertAudit(ctx, pool, userID, "backup_code_success", map[string]any{"id": id.String()})
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_ = recordMFAFailure(ctx, pool, userID)
	insertAudit(ctx, pool, userID, "backup_code_fail", nil)
	return ErrMFAInvalid
}

// BeginWebAuthnRegister starts passkey registration for a signed-in user.
func BeginWebAuthnRegister(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, wa *webauthnlib.WebAuthn, userID uuid.UUID) (sessionID string, options json.RawMessage, err error) {
	if err := checkMFAEnabled(cfg); err != nil {
		return "", nil, err
	}
	if wa == nil {
		return "", nil, ErrMFAWebAuthnNotReady
	}
	wu, err := loadWebUser(ctx, pool, userID)
	if err != nil {
		return "", nil, err
	}
	creation, session, err := wa.BeginRegistration(wu)
	if err != nil {
		return "", nil, err
	}
	sid := uuid.NewString()
	raw, err := json.Marshal(creation.Response)
	if err != nil {
		return "", nil, err
	}
	sessBytes, err := marshalSession(session)
	if err != nil {
		return "", nil, err
	}
	exp := time.Now().UTC().Add(60 * time.Second)
	if err := storeWebAuthnSession(ctx, pool, sid, userID, "register", sessBytes, exp); err != nil {
		return "", nil, err
	}
	insertAudit(ctx, pool, userID, "webauthn_register_begin", nil)
	return sid, raw, nil
}

// FinishWebAuthnRegister completes passkey registration. Returns backup codes when newly generated (WebAuthn-first enrolment).
func FinishWebAuthnRegister(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, wa *webauthnlib.WebAuthn, userID uuid.UUID, sessionID string, body []byte, displayName string) ([]string, error) {
	if err := checkMFAEnabled(cfg); err != nil {
		return nil, err
	}
	if wa == nil {
		return nil, ErrMFAWebAuthnNotReady
	}
	sUser, kind, data, err := loadWebAuthnSession(ctx, pool, sessionID)
	if err != nil {
		return nil, err
	}
	if kind != "register" || sUser != userID {
		return nil, errors.New("invalid webauthn session")
	}
	sd, err := unmarshalSession(data)
	if err != nil {
		return nil, err
	}
	wu, err := loadWebUser(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body)
	if err != nil {
		return nil, err
	}
	cred, err := wa.CreateCredential(wu, sd, parsed)
	if err != nil {
		return nil, err
	}
	var aagu uuid.UUID
	if len(cred.Authenticator.AAGUID) == 16 {
		if u, err := uuid.FromBytes(cred.Authenticator.AAGUID); err == nil {
			aagu = u
		}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := insertWebAuthnCredTx(ctx, tx, userID, cred.ID, cred.PublicKey, cred.Authenticator.SignCount, displayName, nullableUUID(aagu)); err != nil {
		return nil, err
	}
	// First WebAuthn enrolment: ensure backup codes exist (same as TOTP path).
	var n int
	_ = tx.QueryRow(ctx, `SELECT COUNT(*)::int FROM "user".mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&n)
	if n == 0 {
		codes, hashes, err := generateBackupCodes()
		if err != nil {
			return nil, err
		}
		if err := replaceBackupCodesTx(ctx, tx, userID, hashes); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		deleteWebAuthnSession(ctx, pool, sessionID)
		insertAudit(ctx, pool, userID, "webauthn_register_complete", map[string]any{"displayName": displayName})
		return codes, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	deleteWebAuthnSession(ctx, pool, sessionID)
	insertAudit(ctx, pool, userID, "webauthn_register_complete", map[string]any{"displayName": displayName})
	return nil, nil
}

func nullableUUID(u uuid.UUID) *uuid.UUID {
	if u == uuid.Nil {
		return nil
	}
	return &u
}

// BeginWebAuthnLogin starts assertion for MFA pending user.
func BeginWebAuthnLogin(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, wa *webauthnlib.WebAuthn, userID uuid.UUID) (sessionID string, options json.RawMessage, err error) {
	if err := checkMFAEnabled(cfg); err != nil {
		return "", nil, err
	}
	if wa == nil {
		return "", nil, ErrMFAWebAuthnNotReady
	}
	wu, err := loadWebUser(ctx, pool, userID)
	if err != nil {
		return "", nil, err
	}
	if len(wu.creds) == 0 {
		return "", nil, errors.New("no webauthn credentials")
	}
	assertion, session, err := wa.BeginLogin(wu)
	if err != nil {
		return "", nil, err
	}
	sid := uuid.NewString()
	raw, err := json.Marshal(assertion.Response)
	if err != nil {
		return "", nil, err
	}
	sessBytes, err := marshalSession(session)
	if err != nil {
		return "", nil, err
	}
	exp := time.Now().UTC().Add(60 * time.Second)
	if err := storeWebAuthnSession(ctx, pool, sid, userID, "login", sessBytes, exp); err != nil {
		return "", nil, err
	}
	insertAudit(ctx, pool, userID, "webauthn_assert_begin", nil)
	return sid, raw, nil
}

// FinishWebAuthnLogin completes assertion during MFA challenge.
func FinishWebAuthnLogin(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, wa *webauthnlib.WebAuthn, userID uuid.UUID, sessionID string, body []byte) error {
	if err := checkMFAEnabled(cfg); err != nil {
		return err
	}
	if wa == nil {
		return ErrMFAWebAuthnNotReady
	}
	lock, err := readLockout(ctx, pool, userID)
	if err != nil {
		return err
	}
	if isLockedOut(lock) {
		return errors.New("mfa: too many attempts; try again later")
	}
	sUser, kind, data, err := loadWebAuthnSession(ctx, pool, sessionID)
	if err != nil {
		return err
	}
	if kind != "login" || sUser != userID {
		return errors.New("invalid webauthn session")
	}
	sd, err := unmarshalSession(data)
	if err != nil {
		return err
	}
	wu, err := loadWebUser(ctx, pool, userID)
	if err != nil {
		return err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body)
	if err != nil {
		return err
	}
	cred, err := wa.ValidateLogin(wu, sd, parsed)
	if err != nil {
		_ = recordMFAFailure(ctx, pool, userID)
		insertAudit(ctx, pool, userID, "webauthn_assert_fail", map[string]any{"error": err.Error()})
		return ErrMFAInvalid
	}
	newCount := int64(cred.Authenticator.SignCount)
	tag, err := pool.Exec(ctx, `
UPDATE "user".mfa_webauthn_credentials
SET sign_count = $3
WHERE user_id = $1 AND credential_id = $2 AND sign_count < $3
`, userID, cred.ID, newCount)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		_ = recordMFAFailure(ctx, pool, userID)
		insertAudit(ctx, pool, userID, "webauthn_assert_fail", map[string]any{"reason": "sign_count"})
		return ErrMFAReplay
	}
	deleteWebAuthnSession(ctx, pool, sessionID)
	_ = clearMFAFailureWindow(ctx, pool, userID)
	insertAudit(ctx, pool, userID, "webauthn_assert_success", nil)
	return nil
}
