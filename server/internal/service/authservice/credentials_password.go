package authservice

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	apw "github.com/lextures/lextures/server/internal/auth/hibp"
	pp "github.com/lextures/lextures/server/internal/auth/passwordpolicy"
	pwdrepo "github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

// PasswordPolicyViolationError is returned when password rules or HIBP rejects the password.
type PasswordPolicyViolationError struct {
	Detail     string
	Violations []string
}

func (e *PasswordPolicyViolationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Detail
}

func enforceNewPassword(ctx context.Context, pool *pgxpool.Pool, institutionID *uuid.UUID, password string, checker apw.Checker) (apw.Result, error) {
	row, err := pwdrepo.LoadEffective(ctx, pool, institutionID)
	if err != nil {
		return apw.Result{}, err
	}
	pol := pp.FromDBRow(row)
	if v := pol.LocalViolations(password); len(v) > 0 {
		return apw.Result{}, &PasswordPolicyViolationError{
			Detail:     pp.HumanDetail(pol, v),
			Violations: v,
		}
	}
	if !pol.CheckHIBP {
		return apw.Result{BreachFound: false, HIBPAvailable: true}, nil
	}
	if checker == nil {
		checker = apw.StubChecker{Result: apw.Result{BreachFound: false, HIBPAvailable: false}}
	}
	res := checker.Check(ctx, password)
	if res.BreachFound {
		return res, &PasswordPolicyViolationError{
			Detail:     pp.BreachMessage,
			Violations: []string{"password.hibp_breach"},
		}
	}
	return res, nil
}

// IsPasswordPolicyViolation reports RFC 7807 password policy errors.
func IsPasswordPolicyViolation(err error) (*PasswordPolicyViolationError, bool) {
	var p *PasswordPolicyViolationError
	if errors.As(err, &p) {
		return p, true
	}
	return nil, false
}
