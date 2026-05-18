package background

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/pushsubscriptions"
	"github.com/lextures/lextures/server/internal/repos/pushjobs"
)

var pushRetryDelays = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute}

func sweepPushJobs(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, now time.Time) {
	if !cfg.PushNotificationsEnabled || pool == nil {
		return
	}
	if cfg.VAPIDPublicKey == "" || cfg.VAPIDPrivateKey == "" {
		return
	}
	jobs, err := pushjobs.ListDue(ctx, pool, 50, now)
	if err != nil {
		slog.Warn("push_jobs.list", "err", err)
		return
	}
	for _, job := range jobs {
		if err := deliverPushJob(ctx, pool, cfg, job, now); err != nil {
			slog.Warn("push_jobs.deliver", "job_id", job.ID, "err", err)
		}
	}
}

func deliverPushJob(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, job pushjobs.Job, now time.Time) error {
	subs, err := pushsubscriptions.ListAllForUser(ctx, pool, job.UserID)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return pushjobs.MarkSent(ctx, pool, job.ID, now)
	}

	payload := buildPushPayload(job.Title, job.Body, job.ActionURL)
	allGone := true
	var firstErr error

	for _, sub := range subs {
		resp, err := sendWebPush(payload, sub, cfg)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			slog.Warn("push_jobs.send", "job_id", job.ID, "endpoint_prefix", sub.Endpoint[:min(len(sub.Endpoint), 30)], "err", err)
			continue
		}
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusGone {
			_ = pushsubscriptions.DeleteByEndpoint(ctx, pool, sub.Endpoint)
			continue
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			_ = pushsubscriptions.MarkUsed(ctx, pool, sub.ID)
			allGone = false
			firstErr = nil
		} else {
			if firstErr == nil {
				firstErr = fmt.Errorf("push endpoint returned %d", resp.StatusCode)
			}
			allGone = false
		}
	}

	if allGone || firstErr == nil {
		return pushjobs.MarkSent(ctx, pool, job.ID, now)
	}

	attempts := job.Attempts + 1
	dead := attempts >= len(pushRetryDelays)
	var next time.Time
	if !dead {
		next = now.Add(pushRetryDelays[attempts-1])
	}
	return pushjobs.MarkRetry(ctx, pool, job.ID, attempts, next, dead)
}

func sendWebPush(payload []byte, sub pushsubscriptions.Row, cfg config.Config) (*http.Response, error) {
	return webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256DHKey,
			Auth:   sub.AuthSecret,
		},
	}, &webpush.Options{
		VAPIDPublicKey:  cfg.VAPIDPublicKey,
		VAPIDPrivateKey: cfg.VAPIDPrivateKey,
		Subscriber:      cfg.VAPIDSubject,
		TTL:             86400,
	})
}

func buildPushPayload(title, body, actionURL string) []byte {
	escaped := func(s string) string {
		// simple JSON string escaping for title/body
		b := make([]byte, 0, len(s)+2)
		for _, c := range s {
			switch c {
			case '"':
				b = append(b, '\\', '"')
			case '\\':
				b = append(b, '\\', '\\')
			case '\n':
				b = append(b, '\\', 'n')
			case '\r':
				b = append(b, '\\', 'r')
			default:
				b = append(b, []byte(string(c))...)
			}
		}
		return string(b)
	}
	if actionURL == "" {
		return []byte(`{"title":"` + escaped(title) + `","body":"` + escaped(body) + `"}`)
	}
	return []byte(`{"title":"` + escaped(title) + `","body":"` + escaped(body) + `","url":"` + escaped(actionURL) + `"}`)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
